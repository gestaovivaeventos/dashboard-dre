"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarLeitura, getOrcamentoAdmin, SEM_ACESSO_ADMIN } from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { reprocessBudgetEntriesForCompany } from "@/lib/budget/reprocess";
import {
  getPreviaOrcamento,
  type PreviaDreLinha,
} from "@/lib/orcamento/actions/previa-orcamento";
import { rotuloDaConta } from "@/lib/orcamento/previa-budget-labels";
import { SETOR_TODOS } from "@/lib/orcamento/setor-filtro";
import { entraNoNumero } from "@/lib/orcamento/validacao-diretoria";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import {
  TRAVA_FINALIZADO,
  chaveFinalizacao,
  isMetodoFinalizavel,
  sourceFinalizacao,
  type AlvoFinalizacao,
  type Finalizacao,
} from "@/lib/orcamento/finalizacao";
import type { OrcamentoMetodo } from "@/lib/orcamento/metodos";

/**
 * FINALIZAR ORÇAMENTO — o fecho por (método × categoria × setor).
 *
 * Um clique do administrador faz duas coisas ao mesmo tempo, e é essa soma que
 * dá sentido ao botão: trava a fatia para TODO MUNDO (inclusive para ele) e
 * manda ao Budget do Financeiro o que a diretoria aprovou naquela fatia.
 *
 * ── Por que a publicação é por FATIA, e não a empresa inteira ──────────────
 * O publicador antigo apagava tudo do módulo e republicava — o que apagaria as
 * finalizações anteriores a cada clique. Aqui cada fatia tem uma `source`
 * determinística própria em `budget_uploads_raw`, e o `reprocess` do Financeiro
 * SOMA todas as sources. É isso que faz "cada finalização ir preenchendo" o
 * orçamento em vez de substituí-lo.
 *
 * ── Por que não grava `budget_entries` direto ──────────────────────────────
 * Mesma razão do publicador antigo: `reprocessBudgetEntriesForCompany` apaga e
 * reconstrói `budget_entries` do ano a partir de `budget_uploads_raw`. Escrita
 * direta seria destruída no próximo upload de planilha, em silêncio.
 */

const PATH = "/orcamento";

function db() {
  return createAdminClientIfAvailable();
}

function normalizarAlvo(alvo: AlvoFinalizacao): AlvoFinalizacao | null {
  if (!isMetodoFinalizavel(alvo.metodo)) return null;
  return {
    metodo: alvo.metodo,
    // O pessoal usa categoria vazia (a fatia é o quadro do setor inteiro).
    categoryCode: alvo.metodo === "pessoal" ? "" : (alvo.categoryCode ?? "").trim(),
    setorId: alvo.setorId ?? null,
  };
}

function lerLinha(r: Record<string, unknown>): Finalizacao {
  return {
    id: r.id as string,
    metodo: r.metodo as OrcamentoMetodo,
    categoryCode: (r.category_code as string) ?? "",
    setorId: (r.setor_id as string | null) ?? null,
    totalPublicado: Number(r.total_publicado ?? 0),
    itensPublicados: Number(r.itens_publicados ?? 0),
    itensFora: Number(r.itens_fora ?? 0),
    finalizadoEm: (r.finalizado_em as string) ?? "",
  };
}

/**
 * As fatias fechadas da empresa/ano.
 *
 * Leitura para QUALQUER usuário do módulo que alcance a empresa — o gestor
 * precisa ver que a fatia está fechada, senão ele digita e leva a recusa só ao
 * salvar. Quem FECHA é só o admin.
 *
 * Tabela ausente devolve lista vazia: a validação e a finalização não podem ser
 * o motivo de uma tela de construção parar de carregar.
 */
export async function getFinalizacoes(
  companyId: string,
  year: number,
): Promise<{ items: Finalizacao[]; error?: string }> {
  if (!companyId || !isValidBudgetYear(year)) return { items: [] };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { items: [], error: auth.error };

  const { data, error } = await supabase
    .from("orcamento_finalizacoes")
    .select("id, metodo, category_code, setor_id, total_publicado, itens_publicados, itens_fora, finalizado_em")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error) {
    if (isSchemaMissing(error.message)) return { items: [] };
    return { items: [], error: error.message };
  }
  return { items: ((data ?? []) as Array<Record<string, unknown>>).map(lerLinha) };
}

