"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { SEM_ACESSO_ADMIN, autorizarLeitura, getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { numDaLinha as num, textoDaLinha as texto } from "@/lib/viagens/colunas";
import { GRUPOS_VIAGEM, type GrupoViagem } from "@/lib/viagens/custo/tipos";
import {
  alimentacaoSugerida,
  referenciasPorDestino,
  type ReajustesPorGrupo,
  type ReferenciaHistorico,
  type ViagemRealizada,
} from "@/lib/viagens/historico";

// =============================================================================
// HISTÓRICO DE VIAGENS — leitura, reajuste e as referências que o motor usa.
//
// ── A fonte de preço do módulo mudou de lugar ─────────────────────────────
// Era: o admin digita o valor de ~10 faixas. Virou: o admin sobe o que foi gasto
// em 2026 e digita ~4 percentuais. A razão é a reclamação dele, e ela estava
// certa — ele não TEM na cabeça quanto custa uma passagem para o Nordeste; ele tem
// a planilha do que foi pago.
//
// ── Precedência (a mesma do motor, resolvida AQUI) ───────────────────────
// preço digitado → km × R$/km (carro/van) → HISTÓRICO do destino + reajuste →
// FAIXA → zero com premissa. Quem escolhe entre histórico e faixa é o servidor,
// na hora de montar o retrato: o motor segue com UM slot de referência por grupo
// (ver `FaixaReferencia.origem`).
//
// ── O histórico é FATO, o reajuste é PREMISSA ────────────────────────────
// Tabelas separadas, e o custo unitário é derivado na LEITURA. É isso que permite
// trocar o reajuste sem reimportar nada, e corrigir a regra de normalização sem
// mexer no dado.
// =============================================================================

const PATH = "/orcamento";

type Supa = Awaited<ReturnType<typeof createClient>>;

function db() {
  return createAdminClientIfAvailable();
}

const HIST_COLS =
  "id, year, cidade, mes, pessoas, noites, pessoas_por_quarto, modal, custo_passagem, custo_hospedagem, custo_alimentacao, observacao";

/** Uma linha do histórico, como a tela a lista. */
export interface LinhaHistorico extends ViagemRealizada {
  id: string;
  anoBase: number;
  observacao: string | null;
}

/** Uma referência por destino, como a tela a mostra (já reajustada ou não). */
export interface DestinoHistorico {
  cidade: string;
  cidadeChave: string;
  passagemPorPessoa: number | null;
  diariaPorQuarto: number | null;
  alimentacaoPorPessoaDia: number | null;
  viagens: number;
  viagensPassagem: number;
  meses: number[];
}

export interface HistoricoSetup {
  /** Anos que existem no histórico desta empresa, do mais recente ao mais antigo. */
  anos: number[];
  /** Ano-base em uso (o escolhido em parâmetros, ou o mais recente). */
  anoBase: number | null;
  linhas: LinhaHistorico[];
  destinos: DestinoHistorico[];
  reajustes: ReajustesPorGrupo;
  /** Sugestão para o parâmetro de alimentação da empresa, do próprio histórico. */
  alimentacaoSugerida: number | null;
  isAdmin: boolean;
  error?: string;
  needsMigration?: boolean;
}

const VAZIO: HistoricoSetup = {
  anos: [],
  anoBase: null,
  linhas: [],
  destinos: [],
  reajustes: {},
  alimentacaoSugerida: null,
  isAdmin: false,
};

function linhaDaRow(r: Record<string, unknown>): LinhaHistorico {
  return {
    id: r.id as string,
    anoBase: num(r.year) ?? 0,
    cidade: texto(r.cidade),
    mes: num(r.mes),
    pessoas: num(r.pessoas) ?? 1,
    noites: num(r.noites) ?? 0,
    pessoasPorQuarto: num(r.pessoas_por_quarto),
    modal: texto(r.modal) || null,
    custoPassagem: num(r.custo_passagem),
    custoHospedagem: num(r.custo_hospedagem),
    custoAlimentacao: num(r.custo_alimentacao),
    observacao: texto(r.observacao) || null,
  };
}

