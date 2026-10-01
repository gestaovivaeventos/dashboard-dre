"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  SEM_ACESSO,
  SEM_ACESSO_ADMIN,
  SEM_ACESSO_SETOR,
  autorizarEscrita,
  autorizarLeitura,
  getOrcamentoAdmin,
  podeEscreverNoSetor,
  podeValidarOrcamento,
  setoresDeEscrita,
} from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { orcaPorSetor, setorParaGravar } from "@/lib/orcamento/setor-gravacao";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import { travaDaValidacao } from "@/lib/orcamento/actions/validacao-diretoria";
import { travaDeFinalizacao } from "@/lib/orcamento/actions/finalizacao";
import { estadoDaLinha, lerDecisoes } from "@/lib/orcamento/decisoes-linha";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import { calcularViagem } from "@/lib/viagens/custo/motor";
import {
  PARAMETROS_PADRAO,
  gruposDoRetrato,
  mesesDoRetrato,
  parametrosDaLinha,
  retratoParaGravar,
  specDaViagem,
} from "@/lib/viagens/custo/mapear";
import {
  PARADA_COLS,
  VIAGEM_COLS,
  modalDaLinha as modal,
  numDaLinha as num,
  textoDaLinha as texto,
} from "@/lib/viagens/colunas";
import { categoriaDoTipo, tiposOferecidos, type TipoViagem } from "@/lib/viagens/tipos";
import type { ModalTrecho, ParametrosViagem } from "@/lib/viagens/custo/tipos";

// =============================================================================
// Orçamento de VIAGENS — as actions.
//
// ── O invariante central: o CUSTO é do servidor ────────────────────────────
// A tela NUNCA manda o total. Toda gravação recalcula pelo motor
// (`calcularViagem`) com os parâmetros vigentes da empresa × ano e grava o
// RETRATO. Dois motivos que se somam:
//
//   • um total vindo do cliente poderia não corresponder ao roteiro gravado, e
//     a divergência só apareceria quando alguém somasse à mão;
//   • é o retrato que torna o número estável — o admin mudando a diária de
//     hotel em novembro não pode alterar em silêncio uma viagem que o diretor
//     já aprovou e que já foi para o Budget. É a mesma razão pela qual o Plano
//     de Cargos COPIA o salário em vez de apontar para ele.
//
// ── `rascunho` × `enviada` ────────────────────────────────────────────────
// Rascunho não entra na Prévia nem na fila do diretor: ainda não é orçamento, e
// um roteiro pela metade somando no total da empresa seria pior que nada. É em
// `enviarViagem` que o CONJUNTO é validado (data e custo), não a cada gravação —
// montar um roteiro leva várias idas e vindas, e barrar em todas obrigaria o
// solicitante a preencher na ordem que o sistema quer.
//
// A aprovação em si é do DIRETOR e mora em `orcamento_validacoes`
// (alvo_tipo 'viagem'); aqui só se registra que o solicitante deu por pronta.
// =============================================================================

const PATH = "/orcamento";

const METODO = "viagens" as const;

function db() {
  return createAdminClientIfAvailable();
}

// ─── Entradas da tela ────────────────────────────────────────────────────────

export interface ParadaInput {
  cidade: string;
  noites: number;
  chegadaDe?: string | null;
  chegadaModal?: string | null;
  chegadaDistanciaKm?: number | null;
  chegadaPrecoPessoa?: number | null;
  chegadaPrecoTotal?: number | null;
  chegadaPedagios?: number | null;
  chegadaVeiculos?: number | null;
  diariaHotel?: number | null;
  localTrajetosDia?: number | null;
  localCustoTrajeto?: number | null;
  localDestino?: string | null;
  localEndereco?: string | null;
}

export interface ViagemInput {
  titulo: string;
  /** Tipo da viagem — é ele que resolve a categoria da DRE pelo de-para. */
  tipoId?: string | null;
  finalidade?: string | null;
  origem: string;
  dataIda?: string | null;
  pessoas: number;
  pessoasPorQuarto: number;
  transladoCustoTrajeto?: number | null;
  transladoTrajetos?: number | null;
  voltaModal?: string | null;
  voltaDistanciaKm?: number | null;
  voltaPrecoPessoa?: number | null;
  voltaPrecoTotal?: number | null;
  voltaPedagios?: number | null;
  voltaVeiculos?: number | null;
  outros?: Array<{ descricao: string; valor: number }>;
  paradas: ParadaInput[];
}

// ─── Saídas ──────────────────────────────────────────────────────────────────

export interface ViagemGrupo {
  grupo: string;
  label: string;
  total: number;
  linhas: Array<{ descricao: string; valor: number }>;
}