interface FatiaCalculada {
  /** conta da DRE → 12 meses aprovados. */
  porConta: Map<string, { code: string; name: string; meses: number[] }>;
  /** Abertura para o drilldown: conta × mês × nome da despesa. */
  detalhe: Array<{ dre_account_id: string; month: number; nome: string; valor: number }>;
  itensPublicados: number;
  itensFora: number;
  totalPublicado: number;
  /** Havia algo orçado na fatia, aprovado ou não? Distingue os dois erros. */
  havia: boolean;
}

/**
 * Monta a fatia a partir da MESMA Prévia que a tela mostra.
 *
 * Recorta pelos ITENS (cada um sabe o seu setor e o seu estado), e não pelo
 * `mesesAprovados` da fonte: aquele já vem somado de todos os setores do
 * escopo, e usá-lo publicaria o orçamento dos colegas junto.
 */
function montarFatia(linhas: readonly PreviaDreLinha[], alvo: AlvoFinalizacao): FatiaCalculada {
  const porConta = new Map<string, { code: string; name: string; meses: number[] }>();
  const detalhe: FatiaCalculada["detalhe"] = [];
  let itensPublicados = 0;
  let itensFora = 0;
  let totalPublicado = 0;
  let havia = false;

  for (const linha of linhas ?? []) {
    // SÓ AS FOLHAS: as linhas-resumo acumulam as fontes dos filhos, e varrer
    // todas contaria a mesma despesa na folha, no pai e no avô.
    if (linha.hasChildren || linha.isCalculado) continue;
    for (const fonte of linha.fontes) {
      if (fonte.metodo !== alvo.metodo) continue;
      if (fonte.categoryCode !== alvo.categoryCode) continue;
      for (const item of fonte.itens) {
        if ((item.setorId ?? null) !== alvo.setorId) continue;
        havia = true;
        const estado = item.estado ?? "pendente";
        if (!entraNoNumero(estado)) {
          itensFora += 1;
          continue;
        }
        itensPublicados += 1;
        const meses = item.meses ?? [];
        let alvoConta = porConta.get(linha.id);
        if (!alvoConta) {
          alvoConta = { code: linha.code, name: linha.name, meses: Array<number>(12).fill(0) };
          porConta.set(linha.id, alvoConta);
        }
        for (let m = 0; m < 12; m += 1) {
          const v = Number(meses[m] ?? 0);
          if (!Number.isFinite(v) || v === 0) continue;
          alvoConta.meses[m] += v;
          totalPublicado += v;
          detalhe.push({ dre_account_id: linha.id, month: m + 1, nome: item.nome, valor: v });
        }
      }
    }
  }

  return { porConta, detalhe, itensPublicados, itensFora, totalPublicado, havia };
}

export interface FinalizacaoResultado {
  totalPublicado: number;
  itensPublicados: number;
  itensFora: number;
  contas: number;
  linhasGravadas: number;
}

