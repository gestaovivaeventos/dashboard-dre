"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin, SEM_ACESSO_ADMIN } from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { reprocessBudgetEntriesForCompany } from "@/lib/budget/reprocess";
import { getPreviaOrcamento } from "@/lib/orcamento/actions/previa-orcamento";
import {
  ORCAMENTO_BUDGET_SOURCE,
  PREVIA_BUDGET_SOURCE,
  rotuloDaConta,
} from "@/lib/orcamento/previa-budget-labels";
import { SETOR_TODOS } from "@/lib/orcamento/setor-filtro";

/**
 * PUBLICAÇÃO do orçamento no Budget e Forecast — a saída do módulo.
 *
 * Até aqui só o Despesas com pessoal chegava ao Budget (`enviarPreviaParaOrcamento`,
 * `source='pessoal'`): média, valor fixo e planejamento ficavam dentro do módulo,
 * e o comparativo orçado × realizado não via a maior parte do orçamento.
 *
 * ── Por que NÃO grava budget_entries direto ────────────────────────────────
 * Porque `reprocessBudgetEntriesForCompany` APAGA `budget_entries` do ano e o
 * reconstrói a partir de `budget_uploads_raw`. Uma escrita direta seria destruída
 * no próximo upload de planilha (ou na próxima publicação do pessoal), em
 * silêncio. Então a publicação entra pelo mesmo caminho das planilhas.
 *
 * ── Por que o rótulo é DERIVADO da conta, e o mapeamento é automático ──────
 * O fluxo das planilhas é `label → budget_account_mappings → conta da DRE`, com
 * o mapeamento feito à mão. Repetir isso aqui exigiria mapear CADA categoria
 * outra vez — quando a Prévia já resolveu a conta usando `category_mapping`, o
 * mesmo mapeamento do Financeiro. Seriam dois cadastros para a mesma decisão, e
 * toda categoria sem o segundo cairia calada em `naoMapeados`.
 *
 * Então publicamos POR CONTA: um rótulo determinístico por conta da DRE que
 * recebeu valor, com `dre_account_id` já preenchido. O mapeamento passa a ser
 * artefato derivado, não trabalho de cadastro — e nada que a Prévia mostra pode
 * ficar fora do Budget.
 */

export interface PublicacaoResultado {
  /** Linhas cruas gravadas (conta × mês, sem zeros). */
  linhasGravadas: number;
  /** Contas distintas publicadas. */
  contas: number;
  /** Total anual de despesa publicado, para conferir contra a Prévia. */
  totalAno: number;
  /** Células gravadas em budget_entries pelo reprocessamento. */
  celulasOrcamento: number;
  /**
   * Existe orçamento de PLANILHA no mesmo ano. Os dois somam em
   * budget_entries — quem publica precisa saber, senão o Budget dobra sem
   * ninguém entender por quê.
   */
  conflitoComPlanilha: boolean;
}

export async function publicarOrcamentoNoBudget(
  companyId: string,
  year: number,
): Promise<{ resultado?: PublicacaoResultado; error?: string }> {
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // Publicar manda o orçamento para fora do módulo: é ato de admin.
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: SEM_ACESSO_ADMIN };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // A empresa INTEIRA (todos os setores): é o número que vai para a DRE.
  const previa = await getPreviaOrcamento(companyId, year, SETOR_TODOS);
  if (previa.error || !previa.data) {
    return { error: previa.error ?? "Não consegui calcular a prévia para publicar." };
  }

  // Só as FOLHAS de despesa: grupos são a soma dos filhos e as linhas
  // calculadas (4/6/8/11) são fórmulas sobre elas — publicar qualquer das duas
  // dobraria o orçamento.
  const folhas = previa.data.linhas.filter(
    (l) => !l.isCalculado && !l.hasChildren && !l.isReceita,
  );

  const rows: Array<{
    company_id: string;
    year: number;
    month: number;
    label: string;
    amount: number;
    source: string;
  }> = [];
  const mapeamentos = new Map<string, string>(); // rótulo → dre_account_id
  let totalAno = 0;

  for (const folha of folhas) {
    const label = rotuloDaConta(folha.code, folha.name);
    mapeamentos.set(label, folha.id);
    folha.meses.forEach((valor, i) => {
      const amount = Math.round(valor * 100) / 100;
      if (amount === 0) return;
      totalAno += amount;
      rows.push({
        company_id: companyId,
        year,
        month: i + 1,
        label,
        amount,
        source: ORCAMENTO_BUDGET_SOURCE,
      });
    });
  }

  if (rows.length === 0) {
    return { error: "Não há valor orçado para publicar nesta empresa neste ano." };
  }

  // Substitui a publicação anterior do MÓDULO. Inclui as linhas antigas de
  // `source='pessoal'`: a prévia completa já contém o pessoal, e deixar as duas
  // origens somaria a folha duas vezes.
  const { error: delErr } = await supabase
    .from("budget_uploads_raw")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .in("source", [ORCAMENTO_BUDGET_SOURCE, PREVIA_BUDGET_SOURCE]);
  if (delErr) return { error: delErr.message };

  const LOTE = 400;
  for (let i = 0; i < rows.length; i += LOTE) {
    const { error } = await supabase
      .from("budget_uploads_raw")
      .upsert(rows.slice(i, i + LOTE), {
        onConflict: "company_id,year,month,label,source",
      });
    if (error) return { error: error.message };
  }

  // Mapeamento derivado: o rótulo já nasce ligado à conta que a Prévia resolveu.
  // Upsert e não insert-if-missing: se a conta da categoria mudou no Mapeamento
  // do Financeiro, a publicação tem de acompanhar — senão o Budget ficaria preso
  // à conta antiga, divergindo da Prévia que o usuário acabou de ver.
  const mapRows = Array.from(mapeamentos.entries()).map(([label, dre_account_id]) => ({
    company_id: companyId,
    label,
    dre_account_id,
  }));
  const { error: mapErr } = await supabase
    .from("budget_account_mappings")
    .upsert(mapRows, { onConflict: "company_id,label" });
  if (mapErr) return { error: mapErr.message };

  // Planilha no mesmo ano: as duas origens somam. Avisa, não bloqueia — a
  // decisão de qual vale é do administrador.
  const { count: planilhaCount } = await supabase
    .from("budget_uploads_raw")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", "planilha");

  let celulasOrcamento = 0;
  try {
    const res = await reprocessBudgetEntriesForCompany(supabase, companyId, { years: [year] });
    celulasOrcamento = res.imported;
  } catch (erro) {
    return {
      error: erro instanceof Error ? erro.message : "Falha ao reprocessar o orçamento.",
    };
  }

  revalidatePath(`/orcamento/empresa/${companyId}/${year}`);
  revalidatePath("/budget-forecast");
  revalidatePath("/mapeamento");

  return {
    resultado: {
      linhasGravadas: rows.length,
      contas: mapeamentos.size,
      totalAno: Math.round(totalAno * 100) / 100,
      celulasOrcamento,
      conflitoComPlanilha: (planilhaCount ?? 0) > 0,
    },
  };
}
