"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO, autorizarEscrita, autorizarLeitura } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import { PARAMETROS_PADRAO, parametrosDaLinha } from "@/lib/viagens/custo/mapear";
import {
  PARADA_COLS,
  VIAGEM_COLS,
  modalDaLinha as modal,
  numDaLinha as num,
  textoDaLinha as texto,
} from "@/lib/viagens/colunas";
import {
  aberturaViagem,
  buildPromptViagem,
  type EnderecoConhecido,
  type ViagemContexto,
  type ViagemVizinha,
} from "@/lib/viagens/entrevista-prompt";
import type { MensagemViagem } from "@/lib/viagens/cartao";
import type { ParametrosViagem } from "@/lib/viagens/custo/tipos";

// =============================================================================
// A ENTREVISTA de uma viagem.
//
// A conversa é POR VIAGEM (`orcamento_viagem_conversas`, PK = viagem_id), não por
// categoria × setor como no Planejamento: ali a entrevista monta várias despesas
// de uma categoria; aqui ela monta UM roteiro, e cada viagem é um roteiro.
//
// O transcript fica gravado porque é nele que mora o raciocínio de quem orçou — a
// finalidade da viagem, por que três noites e não duas, por que não deu para
// juntar com a outra. É o que o diretor pode querer ler antes de aprovar.
//
// ── Nada aqui GRAVA no orçamento ──────────────────────────────────────────
// A IA propõe o cartão, a tela o transforma em formulário e o gestor grava pelo
// caminho normal (`salvarViagem`), que é onde o custo é calculado e as travas
// valem. Um segundo caminho de escrita a partir da conversa contornaria tudo isso.
// =============================================================================

const PATH = "/orcamento";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

export interface EnderecoViagem {
  id: string;
  cidade: string;
  nome: string;
  endereco: string | null;
  tipo: "unidade" | "salao" | "outro";
  confirmado: boolean;
}

const TIPOS_ENDERECO: readonly EnderecoViagem["tipo"][] = ["unidade", "salao", "outro"];

function tipoEndereco(v: unknown): EnderecoViagem["tipo"] {
  return TIPOS_ENDERECO.includes(v as EnderecoViagem["tipo"])
    ? (v as EnderecoViagem["tipo"])
    : "outro";
}

function lerConversaJson(v: unknown): MensagemViagem[] {
  if (!Array.isArray(v)) return [];
  const out: MensagemViagem[] = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const content = texto(o.content);
    if (!content) continue;
    out.push({ role: o.role === "user" ? "user" : "assistant", content });
  }
  return out;
}

/**
 * A viagem existe, está nesta empresa × ano e o usuário a alcança?
 *
 * O recorte por SETOR vale aqui também: a conversa carrega a finalidade e os
 * valores da viagem, e não pode ser mais aberta do que a viagem é.
 */