export async function finalizarFatia(params: {
  companyId: string;
  year: number;
  metodo: string;
  categoryCode?: string;
  setorId?: string | null;
  /** Só para a trilha: como a fatia se chama na tela. */
  rotulo?: string;
}): Promise<{ ok?: true; data?: FinalizacaoResultado; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { companyId, year } = params;
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const alvo = normalizarAlvo({
    metodo: params.metodo as OrcamentoMetodo,
    categoryCode: params.categoryCode ?? "",
    setorId: params.setorId ?? null,
  });
  if (!alvo) return { error: "Método inválido para finalização." };

  const supabase = db() ?? (await createClient());

  // A Prévia do escopo INTEIRO: o recorte por setor é feito item a item logo
  // abaixo, e pedi-la já filtrada esconderia o setor nulo em empresa que orça
  // por setor (são consultas diferentes, não um subconjunto).
  const previa = await getPreviaOrcamento(companyId, year, SETOR_TODOS);
  if (previa.needsMigration) return { needsMigration: true };
  if (previa.error || !previa.data) {
    return { error: previa.error ?? "Não consegui calcular a prévia para publicar." };
  }

  const fatia = montarFatia(previa.data.linhas, alvo);
  if (!fatia.havia) {
    return { error: "Não há nada orçado nesta categoria para este setor." };
  }
  if (fatia.itensPublicados === 0) {
    return {
      error:
        "Nada foi aprovado pela diretoria nesta categoria — só o aprovado vai para o Budget. " +
        "Aprove os itens na prévia do setor antes de finalizar.",
    };
  }

  const source = sourceFinalizacao(alvo);

  // Refinalizar sobrescreve a PRÓPRIA fatia: apaga por source, nunca por
  // empresa/ano. Apagar mais do que isto derrubaria as outras finalizações.
  const { error: delRaw } = await supabase
    .from("budget_uploads_raw")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", source);
  if (delRaw) {
    if (isSchemaMissing(delRaw.message)) return { needsMigration: true };
    return { error: delRaw.message };
  }
  await supabase
    .from("orcamento_budget_detalhe")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", source);

  const rows: Array<Record<string, unknown>> = [];
  const mapeamentos: Array<{ company_id: string; label: string; dre_account_id: string }> = [];
  for (const [accountId, conta] of Array.from(fatia.porConta.entries())) {
    const label = rotuloDaConta(conta.code, conta.name);
    mapeamentos.push({ company_id: companyId, label, dre_account_id: accountId });
    conta.meses.forEach((valor: number, i: number) => {
      const amount = Math.round(valor * 100) / 100;
      if (amount === 0) return;
      rows.push({ company_id: companyId, year, month: i + 1, label, amount, source });
    });
  }

  const LOTE = 400;
  for (let i = 0; i < rows.length; i += LOTE) {
    const { error } = await supabase
      .from("budget_uploads_raw")
      .upsert(rows.slice(i, i + LOTE), { onConflict: "company_id,year,month,label,source" });
    if (error) return { error: error.message };
  }

  // O rótulo já nasce ligado à conta que a Prévia resolveu — upsert porque a
  // conta da categoria pode ter mudado no Mapeamento do Financeiro.
  if (mapeamentos.length > 0) {
    const { error } = await supabase
      .from("budget_account_mappings")
      .upsert(mapeamentos, { onConflict: "company_id,label" });
    if (error) return { error: error.message };
  }

  // Abertura do drilldown. Fora de qualquer número do Financeiro — só leitura.
  const detalheRows = fatia.detalhe.map((d) => ({ company_id: companyId, year, source, ...d }));
  for (let i = 0; i < detalheRows.length; i += LOTE) {
    const { error } = await supabase
      .from("orcamento_budget_detalhe")
      .insert(detalheRows.slice(i, i + LOTE));
    if (error) {
      if (isSchemaMissing(error.message)) return { needsMigration: true };
      return { error: error.message };
    }
  }

  // A TRAVA. INSERT e não upsert: o índice é por expressão (setor nulo é
  // legítimo) e `ignoreDuplicates` não funciona sobre ele — 23505 aqui só pode
  // ser outra pessoa finalizando a mesma fatia no mesmo instante.
  const { error: insErr } = await supabase.from("orcamento_finalizacoes").insert({
    company_id: companyId,
    year,
    metodo: alvo.metodo,
    category_code: alvo.categoryCode,
    setor_id: alvo.setorId,
    total_publicado: Math.round(fatia.totalPublicado * 100) / 100,
    itens_publicados: fatia.itensPublicados,
    itens_fora: fatia.itensFora,
    finalizado_por: admin.userId,
  });
  if (insErr) {
    if (isSchemaMissing(insErr.message)) return { needsMigration: true };
    if (/duplicate key|unique/i.test(insErr.message)) {
      return { error: "Esta categoria acabou de ser finalizada por outra pessoa." };
    }
    return { error: insErr.message };
  }

  await reprocessBudgetEntriesForCompany(supabase, companyId, { years: [year] });

  await registrarAlteracao({
    companyId,
    year,
    setorId: alvo.setorId,
    metodo: alvo.metodo,
    alvoTipo: "finalizacao",
    alvoId: source,
    alvoRotulo: params.rotulo || alvo.categoryCode || alvo.metodo,
    acao: "finalizou",
    antes: null,
    depois: {
      total: fatia.totalPublicado,
      itens: fatia.itensPublicados,
      fora: fatia.itensFora,
    },
    autorId: admin.userId,
    autorPapel: "admin",
  });

  revalidatePath(PATH);
  return {
    ok: true,
    data: {
      totalPublicado: fatia.totalPublicado,
      itensPublicados: fatia.itensPublicados,
      itensFora: fatia.itensFora,
      contas: fatia.porConta.size,
      linhasGravadas: rows.length,
    },
  };
}

