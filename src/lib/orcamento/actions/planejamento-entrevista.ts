"use server";

import type { ModelMessage } from "ai";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarLeitura } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import {
  buildSystemPrompt,
  type EntrevistaBaseItem,
  type EntrevistaDespesaRegistrada,
} from "@/lib/orcamento/entrevista-prompt";
import { gruposDisponiveis, type EscopoGrupo } from "@/lib/orcamento/grupos";
import {
  toPeriodicidade,
  type PlanejamentoMensagem,
} from "@/lib/orcamento/planejamento-calc";
import {
  combinarRealizados,
  fetchRealizados,
  mesesFechados,
  resumirRealizado,
  type MediaRealizado,
} from "@/lib/orcamento/media-realizado";

// =============================================================================
// Entrevista do Planejamento dos gestores — montagem do prompt e persistência
// da conversa.
//
// Vive separado de `planejamento-categoria.ts` porque quem consome isto é a
// rota de streaming (`/api/orcamento/planejamento/chat`), e ela precisa do
// prompt pronto antes de abrir o stream. O prompt em si é o módulo PURO
// `entrevista-prompt.ts` — aqui só se busca o que ele precisa.
// =============================================================================

/**
 * Mês a mês do ano anterior que o cliente já tem na tela.
 *
 * Mandar isto do cliente evita refazer `fetchRealizados` a CADA turno da
 * conversa — é a consulta mais cara do preparo, e o número não muda durante a
 * entrevista. É contexto, não autorização: o cliente o recebeu do servidor na
 * carga da tela, e o pior caso de um valor adulterado é a IA conversar com um
 * histórico errado na tela de quem adulterou.
 */
export interface EntrevistaRealizadoCache {
  meses: (number | null)[];
}

export interface MontarPromptInput {
  companyId: string;
  year: number;
  categoryCode: string;
  setorId: string | null;
  /** Mensagem que o gestor acabou de escrever (vazia no turno de abertura). */
  texto: string;
  conversa: PlanejamentoMensagem[];
  modo: "entrevista" | "fechamento";
  realizadoCache?: EntrevistaRealizadoCache | null;
}

export async function montarPromptEntrevista(input: MontarPromptInput): Promise<{
  system?: string;
  messages?: ModelMessage[];
  error?: string;
  needsMigration?: boolean;
}> {
  const { companyId, year, categoryCode, setorId } = input;
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  // Setor fora do alcance do usuário não conversa: sem isto, um setorId
  // trocado no corpo da requisição traria a base de um setor que ele não vê.
  if (setorId && auth.setores !== null && !auth.setores.includes(setorId)) {
    return { error: "Você não tem acesso ao orçamento deste setor." };
  }

  const cats = await getCategoriasOrcamento(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const cat = (cats.items ?? []).find((c) => c.categoryCode === categoryCode);
  if (!cat) return { error: "Categoria não encontrada." };

  const filtroSetor = <Q,>(q: Q): Q => {
    const b = q as unknown as {
      eq(c: string, v: string): unknown;
      is(c: string, v: null): unknown;
    };
    return (setorId ? b.eq("setor_id", setorId) : b.is("setor_id", null)) as Q;
  };

  const [empresa, setor, baseRes, despRes, gruposRes, entrevRes] = await Promise.all([
    supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
    setorId
      ? supabase.from("orcamento_setores").select("name").eq("id", setorId).maybeSingle()
      : Promise.resolve({ data: null }),
    filtroSetor(
      supabase
        .from("orcamento_planejamento_base")
        .select("nome, valor_ano, orcamento_grupos_despesa(name)")
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode)
        .eq("incluir", true),
    ),
    filtroSetor(
      supabase
        .from("orcamento_planejamento_despesas")
        .select("descricao, valor, periodicidade, mes_inicio, mes_fim, orcamento_grupos_despesa(name)")
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode)
        .eq("cancelado", false),
    ),
    supabase
      .from("orcamento_grupos_despesa")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("active", true),
    filtroSetor(
      supabase
        .from("orcamento_planejamento_entrevistas")
        .select("contexto_admin")
        .eq("company_id", companyId)
        .eq("year", year)
        .eq("category_code", categoryCode),
    ).maybeSingle(),
  ]);

  if (baseRes.error && isSchemaMissing(baseRes.error.message)) return { needsMigration: true };

  const base: EntrevistaBaseItem[] = ((baseRes.data ?? []) as Array<Record<string, unknown>>)
    .map((r) => ({
      nome: (r.nome as string) ?? "",
      valorAno: Number(r.valor_ano) || 0,
      grupoNome:
        (r.orcamento_grupos_despesa as { name?: string } | null | undefined)?.name ?? null,
    }))
    .sort((a, b) => b.valorAno - a.valorAno);

  const registradas: EntrevistaDespesaRegistrada[] = (
    (despRes.data ?? []) as Array<Record<string, unknown>>
  ).map((r) => ({
    descricao: (r.descricao as string) ?? "",
    valor: Number(r.valor) || 0,
    periodicidade: toPeriodicidade(r.periodicidade),
    mesInicio: Number(r.mes_inicio) || 1,
    mesFim: r.mes_fim == null ? null : Number(r.mes_fim),
    grupoNome: (r.orcamento_grupos_despesa as { name?: string } | null | undefined)?.name ?? null,
  }));

  // Só os grupos que valem NESTA categoria × setor. Oferecer o catálogo inteiro
  // fazia a IA sugerir grupo de marketing numa categoria de pró-labore.
  const { data: escopoRows } = await supabase
    .from("orcamento_grupo_escopo")
    .select("grupo_id, setor_id, category_code")
    .eq("company_id", companyId)
    .eq("year", year);
  const escopos: EscopoGrupo[] = (escopoRows ?? []).map((r) => ({
    grupoId: r.grupo_id as string,
    setorId: (r.setor_id as string | null) ?? null,
    categoryCode: r.category_code as string,
  }));
  const grupos = gruposDisponiveis(
    ((gruposRes.data ?? []) as Array<{ id: string; name: string }>).map((r) => ({
      id: r.id,
      name: r.name,
    })),
    escopos,
    { categoryCode, setorIds: [setorId] },
  )
    .map((g) => g.name)
    .sort((a, b) => a.localeCompare(b, "pt-BR", { sensitivity: "base" }));

  // Realizado: do cache do cliente quando ele o mandou, senão da Omie.
  let realizado: MediaRealizado | undefined;
  if (input.realizadoCache?.meses && input.realizadoCache.meses.length === 12) {
    realizado = resumirRealizado(input.realizadoCache.meses, mesesFechados(year - 1));
  } else {
    // `cat.codigos` já traz o próprio código e as gêmeas "(*)" absorvidas — a
    // unificação acontece em `getCategoriaMetodo`. Recalcular com
    // `codigosIrmaos` sobre `cats.items` não funcionaria mais: a gêmea já foi
    // filtrada de lá.
    const irmaos = cat.codigos;
    const mapa = await fetchRealizados(supabase, companyId, year - 1, irmaos);
    realizado = combinarRealizados(mapa, irmaos, year - 1);
  }

  const system = buildSystemPrompt({
    companyName: (empresa.data?.name as string) ?? "empresa",
    setorNome: ((setor as { data: { name?: string } | null }).data?.name as string) ?? "",
    categoryName: cat.categoryName,
    dreLineCode: cat.dreLineCode,
    dreLineName: cat.dreLineName,
    year,
    realizado,
    base,
    registradas,
    grupos,
    contextoAdmin: (entrevRes.data?.contexto_admin as string | null) ?? "",
    modo: input.modo,
  });

  const historico: ModelMessage[] = (input.conversa ?? []).map((m) => ({
    role: m.role,
    content: m.content,
  }));

  const texto = (input.texto ?? "").trim();
  const messages: ModelMessage[] =
    input.modo === "fechamento"
      ? [
          ...historico,
          {
            role: "user",
            content:
              "Encerrei a entrevista. Escreva agora apenas a justificativa final, conforme as instruções.",
          },
        ]
      : historico.length === 0 && !texto
        ? // Turno de abertura: sem histórico e sem pergunta, a IA precisa de um
          // empurrão explícito, senão alguns modelos devolvem uma saudação vazia.
          [{ role: "user", content: "Vamos começar a entrevista desta categoria." }]
        : texto
          ? [...historico, { role: "user", content: texto }]
          : historico;

  return { system, messages };
}