/** A viagem como a LISTA a mostra. */
export interface ViagemResumo {
  id: string;
  titulo: string;
  finalidade: string | null;
  origem: string;
  dataIda: string | null;
  pessoas: number;
  cidades: string[];
  noites: number;
  custoTotal: number;
  status: "rascunho" | "enviada";
  tipoId: string | null;
  tipoNome: string | null;
  /** Categoria em que a viagem FOI orçada (retrato resolvido na gravação). */
  categoryCode: string;
  setorId: string | null;
  setorNome: string | null;
  /** Estado da decisão da diretoria, já considerando decisão vencida. */
  estado: string;
  comentario: string | null;
  /** Fora das mãos de quem monta (decisão da diretoria). */
  travado: boolean;
  /** A fatia (categoria × setor) foi finalizada pelo admin? */
  finalizado: boolean;
  premissas: string[];
  atualizadoEm: string | null;
}

/** A viagem como a tela de MONTAGEM a carrega. */
export interface ViagemDetalhe extends ViagemResumo {
  pessoasPorQuarto: number;
  transladoCustoTrajeto: number | null;
  transladoTrajetos: number | null;
  voltaModal: ModalTrecho | null;
  voltaDistanciaKm: number | null;
  voltaPrecoPessoa: number | null;
  voltaPrecoTotal: number | null;
  voltaPedagios: number | null;
  voltaVeiculos: number | null;
  outros: Array<{ descricao: string; valor: number }>;
  paradas: Array<ParadaInput & { id: string; ordem: number }>;
  grupos: ViagemGrupo[];
  meses: number[];
  /** Quem abriu decide (aprova/reprova)? Sai do mesmo setup da lista. */
  podeValidar: boolean;
  /** Tipos que a tela pode oferecer — já filtrados pelo de-para. */
  tiposDisponiveis: Array<{ id: string; nome: string }>;
}

export interface ViagemSetorOption {
  id: string;
  name: string;
  podeEscrever: boolean;
}

export interface ViagemCategoriaOption {
  categoryCode: string;
  categoryName: string;
}

export interface ViagensSetup {
  orcaPorSetor: boolean;
  setores: ViagemSetorOption[];
  /**
   * Tipos que o cadastro pode oferecer — já filtrados: tipo sem categoria
   * mapeada ou inativo fica de fora (ver `tiposOferecidos`). Oferecer um tipo não
   * mapeado produziria viagem que não entra em conta nenhuma da DRE.
   */
  tipos: Array<{ id: string; nome: string; categoryCode: string }>;
  /** Tipos cadastrados mas sem categoria — só para o aviso ao admin. */
  tiposSemMapeamento: number;
  categorias: ViagemCategoriaOption[];
  viagens: ViagemResumo[];
  parametros: ParametrosViagem;
  /** Nenhum parâmetro cadastrado nesta empresa × ano: a conta usa o padrão. */
  parametrosPadrao: boolean;
  podeEditar: boolean;
  podeValidar: boolean;
  isAdmin: boolean;
  error?: string;
  needsMigration?: boolean;
}

const VAZIO: ViagensSetup = {
  orcaPorSetor: false,
  setores: [],
  tipos: [],
  tiposSemMapeamento: 0,
  categorias: [],
  viagens: [],
  parametros: PARAMETROS_PADRAO,
  parametrosPadrao: true,
  podeEditar: false,
  podeValidar: false,
  isAdmin: false,
};


type Supa = Awaited<ReturnType<typeof createClient>>;

/** Parâmetros vigentes da empresa × ano (o padrão quando não há linha). */
async function lerParametros(
  supabase: Supa,
  companyId: string,
  year: number,
): Promise<{ params: ParametrosViagem; padrao: boolean }> {
  const { data, error } = await supabase
    .from("orcamento_viagem_parametros")
    .select("*")
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (error || !data) return { params: PARAMETROS_PADRAO, padrao: true };
  return { params: parametrosDaLinha(data as Record<string, unknown>), padrao: false };
}

/**
 * Os tipos da empresa × ano.
 *
 * Fonte ÚNICA para as três coisas que dependem dela: oferecer o tipo na tela,
 * resolver a categoria ao gravar e rotular a viagem na lista. Resolvendo em
 * lugares diferentes, a tela ofereceria um tipo que a gravação recusa.
 */
async function lerTipos(supabase: Supa, companyId: string, year: number): Promise<TipoViagem[]> {
  const { data, error } = await supabase
    .from("orcamento_viagem_tipos")
    .select("id, nome, category_code, ativo")
    .eq("company_id", companyId)
    .eq("year", year);
  // Migration pendente não derruba a tela: sem tipo, a lista avisa e não deixa
  // criar viagem — melhor do que criar uma que não cai em conta nenhuma.
  if (error) return [];
  return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    nome: texto(r.nome),
    categoryCode: texto(r.category_code) || null,
    ativo: r.ativo !== false,
  }));
}

function premissasDoRetrato(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === "string" && x.trim() !== "");
}

function lerOutrosJson(v: unknown): Array<{ descricao: string; valor: number }> {
  if (!Array.isArray(v)) return [];
  const out: Array<{ descricao: string; valor: number }> = [];
  for (const item of v) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const valor = num(o.valor);
    if (valor == null) continue;
    out.push({ descricao: texto(o.descricao) || "Outro custo", valor });
  }
  return out;
}

/**
 * Setup da tela: setores, categorias orçadas por este método e as viagens.
 *
 * `setorId` recorta a lista; sem ele vem o conjunto que o usuário alcança.
 */