export async function reabrirFatia(params: {
  companyId: string;
  year: number;
  metodo: string;
  categoryCode?: string;
  setorId?: string | null;
  rotulo?: string;
}): Promise<{ ok?: true; error?: string }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };
  const { companyId, year } = params;
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const alvo = normalizarAlvo({
    metodo: params.metodo as OrcamentoMetodo,
    categoryCode: params.categoryCode ?? "",
    setorId: params.setorId ?? null,
  });
  if (!alvo) return { error: "Método inválido." };

  const supabase = db() ?? (await createClient());
  const source = sourceFinalizacao(alvo);

  // A ORDEM importa: primeiro solta a trava, depois desfaz a publicação. Se o
  // processo morresse no meio da ordem inversa, a fatia ficaria travada com o
  // Budget já limpo — e o admin não teria como reabrir o que já está aberto.
  const { error: delFim } = await supabase
    .from("orcamento_finalizacoes")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", alvo.metodo)
    .eq("category_code", alvo.categoryCode)
    .filter("setor_id", alvo.setorId ? "eq" : "is", alvo.setorId ?? null);
  if (delFim) {
    if (isSchemaMissing(delFim.message)) return { error: "Finalização não encontrada." };
    return { error: delFim.message };
  }

  const { error: delRaw } = await supabase
    .from("budget_uploads_raw")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", source);
  if (delRaw) return { error: delRaw.message };

  await supabase
    .from("orcamento_budget_detalhe")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", source);

  await reprocessBudgetEntriesForCompany(supabase, companyId, { years: [year] });

  await registrarAlteracao({
    companyId,
    year,
    setorId: alvo.setorId,
    metodo: alvo.metodo,
    alvoTipo: "finalizacao",
    alvoId: source,
    alvoRotulo: params.rotulo || alvo.categoryCode || alvo.metodo,
    acao: "reabriu",
    antes: null,
    depois: null,
    autorId: admin.userId,
    autorPapel: "admin",
  });

  revalidatePath(PATH);
  return { ok: true };
}

/**
 * A fatia desta escrita está finalizada? Devolve a recusa ou `null`.
 *
 * Chamada pelas actions de escrita dos quatro métodos, no mesmo lugar em que já
 * mora `travaDaValidacao` — e com uma diferença deliberada: aqui **admin e
 * diretoria NÃO passam**. Finalizar é um fecho, não uma alçada; quem precisa
 * mexer reabre antes, e aí o fecho fica visível na tela em vez de ser
 * contornado em silêncio.
 *
 * Tabela ausente (migration pendente) não trava nada: a finalização não pode
 * ser o motivo de o módulo parar de aceitar escrita.
 */
export async function travaDeFinalizacao(params: {
  companyId: string;
  year: number;
  metodo: string;
  categoryCode?: string;
  setorId?: string | null;
}): Promise<string | null> {
  const alvo = normalizarAlvo({
    metodo: params.metodo as OrcamentoMetodo,
    categoryCode: params.categoryCode ?? "",
    setorId: params.setorId ?? null,
  });
  if (!alvo || !params.companyId || !isValidBudgetYear(params.year)) return null;

  const supabase = db() ?? (await createClient());
  let q = supabase
    .from("orcamento_finalizacoes")
    .select("id")
    .eq("company_id", params.companyId)
    .eq("year", params.year)
    .eq("metodo", alvo.metodo)
    .eq("category_code", alvo.categoryCode);
  // `.eq(col, null)` vira `eq.null` no PostgREST e não casa com nada.
  q = alvo.setorId ? q.eq("setor_id", alvo.setorId) : q.is("setor_id", null);

  const { data, error } = await q.maybeSingle();
  if (error || !data) return null;
  return TRAVA_FINALIZADO;
}

/**
 * As chaves das fatias fechadas, para uma operação em LOTE saber o que pular.
 *
 * `recalcularTodasMedias` varre a empresa inteira: sem isto ela derrubaria a
 * operação por causa de uma categoria fechada, ou — pior — recalcularia por
 * cima do que já foi publicado. Com isto ela recalcula o resto e reporta
 * quantas pulou.
 */
export async function chavesFinalizadas(companyId: string, year: number): Promise<string[]> {
  if (!companyId || !isValidBudgetYear(year)) return [];
  const supabase = db() ?? (await createClient());
  const { data, error } = await supabase
    .from("orcamento_finalizacoes")
    .select("metodo, category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (error || !data) return [];
  return (data as Array<Record<string, unknown>>).map((r) =>
    chaveFinalizacao({
      metodo: r.metodo as OrcamentoMetodo,
      categoryCode: (r.category_code as string) ?? "",
      setorId: (r.setor_id as string | null) ?? null,
    }),
  );
}