/**
 * Grava o transcript da conversa (categoria × setor).
 *
 * Reescreve o array inteiro em vez de acrescentar: a conversa é curta, e um
 * append concorrente entre dois turnos do mesmo usuário não existe (a tela só
 * manda o próximo turno depois que o anterior fecha).
 */
export async function persistirConversaEntrevista(
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
  categoryName: string,
  conversa: PlanejamentoMensagem[],
  justificativa?: string | null,
): Promise<{ ok?: true; error?: string }> {
  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  if (setorId && auth.setores !== null && !auth.setores.includes(setorId)) {
    return { error: "Você não tem acesso ao orçamento deste setor." };
  }

  const patch: Record<string, unknown> = {
    conversa,
    updated_by: auth.user.userId,
  };
  if (justificativa !== undefined) patch.justificativa = justificativa;

  const filtro = <Q,>(q: Q): Q => {
    const b = q as unknown as {
      eq(c: string, v: string): unknown;
      is(c: string, v: null): unknown;
    };
    return (setorId ? b.eq("setor_id", setorId) : b.is("setor_id", null)) as Q;
  };

  const { data: existente } = await filtro(
    supabase
      .from("orcamento_planejamento_entrevistas")
      .select("id")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("category_code", categoryCode),
  ).maybeSingle();

  if (existente?.id) {
    const { error } = await supabase
      .from("orcamento_planejamento_entrevistas")
      .update(patch)
      .eq("id", existente.id as string);
    if (error) return { error: error.message };
    return { ok: true };
  }

  const { error } = await supabase.from("orcamento_planejamento_entrevistas").insert({
    company_id: companyId,
    year,
    category_code: categoryCode,
    setor_id: setorId,
    category_name: categoryName,
    ...patch,
  });
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Reinicia a entrevista: apaga o transcript e a justificativa.
 *
 * NÃO apaga as despesas já registradas — elas são orçamento, não conversa.
 * Quem quiser zerar o orçamento remove as despesas na lista, uma a uma, onde a
 * ação é explícita.
 */
export async function reiniciarEntrevista(
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
): Promise<{ ok?: true; error?: string }> {
  return persistirConversaEntrevista(companyId, year, categoryCode, setorId, "", [], null);
}