export async function getViagensSetup(
  companyId: string,
  year: number,
  setorId?: string | null,
): Promise<ViagensSetup> {
  if (!companyId) return VAZIO;
  if (!isValidBudgetYear(year)) return { ...VAZIO, error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { ...VAZIO, error: auth.error };

  // O `setorId` vem do CLIENTE: sem esta conferência um gerente listaria, pela
  // própria action, as viagens de um setor que a tela nem lhe oferece. O
  // recorte de leitura não pode depender do que a tela resolveu mostrar.
  if (auth.setores !== null && setorId && !auth.setores.includes(setorId)) {
    return { ...VAZIO, error: SEM_ACESSO };
  }

  const porSetor = await orcaPorSetor(supabase, companyId, year);
  const escrita = await setoresDeEscrita(supabase, auth.user, companyId, year);

  // Setores visíveis: o recorte é do MÓDULO, não desta tela.
  let setores: ViagemSetorOption[] = [];
  if (porSetor) {
    const { data, error } = await supabase
      .from("orcamento_setores")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("year", year)
      .eq("active", true)
      .order("name");
    if (error && !isSchemaMissing(error.message)) return { ...VAZIO, error: error.message };
    const visiveis =
      auth.setores === null
        ? data ?? []
        : (data ?? []).filter((r) => auth.setores!.includes(r.id as string));
    setores = visiveis.map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "",
      podeEscrever: escrita === null || escrita.includes(r.id as string),
    }));
  }

  // Categorias cujo método é `viagens` nesta empresa × ano.
  const { data: metodoRows, error: metodoErr } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", METODO);
  if (metodoErr) {
    if (isSchemaMissing(metodoErr.message)) return { ...VAZIO, needsMigration: true };
    return { ...VAZIO, error: metodoErr.message };
  }
  const categorias: ViagemCategoriaOption[] = (metodoRows ?? []).map((r) => ({
    categoryCode: r.category_code as string,
    categoryName: (r.category_name as string) ?? (r.category_code as string),
  }));
  // O nome gravado no vínculo pode estar velho; o cadastro atual manda.
  const cats = await getCategoriasOrcamento(companyId, year);
  const nomePorCodigo = new Map(
    (cats.items ?? []).map((c) => [c.categoryCode, c.categoryName] as const),
  );
  for (const c of categorias) {
    const atual = nomePorCodigo.get(c.categoryCode);
    if (atual) c.categoryName = atual;
  }

  const { params, padrao } = await lerParametros(supabase, companyId, year);
  const tipos = await lerTipos(supabase, companyId, year);
  const oferecidos = tiposOferecidos(tipos);
  const nomeDoTipo = new Map(tipos.map((t) => [t.id, t.nome] as const));

  let q = supabase
    .from("orcamento_viagens")
    .select(VIAGEM_COLS)
    .eq("company_id", companyId)
    .eq("year", year);
  if (setorId) q = q.eq("setor_id", setorId);
  else if (auth.setores !== null) {
    // Gerente sem setor atribuído: `.in(…, [])` casa com NADA e não dá erro —
    // ele vê a lista vazia, nunca a empresa inteira (ver auth.ts e escopo.ts).
    q = q.in("setor_id", auth.setores);
  }
  const { data: viagemRows, error: viagemErr } = await q.order("data_ida", {
    ascending: true,
    nullsFirst: false,
  });
  if (viagemErr) {
    if (isSchemaMissing(viagemErr.message)) return { ...VAZIO, needsMigration: true };
    return { ...VAZIO, error: viagemErr.message };
  }
  const linhas = (viagemRows ?? []) as unknown as Array<Record<string, unknown>>;

  // Cidades e noites de cada viagem numa consulta só, não uma por linha.
  const ids = linhas.map((r) => r.id as string);
  const paradasPorViagem = new Map<string, Array<{ cidade: string; noites: number }>>();
  if (ids.length > 0) {
    const { data: pRows } = await supabase
      .from("orcamento_viagem_paradas")
      .select("viagem_id, ordem, cidade, noites")
      .in("viagem_id", ids)
      .order("ordem");
    for (const r of (pRows ?? []) as Array<Record<string, unknown>>) {
      const lista = paradasPorViagem.get(r.viagem_id as string) ?? [];
      lista.push({ cidade: texto(r.cidade), noites: num(r.noites) ?? 0 });
      paradasPorViagem.set(r.viagem_id as string, lista);
    }
  }

  const decisoes = await lerDecisoes(supabase, companyId, year, "viagem", ids);
  const setorNome = new Map(setores.map((s) => [s.id, s.name] as const));
  const podeValidar = podeValidarOrcamento(auth.user);

  // Fatias finalizadas — a trava é por (categoria × setor), como nos outros
  // métodos. Em lote para a lista não consultar uma vez por viagem.
  const { data: finRows } = await supabase
    .from("orcamento_finalizacoes")
    .select("category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", METODO);
  const fechadas = new Set(
    ((finRows ?? []) as Array<Record<string, unknown>>).map(
      (r) => `${(r.category_code as string) ?? ""}|${(r.setor_id as string | null) ?? "-"}`,
    ),
  );

  const viagens: ViagemResumo[] = linhas.map((r) => {
    const id = r.id as string;
    const paradas = paradasPorViagem.get(id) ?? [];
    const sId = (r.setor_id as string | null) ?? null;
    const linha = estadoDaLinha(
      decisoes.get(id),
      (r.updated_at as string | null) ?? null,
      auth.user.papel,
    );
    return {
      id,
      titulo: texto(r.titulo) || "Viagem sem título",
      finalidade: texto(r.finalidade) || null,
      origem: texto(r.origem),
      dataIda: (r.data_ida as string | null) ?? null,
      pessoas: num(r.pessoas) ?? 1,
      cidades: paradas.map((p) => p.cidade).filter(Boolean),
      noites: paradas.reduce((a, p) => a + p.noites, 0),
      custoTotal: num(r.custo_total) ?? 0,
      status: r.status === "enviada" ? "enviada" : "rascunho",
      categoryCode: (r.category_code as string) ?? "",
      setorId: sId,
      setorNome: sId ? setorNome.get(sId) ?? null : null,
      tipoId: (r.tipo_id as string | null) ?? null,
      tipoNome: r.tipo_id ? nomeDoTipo.get(r.tipo_id as string) ?? null : null,
      estado: linha.estado,
      comentario: linha.comentario,
      travado: linha.travado,
      finalizado: fechadas.has(`${(r.category_code as string) ?? ""}|${sId ?? "-"}`),
      premissas: premissasDoRetrato(r.premissas),
      atualizadoEm: (r.updated_at as string | null) ?? null,
    };
  });

  return {
    orcaPorSetor: porSetor,
    setores,
    tipos: oferecidos.map((t) => ({
      id: t.id,
      nome: t.nome,
      categoryCode: t.categoryCode as string,
    })),
    tiposSemMapeamento: tipos.filter((t) => t.ativo && !t.categoryCode).length,
    categorias,
    viagens,
    parametros: params,
    parametrosPadrao: padrao,
    podeEditar: escrita === null || escrita.length > 0,
    podeValidar,
    isAdmin: auth.user.isAdmin,
  };
}

