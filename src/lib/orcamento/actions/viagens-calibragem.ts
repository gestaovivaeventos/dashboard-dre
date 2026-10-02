"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO_ADMIN, getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { numDaLinha as num, textoDaLinha as texto } from "@/lib/viagens/colunas";
import { buscarPrecos, mesAnoDoNumero, type TrechoParaCotar } from "@/lib/viagens/precos/buscar";
import { lerHistoricoParaCalculo } from "@/lib/orcamento/actions/viagens-historico";
import { faixaSugeridaDoHistorico } from "@/lib/viagens/historico";
import {
  mesDominante,
  pesoDasFaixas,
  propostaDaFaixa,
  rotasDaFaixa,
  type AmostraCalibragem,
  type FaixaParaCalibrar,
  type LinhaParaCalibrar,
  type PesoDaFaixa,
  type PropostaFaixa,
} from "@/lib/viagens/calibragem";

// =============================================================================
// CALIBRAR AS FAIXAS com a web — fase 4 (02/10/2026).
//
// ── A busca trabalha onde ela se paga ─────────────────────────────────────
// Cotar 50 viagens é 50 buscas de dezenas de segundos cada, com nada amortizando
// (os destinos quase não se repetem). Cotar as ~10 FAIXAS é 10 buscas que
// melhoram as 50 linhas de uma vez. É a inversão que torna a IA útil aqui.
//
// ── UMA faixa por requisição ──────────────────────────────────────────────
// Cada busca na web leva dezenas de segundos; dez numa requisição estourariam o
// teto de 300s da Vercel e perderiam o trabalho das nove que já voltaram. A tela
// chama faixa a faixa, em sequência, com barra de progresso — o padrão do Caixa.
//
// ── A PROPOSTA não se aplica sozinha ──────────────────────────────────────
// Esta action não escreve nada. Quem grava é `salvarFaixaViagem`, pelo clique do
// admin, faixa a faixa: a faixa é o número curado que a diretoria já viu em
// viagens aprovadas, e sobrescrevê-la calada mudaria o custo de todas as linhas
// que a leem — inclusive as validadas.
//
// ── O limite que a tela repete ────────────────────────────────────────────
// A tarifa do ano que vem NÃO EXISTE em lugar nenhum hoje. O que volta é o menor
// preço de HOJE para aquelas rotas naquele mês. É referência boa para uma faixa
// de orçamento; não é cotação.
// =============================================================================

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

/** Quantas rotas vão à busca por faixa. Três já dão mediana; cinco a estabilizam. */
const ROTAS_POR_FAIXA = 4;

/** Teto por faixa. Generoso: a busca na web leva dezenas de segundos. */
const TIMEOUT_MS = 120_000;

export interface CalibragemSetup {
  /** Uma linha por faixa, com o peso dela no orçamento e se vale a busca. */
  faixas: PesoDaFaixa[];
  /** As rotas que irão à busca de cada faixa, para a tela mostrar antes. */
  rotas: Record<string, string[]>;
  /** Mês que será pesquisado em cada faixa (`null` = nenhuma linha tem mês). */
  meses: Record<string, number | null>;
  /** Viagens lidas — zero significa "ninguém orçou ainda", não erro. */
  linhas: number;
  error?: string;
  needsMigration?: boolean;
}

const VAZIO: CalibragemSetup = { faixas: [], rotas: {}, meses: {}, linhas: 0 };

async function lerContexto(
  supabase: Supa,
  companyId: string,
  year: number,
): Promise<
  | { ok: true; faixas: FaixaParaCalibrar[]; linhas: LinhaParaCalibrar[]; origem: string }
  | { ok: false; error?: string; needsMigration?: boolean }
> {
  const { data: faixaRows, error: faixaErr } = await supabase
    .from("orcamento_viagem_faixas")
    .select("id, tipo, nome, valor, modal, ativo, ordem")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("ativo", true)
    .order("tipo")
    .order("ordem");
  if (faixaErr) {
    if (isSchemaMissing(faixaErr.message)) return { ok: false, needsMigration: true };
    return { ok: false, error: faixaErr.message };
  }

  const faixas: FaixaParaCalibrar[] = ((faixaRows ?? []) as Array<Record<string, unknown>>).map(
    (r) => ({
      id: r.id as string,
      tipo: r.tipo === "hospedagem" ? "hospedagem" : "passagem",
      nome: texto(r.nome),
      valor: num(r.valor) ?? 0,
      modal: texto(r.modal) || null,
    }),
  );

  // A EMPRESA INTEIRA, não o setor da tela: a faixa é cadastro da empresa, e o
  // peso dela tem de refletir todo o orçamento que a lê. Recortar por setor faria
  // o mesmo botão propor números diferentes conforme quem abre a tela.
  const { data: viagemRows, error: viagemErr } = await supabase
    .from("orcamento_viagens")
    .select("id, mes_ida, pessoas, origem, custo_total, faixa_passagem_id, faixa_hospedagem_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (viagemErr) {
    if (isSchemaMissing(viagemErr.message)) return { ok: false, needsMigration: true };
    return { ok: false, error: viagemErr.message };
  }
  const rows = (viagemRows ?? []) as Array<Record<string, unknown>>;

  const ids = rows.map((r) => r.id as string);
  const paradas = new Map<string, { cidade: string; noites: number }>();
  if (ids.length > 0) {
    const { data: pRows } = await supabase
      .from("orcamento_viagem_paradas")
      .select("viagem_id, ordem, cidade, noites")
      .in("viagem_id", ids)
      .order("ordem");
    for (const p of (pRows ?? []) as Array<Record<string, unknown>>) {
      const vid = p.viagem_id as string;
      if (paradas.has(vid)) continue;
      paradas.set(vid, { cidade: texto(p.cidade), noites: num(p.noites) ?? 0 });
    }
  }

  let origem = "";
  const linhas: LinhaParaCalibrar[] = rows.map((r) => {
    const p = paradas.get(r.id as string);
    if (!origem) origem = texto(r.origem);
    return {
      destino: p?.cidade ?? "",
      noites: p?.noites ?? 0,
      pessoas: num(r.pessoas) ?? 1,
      mesIda: num(r.mes_ida),
      faixaPassagemId: (r.faixa_passagem_id as string | null) ?? null,
      faixaHospedagemId: (r.faixa_hospedagem_id as string | null) ?? null,
      custoTotal: num(r.custo_total) ?? 0,
    };
  });

  return { ok: true, faixas, linhas, origem };
}