function reajustesDasRows(rows: Array<Record<string, unknown>>): ReajustesPorGrupo {
  const out: ReajustesPorGrupo = {};
  for (const r of rows) {
    const g = texto(r.grupo) as GrupoViagem;
    if (!GRUPOS_VIAGEM.includes(g)) continue;
    out[g] = num(r.percentual) ?? 0;
  }
  return out;
}

/**
 * Tudo o que a tela do histórico precisa.
 *
 * Gate de LEITURA (não de admin): a grade de qualquer gestor depende do histórico
 * para mostrar o custo de cada linha, e a tela de configuração mostra `isAdmin`
 * para decidir o que é editável. Admin-only na leitura faria o gestor ver a viagem
 * cair na faixa sem entender por quê — o mesmo defeito que `getEncargos` teve.
 */
export async function getHistoricoViagens(
  companyId: string,
  year: number,
  anoBasePedido?: number | null,
): Promise<HistoricoSetup> {
  if (!companyId) return VAZIO;
  if (!isValidBudgetYear(year)) return { ...VAZIO, error: "Ano do orçamento inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { ...VAZIO, error: auth.error };

  const [histRes, reajRes, paramRes] = await Promise.all([
    supabase
      .from("orcamento_viagem_historico")
      .select(HIST_COLS)
      .eq("company_id", companyId)
      .order("year", { ascending: false })
      .order("cidade"),
    supabase
      .from("orcamento_viagem_reajuste")
      .select("grupo, percentual")
      .eq("company_id", companyId)
      .eq("year", year),
    supabase
      .from("orcamento_viagem_parametros")
      .select("historico_ano_base")
      .eq("company_id", companyId)
      .eq("year", year)
      .maybeSingle(),
  ]);

  if (histRes.error) {
    if (isSchemaMissing(histRes.error.message)) {
      return { ...VAZIO, isAdmin: auth.user.isAdmin, needsMigration: true };
    }
    return { ...VAZIO, isAdmin: auth.user.isAdmin, error: histRes.error.message };
  }

  const todas = ((histRes.data ?? []) as unknown as Array<Record<string, unknown>>).map(linhaDaRow);
  const anos = Array.from(new Set(todas.map((l) => l.anoBase))).sort((a, b) => b - a);

  // O ano-base: o que a tela pediu, senão o cadastrado em parâmetros, senão o mais
  // recente que existe. Nunca um ano sem dado — a tela mostraria "sem histórico"
  // tendo histórico, e o admin concluiria que a importação falhou.
  const cadastrado = num(paramRes.data?.historico_ano_base);
  const anoBase =
    (anoBasePedido && anos.includes(anoBasePedido) ? anoBasePedido : null) ??
    (cadastrado && anos.includes(cadastrado) ? cadastrado : null) ??
    anos[0] ??
    null;

  const linhas = anoBase == null ? [] : todas.filter((l) => l.anoBase === anoBase);
  const refs = referenciasPorDestino(linhas);
  const reajustes = reajustesDasRows(
    (reajRes.data ?? []) as Array<Record<string, unknown>>,
  );

  return {
    anos,
    anoBase,
    linhas,
    destinos: Array.from(refs.values()).sort((a, b) =>
      a.cidade.localeCompare(b.cidade, "pt-BR"),
    ),
    reajustes,
    alimentacaoSugerida: alimentacaoSugerida(refs, reajustes),
    isAdmin: auth.user.isAdmin,
  };
}

/** O histórico como o CÁLCULO o consome. `null` = não há o que aplicar. */
export interface HistoricoParaCalculo {
  anoBase: number;
  reajustes: ReajustesPorGrupo;
  refs: Map<string, ReferenciaHistorico>;
}

/**
 * Lê o histórico vigente para calcular custo — o par de `lerFaixasParaCalculo`.
 *
 * Degrada para `null` quando a tabela ainda não existe ou não há histórico: o
 * custo então vem da faixa, como antes. O histórico é uma MELHORA da estimativa,
 * nunca um pré-requisito para gravar viagem.
 */
export async function lerHistoricoParaCalculo(
  supabase: Supa,
  companyId: string,
  year: number,
): Promise<HistoricoParaCalculo | null> {
  const [paramRes, reajRes] = await Promise.all([
    supabase
      .from("orcamento_viagem_parametros")
      .select("historico_ano_base")
      .eq("company_id", companyId)
      .eq("year", year)
      .maybeSingle(),
    supabase
      .from("orcamento_viagem_reajuste")
      .select("grupo, percentual")
      .eq("company_id", companyId)
      .eq("year", year),
  ]);

  const { data, error } = await supabase
    .from("orcamento_viagem_historico")
    .select(HIST_COLS)
    .eq("company_id", companyId)
    .order("year", { ascending: false });
  if (error || !data || data.length === 0) return null;

  const todas = (data as unknown as Array<Record<string, unknown>>).map(linhaDaRow);
  const anos = Array.from(new Set(todas.map((l) => l.anoBase))).sort((a, b) => b - a);
  const cadastrado = num(paramRes.data?.historico_ano_base);
  const anoBase = (cadastrado && anos.includes(cadastrado) ? cadastrado : null) ?? anos[0];
  if (anoBase == null) return null;

  return {
    anoBase,
    reajustes: reajustesDasRows((reajRes.data ?? []) as Array<Record<string, unknown>>),
    refs: referenciasPorDestino(todas.filter((l) => l.anoBase === anoBase)),
  };
}

/** Grava o percentual de um grupo. Percentual é PERCENTUAL (8 = +8%). */
export async function setReajusteViagem(
  companyId: string,
  year: number,
  grupo: GrupoViagem,
  percentual: number,
): Promise<{ error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (!GRUPOS_VIAGEM.includes(grupo)) return { error: "Grupo de custo inválido." };
  const pct = num(percentual) ?? 0;
  // Teto de sanidade, como no reajuste do plano de cargos: o zero a mais digitado
  // multiplicaria o orçamento de viagens por dez.
  if (pct < -100 || pct > 300) {
    return { error: "O reajuste tem de ficar entre -100% e 300%." };
  }

  const supabase = (db() ?? (await createClient())) as Supa;
  // A chave é em colunas comuns (sem expressão), então o upsert funciona aqui.
  const { error } = await supabase
    .from("orcamento_viagem_reajuste")
    .upsert(
      {
        company_id: companyId,
        year,
        grupo,
        percentual: pct,
        updated_at: new Date().toISOString(),
        updated_by: admin.userId,
      },
      { onConflict: "company_id,year,grupo" },
    );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return {};
}

/** Escolhe qual ano do histórico vale para este orçamento. */
export async function setAnoBaseHistorico(
  companyId: string,
  year: number,
  anoBase: number | null,
): Promise<{ error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId) return { error: "Empresa inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  const base = anoBase == null ? null : Math.round(anoBase);
  if (base != null && (base < 2000 || base > year)) {
    return { error: "O ano-base precisa ser anterior ou igual ao ano do orçamento." };
  }

  const supabase = (db() ?? (await createClient())) as Supa;
  const { error } = await supabase
    .from("orcamento_viagem_parametros")
    .upsert(
      { company_id: companyId, year, historico_ano_base: base },
      { onConflict: "company_id,year" },
    );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return {};
}

/** Remove uma linha do histórico. Corrigir um lançamento errado é na linha. */
export async function removerLinhaHistorico(
  companyId: string,
  id: string,
): Promise<{ error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId || !id) return { error: "Linha inválida." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { error } = await supabase
    .from("orcamento_viagem_historico")
    .delete()
    .eq("id", id)
    .eq("company_id", companyId);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return {};
}

/** Apaga o histórico de um ano inteiro — é o caminho para subir a planilha de novo. */
export async function limparAnoHistorico(
  companyId: string,
  anoBase: number,
): Promise<{ error?: string; removidas?: number }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  if (!companyId || !anoBase) return { error: "Ano inválido." };

  const supabase = (db() ?? (await createClient())) as Supa;
  const { error, count } = await supabase
    .from("orcamento_viagem_historico")
    .delete({ count: "exact" })
    .eq("company_id", companyId)
    .eq("year", anoBase);
  if (error) return { error: error.message };
  revalidatePath(PATH);
  return { removidas: count ?? 0 };
}