/** Uma viagem com paradas e abertura de custo, para a tela de montagem. */
export async function getViagemDetalhe(
  companyId: string,
  year: number,
  viagemId: string,
): Promise<{ viagem?: ViagemDetalhe; error?: string; needsMigration?: boolean }> {
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
  // O recorte por setor vale também no LINK DIRETO: sem isto um gerente abriria
  // pela URL a viagem de um setor que a lista nem lhe mostra.
  if (auth.setores !== null && (!setorDaViagem || !auth.setores.includes(setorDaViagem))) {
    return { error: SEM_ACESSO };
  }

  const { data: pRows } = await supabase
    .from("orcamento_viagem_paradas")
    .select(PARADA_COLS)
    .eq("viagem_id", viagemId)
    .order("ordem");

  const paradas = ((pRows ?? []) as unknown as Array<Record<string, unknown>>).map((p) => ({
    id: p.id as string,
    ordem: num(p.ordem) ?? 0,
    cidade: texto(p.cidade),
    noites: num(p.noites) ?? 0,
    chegadaDe: texto(p.chegada_de) || null,
    chegadaModal: modal(p.chegada_modal) as string,
    chegadaDistanciaKm: num(p.chegada_distancia_km),
    chegadaPrecoPessoa: num(p.chegada_preco_pessoa),
    chegadaPrecoTotal: num(p.chegada_preco_total),
    chegadaPedagios: num(p.chegada_pedagios),
    chegadaVeiculos: num(p.chegada_veiculos),
    diariaHotel: num(p.diaria_hotel),
    localTrajetosDia: num(p.local_trajetos_dia),
    localCustoTrajeto: num(p.local_custo_trajeto),
    localDestino: texto(p.local_destino) || null,
    localEndereco: texto(p.local_endereco) || null,
  }));

  // O resumo (estado da validação, trava, finalização) sai do MESMO lugar que a
  // lista — uma segunda conta aqui poderia dizer "editável" sobre viagem travada.
  const setup = await getViagensSetup(companyId, year, setorDaViagem);
  const resumo = setup.viagens.find((v) => v.id === viagemId);
  if (!resumo) return { error: "Viagem não encontrada." };

  return {
    viagem: {
      ...resumo,
      pessoasPorQuarto: num(r.pessoas_por_quarto) ?? 1,
      transladoCustoTrajeto: num(r.translado_custo_trajeto),
      transladoTrajetos: num(r.translado_trajetos),
      voltaModal: r.volta_modal == null ? null : modal(r.volta_modal),
      voltaDistanciaKm: num(r.volta_distancia_km),
      voltaPrecoPessoa: num(r.volta_preco_pessoa),
      voltaPrecoTotal: num(r.volta_preco_total),
      voltaPedagios: num(r.volta_pedagios),
      voltaVeiculos: num(r.volta_veiculos),
      outros: lerOutrosJson(r.outros),
      paradas,
      grupos: gruposDoRetrato(r.grupos),
      meses: mesesDoRetrato(r.meses),
      podeValidar: setup.podeValidar,
      tiposDisponiveis: setup.tipos.map((t) => ({ id: t.id, nome: t.nome })),
    },
  };
}