/**
 * O que a tela mostra ANTES de buscar: o peso de cada faixa e as rotas que irão
 * à pesquisa.
 *
 * Mostrar as rotas antes não é enfeite: é como o admin percebe que uma faixa está
 * recebendo destino que não é dela (um "Interior" com uma capital dentro) — e isso
 * se corrige na linha, não calibrando a faixa errada.
 */
export async function getCalibragemFaixas(
  companyId: string,
  year: number,
): Promise<CalibragemSetup> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { ...VAZIO, error: SEM_ACESSO_ADMIN };
  if (!companyId) return VAZIO;
  if (!isValidBudgetYear(year)) return { ...VAZIO, error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const ctx = await lerContexto(supabase, companyId, year);
  if (!ctx.ok) return { ...VAZIO, error: ctx.error, needsMigration: ctx.needsMigration };

  const rotas: Record<string, string[]> = {};
  const meses: Record<string, number | null> = {};
  for (const f of ctx.faixas) {
    rotas[f.id] = rotasDaFaixa(ctx.linhas, f, ROTAS_POR_FAIXA);
    meses[f.id] = mesDominante(ctx.linhas, f);
  }

  return {
    faixas: pesoDasFaixas(ctx.linhas, ctx.faixas),
    rotas,
    meses,
    linhas: ctx.linhas.length,
  };
}

export interface CalibrarFaixaResult {
  proposta?: PropostaFaixa;
  /** Rotas que foram à busca, para a tela dizer sobre o que é a mediana. */
  rotas?: string[];
  /** Mês pesquisado, já em texto. */
  quando?: string | null;
  /** A faixa não tem nenhuma viagem apontando para ela. */
  semRotas?: boolean;
  error?: string;
  needsMigration?: boolean;
}

/**
 * Pesquisa UMA faixa e devolve o valor sugerido.
 *
 * Carro e van não se cotam: ali o custo é km × R$/km, que vem dos parâmetros da
 * empresa — pesquisar passagem para uma faixa de carro devolveria um número que o
 * motor nem leria.
 */
export async function calibrarFaixaViagem(
  companyId: string,
  year: number,
  faixaId: string,
): Promise<CalibrarFaixaResult> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId || !faixaId) return { error: "Faixa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const ctx = await lerContexto(supabase, companyId, year);
  if (!ctx.ok) return { error: ctx.error, needsMigration: ctx.needsMigration };

  const faixa = ctx.faixas.find((f) => f.id === faixaId);
  if (!faixa) return { error: "Faixa não encontrada." };
  if (faixa.tipo === "passagem" && faixa.modal !== "aviao" && faixa.modal !== "onibus") {
    return {
      error:
        "Só faixa de avião ou ônibus se pesquisa. Em carro e van o custo é km × R$/km, dos parâmetros da empresa.",
    };
  }

  const rotas = rotasDaFaixa(ctx.linhas, faixa, ROTAS_POR_FAIXA);
  if (rotas.length === 0) {
    return {
      semRotas: true,
      error:
        "Nenhuma viagem aponta para esta faixa — sem destino, não há o que pesquisar. Monte as linhas na grade primeiro.",
    };
  }

  const mes = mesDominante(ctx.linhas, faixa);
  const quando = mesAnoDoNumero(mes, year);

  const trechos: TrechoParaCotar[] =
    faixa.tipo === "passagem"
      ? rotas.map((cidade, i) => ({
          id: `r${i}`,
          de: ctx.origem || "Juiz de Fora",
          para: cidade,
          modal: faixa.modal === "onibus" ? "onibus" : "aviao",
        }))
      : [];
  const cidades =
    faixa.tipo === "hospedagem" ? rotas.map((cidade) => ({ cidade, noites: 1 })) : [];

  const res = await buscarPrecos({ trechos, cidades, quando, timeoutMs: TIMEOUT_MS });
  if (!res.ok) return { error: res.error, rotas, quando };

  const amostras: AmostraCalibragem[] =
    faixa.tipo === "passagem"
      ? (res.data.trechos ?? []).map((t) => ({
          // O identificador volta copiado; a cidade sai dele, não do texto do
          // modelo — nome de cidade reescrito não casaria com a rota pedida.
          cidade: rotas[Number(String(t.id).replace(/[^0-9]/g, ""))] ?? String(t.id),
          valor: t.preco_por_pessoa,
          fonte: t.fonte ?? t.companhia ?? null,
        }))
      : (res.data.hoteis ?? []).map((h) => ({
          cidade: h.cidade,
          valor: h.diaria,
          fonte: h.fonte ?? h.hotel ?? null,
        }));

  return {
    proposta: propostaDaFaixa(faixa, amostras, res.fontes),
    rotas,
    quando,
  };
}