async function viagemNoEscopo(
  supabase: Supa,
  companyId: string,
  year: number,
  viagemId: string,
  setoresDeLeitura: string[] | null,
): Promise<{ setorId: string | null } | { error: string }> {
  const { data, error } = await supabase
    .from("orcamento_viagens")
    .select("setor_id")
    .eq("id", viagemId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (error) return { error: error.message };
  if (!data) return { error: "Viagem não encontrada." };
  const setorId = (data.setor_id as string | null) ?? null;
  if (setoresDeLeitura !== null && (!setorId || !setoresDeLeitura.includes(setorId))) {
    return { error: SEM_ACESSO };
  }
  return { setorId };
}

/** O transcript gravado desta viagem. */
export async function getConversaViagem(
  companyId: string,
  year: number,
  viagemId: string,
): Promise<{ conversa: MensagemViagem[]; error?: string }> {
  if (!companyId || !viagemId || !isValidBudgetYear(year)) return { conversa: [] };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { conversa: [], error: auth.error };

  const escopo = await viagemNoEscopo(supabase, companyId, year, viagemId, auth.setores);
  if ("error" in escopo) return { conversa: [], error: escopo.error };

  const { data, error } = await supabase
    .from("orcamento_viagem_conversas")
    .select("conversa")
    .eq("viagem_id", viagemId)
    .maybeSingle();
  // Tabela ausente não derruba a tela da viagem: a conversa é acessória, o
  // roteiro e o custo não dependem dela.
  if (error) return { conversa: [] };
  return { conversa: lerConversaJson((data as Record<string, unknown> | null)?.conversa) };
}

/**
 * Grava o transcript. Chamada pela rota de streaming no `onFinish`.
 *
 * Best-effort de propósito: a conversa já aconteceu na tela, e derrubar o turno
 * porque o registro falhou não devolveria nada ao gestor.
 */
export async function persistirConversaViagem(
  viagemId: string,
  conversa: MensagemViagem[],
): Promise<void> {
  if (!viagemId) return;
  const supabase = db();
  if (!supabase) return;
  await supabase.from("orcamento_viagem_conversas").upsert(
    {
      viagem_id: viagemId,
      conversa,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "viagem_id" },
  );
}

/** Apaga o transcript — recomeçar a conversa sem mexer no roteiro gravado. */
export async function limparConversaViagem(
  companyId: string,
  year: number,
  viagemId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!companyId || !viagemId) return { error: "Viagem inválida." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const escopo = await viagemNoEscopo(supabase, companyId, year, viagemId, auth.setores);
  if ("error" in escopo) return { error: escopo.error };

  const { error } = await supabase
    .from("orcamento_viagem_conversas")
    .delete()
    .eq("viagem_id", viagemId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/** Endereços já cadastrados da empresa (unidades, salões, clientes). */
export async function listarEnderecosViagem(
  companyId: string,
  year: number,
): Promise<{ items: EnderecoViagem[]; error?: string }> {
  if (!companyId) return { items: [] };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { items: [], error: auth.error };

  const { data, error } = await supabase
    .from("orcamento_viagem_enderecos")
    .select("id, cidade, nome, endereco, tipo, confirmado_em")
    .eq("company_id", companyId)
    .order("cidade");
  if (error) return { items: [] };

  return {
    items: ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      cidade: texto(r.cidade),
      nome: texto(r.nome),
      endereco: texto(r.endereco) || null,
      tipo: tipoEndereco(r.tipo),
      confirmado: r.confirmado_em != null,
    })),
  };
}

/**
 * Guarda um endereço que o solicitante CONFIRMOU.
 *
 * A IA propõe, a pessoa confirma, o sistema guarda — e a segunda viagem à mesma
 * cidade reusa em vez de buscar de novo. Isso resolve consistência, não só
 * conveniência: sem o cadastro, duas viagens ao mesmo lugar poderiam ser orçadas
 * contra endereços diferentes, e o custo de deslocamento divergiria sem ninguém
 * entender por quê.
 *
 * `fonte` registra de onde veio o texto (a IA, ou digitado), para distinguir
 * depois o que foi conferido do que foi aceito como vinha.
 */
export async function salvarEnderecoViagem(
  companyId: string,
  year: number,
  input: { cidade: string; nome: string; endereco: string; tipo?: string; fonte?: string },
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  if (!companyId) return { error: "Empresa inválida." };
  if (!texto(input.cidade)) return { error: "Informe a cidade." };
  if (!texto(input.nome)) return { error: "Informe o nome do lugar." };

  const supabase = (db() ?? (await createClient())) as Supa;
  // Cadastrar endereço é construir o orçamento da viagem: quem escreve no
  // orçamento desta empresa pode cadastrar.
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const agora = new Date().toISOString();
  const { error } = await supabase.from("orcamento_viagem_enderecos").insert({
    company_id: companyId,
    cidade: texto(input.cidade),
    nome: texto(input.nome),
    endereco: texto(input.endereco) || null,
    tipo: tipoEndereco(input.tipo),
    fonte: texto(input.fonte) || null,
    confirmado_em: agora,
    confirmado_por: auth.user.userId,
  });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    // A chave única é um índice POR EXPRESSÃO (`lower(btrim(...))`), e
    // `upsert`/`ON CONFLICT (colunas)` não casa com ele — mesma pegadinha de
    // `orcamento_grupo_escopo`. Por isso a gravação é INSERT, e 23505 se lê como
    // "esse lugar já está cadastrado".
    if (error.code === "23505") {
      return { error: "Esse lugar já está cadastrado nesta cidade." };
    }
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}