// ─── Escrita ────────────────────────────────────────────────────────────────

/** O que impede de SALVAR. Roteiro incompleto é rascunho legítimo. */
function validarParaSalvar(input: ViagemInput): string | null {
  if (!texto(input.titulo)) return "Dê um título à viagem.";
  if (!texto(input.origem)) return "Informe a cidade de origem.";
  if ((num(input.pessoas) ?? 0) < 1) return "A viagem tem de ter pelo menos uma pessoa.";
  if ((num(input.pessoasPorQuarto) ?? 0) < 1) return "Informe quantas pessoas por quarto.";
  if (input.dataIda && !/^\d{4}-\d{2}-\d{2}$/.test(input.dataIda)) {
    return "Data de ida inválida.";
  }
  const paradas = input.paradas ?? [];
  for (let i = 0; i < paradas.length; i += 1) {
    const p = paradas[i];
    if (!texto(p.cidade)) return `Informe a cidade da parada ${i + 1}.`;
    if ((num(p.noites) ?? 0) < 0) return `As noites da parada ${i + 1} não podem ser negativas.`;
  }
  return null;
}

/**
 * Grava a viagem e RECALCULA o retrato de custo.
 *
 * As paradas são SUBSTITUÍDAS (apaga e reinsere), não atualizadas em cima: o
 * roteiro é uma lista ordenada, e upsert não faria a remoção de uma parada
 * funcionar — ela continuaria no banco e no custo, embora fora da tela. Como o
 * índice `UNIQUE (viagem_id, ordem)` barraria uma reordenação feita por cima, a
 * substituição é também o que permite mover uma parada de posição.
 *
 * Se a reinserção falhar, as paradas anteriores são RESTAURADAS: perder o
 * roteiro inteiro por uma falha de rede seria pior do que não salvar.
 */