/**
 * Grava o valor sugerido NUMA faixa.
 *
 * Toca só a coluna `valor`, de propósito: `salvarFaixaViagem` reescreve a linha
 * inteira, e aceitar uma sugestão não pode ser o caminho para apagar o modal ou a
 * ordem da faixa por omissão de quem chamou.
 *
 * Não recalcula viagem nenhuma — cada uma guarda o retrato do cálculo que usou.
 * Adotar o número novo é abrir a grade e salvar a linha, que é o mesmo contrato
 * dos parâmetros da empresa.
 */
export async function aplicarValorDaFaixa(
  companyId: string,
  year: number,
  faixaId: string,
  valor: number,
): Promise<{ error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId || !faixaId) return { error: "Faixa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const v = num(valor);
  if (v == null || v <= 0) return { error: "O valor sugerido não é um número utilizável." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { error } = await supabase
    .from("orcamento_viagem_faixas")
    .update({ valor: v, updated_at: new Date().toISOString(), updated_by: admin.userId })
    .eq("id", faixaId)
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) {
    if (isSchemaMissing(error.message)) return { error: "Falta aplicar a migration das faixas." };
    return { error: error.message };
  }
  revalidatePath("/orcamento");
  return {};
}

export interface SugestaoDoHistorico {
  faixaId: string;
  nome: string;
  tipo: "passagem" | "hospedagem";
  valorAtual: number;
  valorSugerido: number;
  /** Os destinos observados que produziram o número — a tela os mostra. */
  destinos: string[];
}

export interface SugestoesHistoricoResult {
  sugestoes?: SugestaoDoHistorico[];
  /** Ano-base usado, para a tela dizer de quando é o número. */
  anoBase?: number;
  /** Faixas que nenhuma cidade com histórico alcança — essas seguem na web. */
  semHistorico?: string[];
  error?: string;
  needsMigration?: boolean;
}

/**
 * O valor de cada faixa, calculado a partir do HISTÓRICO das cidades dela.
 *
 * É o segundo uso do histórico e o que fecha o pedido do admin: ele não digita o
 * valor de dez faixas — cada faixa recebe a mediana das cidades que apontam para
 * ela e que têm viagem realizada, já reajustada.
 *
 * Não grava nada: devolve a proposta, e a tela aplica faixa a faixa pelo mesmo
 * `aplicarValorDaFaixa` da calibragem na web. Um botão que sobrescrevesse as dez
 * de uma vez mudaria o custo de todas as linhas sem ninguém ver o antes.
 */
export async function sugerirFaixasDoHistorico(
  companyId: string,
  year: number,
): Promise<SugestoesHistoricoResult> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const ctx = await lerContexto(supabase, companyId, year);
  if (!ctx.ok) return { error: ctx.error, needsMigration: ctx.needsMigration };

  const historico = await lerHistoricoParaCalculo(supabase, companyId, year);
  if (!historico) {
    return {
      error:
        "Não há histórico de viagens cadastrado. Suba a planilha em Configuração › Histórico de viagens.",
    };
  }

  const sugestoes: SugestaoDoHistorico[] = [];
  const semHistorico: string[] = [];

  for (const f of ctx.faixas) {
    // Carro e van não têm preço de passagem — ali o custo é km × R$/km.
    if (f.tipo === "passagem" && f.modal !== "aviao" && f.modal !== "onibus") continue;
    // Todas as cidades da faixa, não só as 4 que iriam à web: aqui não há custo
    // por observação, e mais destinos fazem a mediana regional melhor.
    const cidades = rotasDaFaixa(ctx.linhas, f, 999);
    const sug = faixaSugeridaDoHistorico(
      historico.refs,
      cidades,
      f.tipo,
      historico.anoBase,
      historico.reajustes,
    );
    if (!sug) {
      semHistorico.push(f.nome);
      continue;
    }
    sugestoes.push({
      faixaId: f.id,
      nome: f.nome,
      tipo: f.tipo,
      valorAtual: f.valor,
      valorSugerido: sug.valor,
      destinos: sug.destinos,
    });
  }

  return { sugestoes, anoBase: historico.anoBase, semHistorico };
}