/** Uma linha do roteiro, como o prompt a lê. */
function linhaDoRoteiro(p: Record<string, unknown>, origem: string, anterior: string): string {
  const cidade = texto(p.cidade) || "cidade não informada";
  const noites = num(p.noites) ?? 0;
  const de = texto(p.chegada_de) || anterior || origem || "origem";
  const porPessoa = num(p.chegada_preco_pessoa);
  const total = num(p.chegada_preco_total);
  const km = num(p.chegada_distancia_km);
  // A MESMA precedência do motor (`precoTotal` > `precoPorPessoa` > km): se o
  // prompt descrevesse outra, a IA perguntaria por um preço que já existe.
  const preco =
    total != null
      ? `preço fechado ${total}`
      : porPessoa != null
        ? `${porPessoa} por pessoa`
        : km != null
          ? `${km} km, sem cotação`
          : "SEM preço e SEM distância";
  const destino = texto(p.local_destino);
  const trajetos = num(p.local_trajetos_dia);
  const local = destino
    ? `; compromisso em ${destino}${trajetos ? `, ${trajetos} trajeto(s)/dia` : ""}`
    : "";
  const hotel = num(p.diaria_hotel);
  return `${cidade}: ${noites} noite(s), chega de ${de} por ${modal(p.chegada_modal)} (${preco})${
    hotel != null ? `; diária ${hotel}` : ""
  }${local}`;
}

export interface PromptViagemResult {
  system?: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  error?: string;
  needsMigration?: boolean;
}

/**
 * Monta o system prompt e as mensagens de UM turno da entrevista.
 *
 * O prompt é montado NO SERVIDOR a cada turno, nunca guardado: ele carrega o
 * roteiro atual, os parâmetros vigentes, as outras viagens do recorte e os
 * endereços conhecidos — tudo isso muda entre um turno e o seguinte, e um prompt
 * congelado faria a IA perguntar de novo o que o gestor acabou de gravar.
 */