export async function salvarViagem(
  companyId: string,
  year: number,
  viagemId: string,
  input: ViagemInput,
): Promise<{ ok?: true; custoTotal?: number; error?: string; needsMigration?: boolean }> {
  if (!viagemId) return { error: "Viagem inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const invalido = validarParaSalvar(input);
  if (invalido) return { error: invalido };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: atual, error: lerErr } = await supabase
    .from("orcamento_viagens")
    .select("id, setor_id, category_code, titulo, custo_total, tipo_id, updated_at")
    .eq("id", viagemId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (lerErr) {
    if (isSchemaMissing(lerErr.message)) return { needsMigration: true };
    return { error: lerErr.message };
  }
  if (!atual) return { error: "Viagem não encontrada." };

  const setorDaViagem = (atual.setor_id as string | null) ?? null;
  if (!podeEscreverNoSetor(auth.setores, setorDaViagem)) return { error: SEM_ACESSO_SETOR };

  // ── A CATEGORIA: resolvida pelo de-para a cada gravação ──
  // O tipo da tela vence o gravado (o gestor pode trocá-lo); sem tipo na tela,
  // vale o da viagem. Gravar RENOVA o retrato da categoria — é assim que uma
  // viagem passa a usar um de-para remapeado, e é ato explícito (ver
  // `desalinhadas` em tipos.ts): remapear sozinho não reclassifica nada.
  const tipos = await lerTipos(supabase, companyId, year);
  const tipoId = texto(input.tipoId) || ((atual.tipo_id as string | null) ?? "");
  const categoryCode = categoriaDoTipo(tipos, tipoId);
  if (!tipoId) return { error: "Escolha o tipo da viagem." };
  if (!categoryCode) {
    const nome = tipos.find((t) => t.id === tipoId)?.nome;
    return {
      error: `O tipo ${nome ? `"${nome}"` : "escolhido"} não tem categoria de despesa mapeada. Peça a um administrador para mapeá-lo, ou escolha outro tipo.`,
    };
  }

  // As travas valem sobre a categoria de ORIGEM e a de DESTINO: trocar o tipo não
  // pode ser caminho para escapar de uma fatia fechada nem de uma decisão.
  const codigosParaTravar = Array.from(
    new Set([(atual.category_code as string) ?? "", categoryCode]),
  );
  for (const code of codigosParaTravar) {
    if (!code) continue;
    const fechado = await travaDeFinalizacao({
      companyId,
      year,
      metodo: METODO,
      categoryCode: code,
      setorId: setorDaViagem,
    });
    if (fechado) return { error: fechado };
  }

  const travado = await travaDaValidacao({
    companyId,
    year,
    alvoTipo: "viagem",
    alvoId: viagemId,
    atualizadoEm: (atual.updated_at as string | null) ?? null,
    papel: auth.user.papel,
  });
  if (travado) return { error: travado };

  // ── O CUSTO: calculado aqui, nunca recebido da tela ──
  const { params } = await lerParametros(supabase, companyId, year);

  const paradasParaGravar = (input.paradas ?? []).map((p, i) => ({
    viagem_id: viagemId,
    ordem: i + 1,
    cidade: texto(p.cidade),
    noites: Math.max(0, Math.round(num(p.noites) ?? 0)),
    chegada_de: texto(p.chegadaDe),
    chegada_modal: modal(p.chegadaModal),
    chegada_distancia_km: num(p.chegadaDistanciaKm),
    chegada_preco_pessoa: num(p.chegadaPrecoPessoa),
    chegada_preco_total: num(p.chegadaPrecoTotal),
    chegada_pedagios: num(p.chegadaPedagios),
    chegada_veiculos: num(p.chegadaVeiculos),
    diaria_hotel: num(p.diariaHotel),
    local_trajetos_dia: num(p.localTrajetosDia),
    local_custo_trajeto: num(p.localCustoTrajeto),
    local_destino: texto(p.localDestino) || null,
    local_endereco: texto(p.localEndereco) || null,
  }));

  const outros = (input.outros ?? [])
    .map((o) => ({ descricao: texto(o.descricao) || "Outro custo", valor: num(o.valor) ?? 0 }))
    .filter((o) => o.valor !== 0);

  const cabecalho = {
    titulo: texto(input.titulo),
    tipo_id: tipoId,
    category_code: categoryCode,
    finalidade: texto(input.finalidade) || null,
    origem: texto(input.origem),
    data_ida: input.dataIda || null,
    pessoas: Math.max(1, Math.round(num(input.pessoas) ?? 1)),
    pessoas_por_quarto: Math.max(1, Math.round(num(input.pessoasPorQuarto) ?? 1)),
    translado_custo_trajeto: num(input.transladoCustoTrajeto),
    translado_trajetos: num(input.transladoTrajetos),
    volta_modal: input.voltaModal ? modal(input.voltaModal) : null,
    volta_distancia_km: num(input.voltaDistanciaKm),
    volta_preco_pessoa: num(input.voltaPrecoPessoa),
    volta_preco_total: num(input.voltaPrecoTotal),
    volta_pedagios: num(input.voltaPedagios),
    volta_veiculos: num(input.voltaVeiculos),
    outros,
  };

  // O motor lê a MESMA forma de linha que vai para o banco: assim o retrato
  // corresponde ao que ficou gravado, e não a uma segunda tradução dos campos.
  const spec = specDaViagem(cabecalho as unknown as Record<string, unknown>, paradasParaGravar);
  const resultado = calcularViagem(spec, params);
  const retrato = retratoParaGravar(resultado, params);

  // ── Paradas: guarda as atuais, substitui, restaura se a inserção falhar ──
  const { data: antigas } = await supabase
    .from("orcamento_viagem_paradas")
    .select(PARADA_COLS)
    .eq("viagem_id", viagemId)
    .order("ordem");

  const { error: delErr } = await supabase
    .from("orcamento_viagem_paradas")
    .delete()
    .eq("viagem_id", viagemId);
  if (delErr) return { error: delErr.message };

  if (paradasParaGravar.length > 0) {
    const { error: insErr } = await supabase
      .from("orcamento_viagem_paradas")
      .insert(paradasParaGravar);
    if (insErr) {
      // Devolve o roteiro anterior em vez de deixar a viagem sem paradas.
      const restaurar = ((antigas ?? []) as unknown as Array<Record<string, unknown>>).map(
        (p) => {
          const copia: Record<string, unknown> = { ...p, viagem_id: viagemId };
          delete copia.id;
          return copia;
        },
      );
      if (restaurar.length > 0) {
        await supabase.from("orcamento_viagem_paradas").insert(restaurar);
      }
      return { error: insErr.message };
    }
  }

  const { error: upErr } = await supabase
    .from("orcamento_viagens")
    .update({
      ...cabecalho,
      ...retrato,
      updated_at: new Date().toISOString(),
      updated_by: auth.user.userId,
    })
    .eq("id", viagemId);
  if (upErr) return { error: upErr.message };

  await registrarAlteracao({
    companyId,
    year,
    categoryCode,
    setorId: setorDaViagem,
    metodo: METODO,
    alvoTipo: "viagem",
    alvoId: viagemId,
    alvoRotulo: cabecalho.titulo,
    acao: "alterou",
    antes: { titulo: (atual.titulo as string) ?? "", custoTotal: num(atual.custo_total) ?? 0 },
    depois: { titulo: cabecalho.titulo, custoTotal: resultado.total },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true, custoTotal: resultado.total };
}

/**
 * Cria a viagem (rascunho) e devolve o id.
 *
 * A tela de montagem precisa de uma LINHA para pendurar paradas e conversa, e é
 * por isso que "Nova viagem" grava antes de abrir — um segmento de rota "nova"
 * colidiria com o uuid e obrigaria a tela a existir em dois estados.
 */
export async function criarViagem(
  companyId: string,
  year: number,
  input: { titulo: string; tipoId: string; setorId: string | null; origem?: string },
): Promise<{ id?: string; error?: string; needsMigration?: boolean }> {
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!texto(input.titulo)) return { error: "Dê um título à viagem." };
  if (!texto(input.tipoId)) return { error: "Escolha o tipo da viagem." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  // A CATEGORIA vem do de-para, nunca da tela: quem cadastra a viagem fala em
  // tipo, e qual conta da DRE isso é não é decisão dele.
  const tipos = await lerTipos(supabase, companyId, year);
  const categoryCode = categoriaDoTipo(tipos, input.tipoId);
  if (!categoryCode) {
    return {
      error:
        "Esse tipo de viagem ainda não tem categoria de despesa mapeada. " +
        "Peça a um administrador para mapeá-lo em Configuração › Tipos de viagem.",
    };
  }

  const alvo = await setorParaGravar(supabase, companyId, year, input.setorId, auth.user.userId);
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };

  const fechado = await travaDeFinalizacao({
    companyId,
    year,
    metodo: METODO,
    categoryCode,
    setorId: alvo.id,
  });
  if (fechado) return { error: fechado };

  const { data, error } = await supabase
    .from("orcamento_viagens")
    .insert({
      company_id: companyId,
      year,
      setor_id: alvo.id,
      tipo_id: texto(input.tipoId),
      category_code: categoryCode,
      titulo: texto(input.titulo),
      origem: texto(input.origem),
      created_by: auth.user.userId,
      updated_by: auth.user.userId,
    })
    .select("id")
    .maybeSingle();
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  await registrarAlteracao({
    companyId,
    year,
    categoryCode,
    setorId: alvo.id,
    metodo: METODO,
    alvoTipo: "viagem",
    alvoId: (data?.id as string) ?? null,
    alvoRotulo: texto(input.titulo),
    acao: "criou",
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { id: (data?.id as string) ?? undefined };
}

export async function removerViagem(
  companyId: string,
  year: number,
  viagemId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!viagemId) return { error: "Viagem inválida." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: atual } = await supabase
    .from("orcamento_viagens")
    .select("setor_id, category_code, titulo, custo_total, updated_at")
    .eq("id", viagemId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!atual) return { error: "Viagem não encontrada." };

  const setorDaViagem = (atual.setor_id as string | null) ?? null;
  if (!podeEscreverNoSetor(auth.setores, setorDaViagem)) return { error: SEM_ACESSO_SETOR };

  const fechado = await travaDeFinalizacao({
    companyId,
    year,
    metodo: METODO,
    categoryCode: (atual.category_code as string) ?? "",
    setorId: setorDaViagem,
  });
  if (fechado) return { error: fechado };

  const travado = await travaDaValidacao({
    companyId,
    year,
    alvoTipo: "viagem",
    alvoId: viagemId,
    atualizadoEm: (atual.updated_at as string | null) ?? null,
    papel: auth.user.papel,
  });
  if (travado) return { error: travado };

  // Paradas e conversa saem por ON DELETE CASCADE.
  const { error } = await supabase.from("orcamento_viagens").delete().eq("id", viagemId);
  if (error) return { error: error.message };

  await registrarAlteracao({
    companyId,
    year,
    categoryCode: (atual.category_code as string | null) ?? null,
    setorId: setorDaViagem,
    metodo: METODO,
    alvoTipo: "viagem",
    alvoId: viagemId,
    alvoRotulo: (atual.titulo as string) ?? null,
    acao: "excluiu",
    antes: { titulo: (atual.titulo as string) ?? "", custoTotal: num(atual.custo_total) ?? 0 },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * O solicitante dá a viagem por PRONTA: ela passa a contar na Prévia e entra na
 * fila do diretor.
 *
 * É aqui que o CONJUNTO é validado, e não a cada gravação. Sem data a viagem não
 * cai em mês nenhum (o orçamento é mensal), e com custo zero ela não acrescenta
 * nada ao número: nos dois casos o diretor receberia uma linha indecidível.
 */
export async function enviarViagem(
  companyId: string,
  year: number,
  viagemId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!viagemId) return { error: "Viagem inválida." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: atual } = await supabase
    .from("orcamento_viagens")
    .select("setor_id, category_code, titulo, data_ida, custo_total, status, updated_at")
    .eq("id", viagemId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!atual) return { error: "Viagem não encontrada." };

  const setorDaViagem = (atual.setor_id as string | null) ?? null;
  if (!podeEscreverNoSetor(auth.setores, setorDaViagem)) return { error: SEM_ACESSO_SETOR };

  const fechado = await travaDeFinalizacao({
    companyId,
    year,
    metodo: METODO,
    categoryCode: (atual.category_code as string) ?? "",
    setorId: setorDaViagem,
  });
  if (fechado) return { error: fechado };

  if (!atual.category_code) {
    return {
      error:
        "Esta viagem ainda não tem categoria: escolha o tipo e salve antes de enviar. " +
        "Sem categoria ela não entra em nenhuma conta da DRE.",
    };
  }
  if (!atual.data_ida) {
    return {
      error: "Informe a data de ida: sem ela a viagem não cai em nenhum mês do orçamento.",
    };
  }
  if ((num(atual.custo_total) ?? 0) <= 0) {
    return { error: "A viagem está com custo zero — complete o roteiro antes de enviar." };
  }

  const agora = new Date().toISOString();
  const { error } = await supabase
    .from("orcamento_viagens")
    .update({
      status: "enviada",
      enviada_em: agora,
      enviada_por: auth.user.userId,
      updated_at: agora,
      updated_by: auth.user.userId,
    })
    .eq("id", viagemId);
  if (error) return { error: error.message };

  await registrarAlteracao({
    companyId,
    year,
    categoryCode: (atual.category_code as string | null) ?? null,
    setorId: setorDaViagem,
    metodo: METODO,
    alvoTipo: "viagem",
    alvoId: viagemId,
    alvoRotulo: (atual.titulo as string) ?? null,
    acao: "solicitou",
    depois: { status: "enviada", custoTotal: num(atual.custo_total) ?? 0 },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/** Volta a viagem para rascunho — sai da Prévia e da fila do diretor. */
export async function reabrirViagem(
  companyId: string,
  year: number,
  viagemId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!viagemId) return { error: "Viagem inválida." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const { data: atual } = await supabase
    .from("orcamento_viagens")
    .select("setor_id, category_code, titulo, updated_at")
    .eq("id", viagemId)
    .eq("company_id", companyId)
    .eq("year", year)
    .maybeSingle();
  if (!atual) return { error: "Viagem não encontrada." };

  const setorDaViagem = (atual.setor_id as string | null) ?? null;
  if (!podeEscreverNoSetor(auth.setores, setorDaViagem)) return { error: SEM_ACESSO_SETOR };

  const fechado = await travaDeFinalizacao({
    companyId,
    year,
    metodo: METODO,
    categoryCode: (atual.category_code as string) ?? "",
    setorId: setorDaViagem,
  });
  if (fechado) return { error: fechado };

  // Viagem já decidida pela diretoria sai das mãos de quem monta: tirá-la da
  // Prévia depois do ✓ mudaria o número aprovado sem passar pelo diretor.
  const travado = await travaDaValidacao({
    companyId,
    year,
    alvoTipo: "viagem",
    alvoId: viagemId,
    atualizadoEm: (atual.updated_at as string | null) ?? null,
    papel: auth.user.papel,
  });
  if (travado) return { error: travado };

  const { error } = await supabase
    .from("orcamento_viagens")
    .update({
      status: "rascunho",
      updated_at: new Date().toISOString(),
      updated_by: auth.user.userId,
    })
    .eq("id", viagemId);
  if (error) return { error: error.message };

  await registrarAlteracao({
    companyId,
    year,
    categoryCode: (atual.category_code as string | null) ?? null,
    setorId: setorDaViagem,
    metodo: METODO,
    alvoTipo: "viagem",
    alvoId: viagemId,
    alvoRotulo: (atual.titulo as string) ?? null,
    acao: "reabriu",
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Parâmetros da estimativa — ADMIN-ONLY, pelo mesmo enquadramento dos encargos e
 * do plano de cargos: quanto vale o km e a diária é premissa da empresa, não
 * construção de quem solicita a viagem.
 *
 * Mudar um parâmetro NÃO mexe nas viagens já calculadas: cada uma guarda o
 * retrato com os parâmetros que usou, e recalcular é ato explícito (salvar a
 * viagem de novo). É o que impede o número aprovado de mudar sozinho.
 */
export async function salvarParametrosViagem(
  companyId: string,
  year: number,
  params: Partial<ParametrosViagem>,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // Valor ausente ou não positivo cai no padrão: parâmetro zerado faria a
  // estimativa devolver zero sem dizer por quê.
  const positivo = (v: unknown, padrao: number): number => {
    const x = num(v);
    return x != null && x > 0 ? x : padrao;
  };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { error } = await supabase.from("orcamento_viagem_parametros").upsert(
    {
      company_id: companyId,
      year,
      rs_por_km: positivo(params.rsPorKm, PARAMETROS_PADRAO.rsPorKm),
      preco_combustivel_litro: positivo(
        params.precoCombustivelLitro,
        PARAMETROS_PADRAO.precoCombustivelLitro,
      ),
      consumo_km_litro: positivo(params.consumoKmLitro, PARAMETROS_PADRAO.consumoKmLitro),
      tarifa_onibus_km: positivo(params.tarifaOnibusKm, PARAMETROS_PADRAO.tarifaOnibusKm),
      diaria_alimentacao: positivo(params.diariaAlimentacao, PARAMETROS_PADRAO.diariaAlimentacao),
      hotel_diaria_padrao: positivo(params.hotelDiariaPadrao, PARAMETROS_PADRAO.hotelDiariaPadrao),
      aviao_por_km_pessoa: positivo(params.aviaoPorKmPessoa, PARAMETROS_PADRAO.aviaoPorKmPessoa),
      updated_at: new Date().toISOString(),
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }

  revalidatePath(PATH);
  return { ok: true };
}