export async function montarPromptViagem(params: {
  companyId: string;
  year: number;
  viagemId: string;
  texto: string;
  conversa: MensagemViagem[];
}): Promise<PromptViagemResult> {
  const { companyId, year, viagemId } = params;
  if (!companyId || !viagemId) return { error: "Viagem inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: row, error } = await supabase
    .from("orcamento_viagens")
    .select(VIAGEM_COLS)
    .eq("id", viagemId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  if (!row) return { error: "Viagem não encontrada." };
  const r = row as unknown as Record<string, unknown>;
  const setorDaViagem = (r.setor_id as string | null) ?? null;
  if (auth.setores !== null && (!setorDaViagem || !auth.setores.includes(setorDaViagem))) {
    return { error: SEM_ACESSO };
  }

  const [paradasRes, paramRow, companyRes, setorRes, enderecosRes, vizinhasRes, cats] =
    await Promise.all([
      supabase
        .from("orcamento_viagem_paradas")
        .select(PARADA_COLS)
        .eq("viagem_id", viagemId)
        .order("ordem"),
      supabase
        .from("orcamento_viagem_parametros")
        .select("*")
        .eq("company_id", companyId)
        .eq("year", year)
        .maybeSingle(),
      supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
      setorDaViagem
        ? supabase.from("orcamento_setores").select("name").eq("id", setorDaViagem).maybeSingle()
        : Promise.resolve({ data: null }),
      listarEnderecosViagem(companyId, year),
      // Outras viagens do MESMO recorte, para a IA poder sugerir juntar.
      supabase
        .from("orcamento_viagens")
        .select("id, titulo, data_ida, pessoas, setor_id")
        .eq("company_id", companyId)
        .eq("year", year)
        .neq("id", viagemId),
      getCategoriasOrcamento(companyId, year),
    ]);

  const parametros: ParametrosViagem = paramRow.data
    ? parametrosDaLinha(paramRow.data as Record<string, unknown>)
    : PARAMETROS_PADRAO;
  const parametrosPadrao = !paramRow.data;

  // ── O roteiro de hoje, em uma linha por parada ──
  const paradasRaw = (paradasRes.data ?? []) as unknown as Array<Record<string, unknown>>;
  const origem = texto(r.origem);
  const roteiroAtual: string[] = [];
  let anterior = "";
  for (const p of paradasRaw) {
    roteiroAtual.push(linhaDoRoteiro(p, origem, anterior));
    anterior = texto(p.cidade);
  }
  if (r.volta_modal != null) {
    roteiroAtual.push(`volta a ${origem || "origem"} por ${modal(r.volta_modal)}`);
  }

  // ── As vizinhas, para a sugestão de juntar ──
  // Só as do MESMO setor: juntar viagem de outro setor não é decisão de quem
  // monta este, e a economia cairia num orçamento que ele não responde.
  const vizinhasLinhas = ((vizinhasRes.data ?? []) as Array<Record<string, unknown>>).filter(
    (v) => ((v.setor_id as string | null) ?? null) === setorDaViagem,
  );
  const vizinhas: ViagemVizinha[] = [];
  if (vizinhasLinhas.length > 0) {
    const ids = vizinhasLinhas.map((v) => v.id as string);
    const { data: cidadesRows } = await supabase
      .from("orcamento_viagem_paradas")
      .select("viagem_id, ordem, cidade")
      .in("viagem_id", ids)
      .order("ordem");
    const porViagem = new Map<string, string[]>();
    for (const c of (cidadesRows ?? []) as Array<Record<string, unknown>>) {
      const lista = porViagem.get(c.viagem_id as string) ?? [];
      const cidade = texto(c.cidade);
      if (cidade) lista.push(cidade);
      porViagem.set(c.viagem_id as string, lista);
    }
    for (const v of vizinhasLinhas) {
      const cidades = porViagem.get(v.id as string) ?? [];
      // Rascunho sem roteiro não entra: sugerir juntar com uma viagem vazia não
      // dá ao gestor nada para decidir.
      if (cidades.length === 0) continue;
      vizinhas.push({
        titulo: texto(v.titulo) || "Viagem sem título",
        cidades,
        dataIda: (v.data_ida as string | null) ?? null,
        pessoas: num(v.pessoas) ?? 1,
      });
    }
  }

  // O nome da categoria é o do CADASTRO, não o código: o prompt o cita ao
  // gestor, e "2.01.98" não diz nada a ninguém.
  const code = texto(r.category_code);
  const categoryName =
    (cats.items ?? []).find((c) => c.categoryCode === code)?.categoryName || code || "não definida";

  // O TIPO é a língua da conversa; a categoria é consequência dele.
  const { data: tipoRow } = r.tipo_id
    ? await supabase
        .from("orcamento_viagem_tipos")
        .select("nome")
        .eq("id", r.tipo_id as string)
        .maybeSingle()
    : { data: null };
  const tipoNome = texto((tipoRow as Record<string, unknown> | null)?.nome);

  const contexto: ViagemContexto = {
    companyName: texto((companyRes.data as Record<string, unknown> | null)?.name) || "a empresa",
    setorNome: texto((setorRes.data as Record<string, unknown> | null)?.name),
    categoryName,
    tipoNome,
    year,
    titulo: texto(r.titulo) || "Viagem sem título",
    roteiroAtual,
    origem,
    dataIda: (r.data_ida as string | null) ?? null,
    pessoas: num(r.pessoas) ?? 1,
    pessoasPorQuarto: num(r.pessoas_por_quarto) ?? 1,
  };

  const enderecos: EnderecoConhecido[] = (enderecosRes.items ?? []).map((e) => ({
    cidade: e.cidade,
    nome: e.nome,
    endereco: e.endereco,
    tipo: e.tipo,
  }));

  const system = buildPromptViagem({
    contexto,
    parametros,
    parametrosPadrao,
    vizinhas,
    enderecos,
  });

  const historico = (params.conversa ?? []).filter((m) => (m.content ?? "").trim() !== "");
  const falaUsuario = (params.texto ?? "").trim();
  const messages = [
    ...historico,
    // Conversa nova não tem fala do usuário: a abertura é uma instrução de
    // turno, e não uma frase que o gestor veria como se tivesse escrito.
    { role: "user" as const, content: falaUsuario || aberturaViagem(contexto) },
  ];

  return { system, messages };
}
