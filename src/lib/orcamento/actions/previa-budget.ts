"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { SETOR_TODOS } from "@/lib/orcamento/setor-filtro";
import { reprocessBudgetEntriesForCompany } from "@/lib/budget/reprocess";
import { PREVIA_BUDGET_SOURCE, rotuloOrcamento } from "@/lib/orcamento/previa-budget-labels";
import { getPrevia } from "@/lib/orcamento/actions/pessoal";

export interface EnvioBudgetResultado {
  /** Linhas cruas gravadas (mês × linha da prévia, sem os zeros). */
  linhasGravadas: number;
  /** Total anual publicado, para conferir contra a prévia na tela. */
  totalAno: number;
  /** Células gravadas em budget_entries após o reprocessamento. */
  celulasOrcamento: number;
  /** Rótulos ainda sem conta da DRE — não entram no orçamento enquanto isso. */
  naoMapeados: string[];
}

/**
 * Publica a prévia de Despesas com pessoal no orçamento da empresa no ano.
 *
 * Sempre a EMPRESA INTEIRA (todos os setores somados) — o filtro de setor da
 * tela não afeta o que é publicado, para o orçamento nunca sair pela metade.
 *
 * O caminho é o mesmo das planilhas de orçamento: grava as linhas em
 * budget_uploads_raw (com source='pessoal', para conviver com os uploads) e
 * chama o reprocessamento, que soma as duas origens contra o mapeamento
 * rótulo → conta da DRE e reconstrói budget_entries do ano. Quem lê o Budget e
 * Forecast não precisa saber que o módulo Orçamento existe.
 *
 * Rótulo ainda não mapeado não vira orçamento — volta na lista `naoMapeados`
 * para ser ligado em Mapeamento → Linhas do Orçamento.
 */
export async function enviarPreviaParaOrcamento(
  companyId: string,
  year: number,
): Promise<{ resultado?: EnvioBudgetResultado; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  // SETOR_TODOS explícito: o orçamento leva a empresa inteira, todos os setores.
  const previaRes = await getPrevia(companyId, year, { setorId: SETOR_TODOS });
  if (previaRes.needsMigration) return { needsMigration: true };
  if (previaRes.error || !previaRes.payload) {
    return { error: previaRes.error ?? "Não consegui calcular a prévia." };
  }
  const { previa, totalColaboradores } = previaRes.payload;
  if (totalColaboradores === 0) {
    return { error: "Não há colaboradores no quadro desta empresa neste ano." };
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());

  // Uma linha crua por (mês × linha da prévia). Zeros não são gravados: em
  // caixa, por exemplo, o 13º só existe em novembro e dezembro.
  const rows: {
    company_id: string;
    year: number;
    month: number;
    label: string;
    amount: number;
    source: string;
  }[] = [];
  for (const linha of previa.linhas) {
    const label = rotuloOrcamento(linha.label);
    linha.meses.forEach((valor, indice) => {
      const amount = Math.round(valor * 100) / 100;
      if (amount === 0) return;
      rows.push({
        company_id: companyId,
        year,
        month: indice + 1,
        label,
        amount,
        source: PREVIA_BUDGET_SOURCE,
      });
    });
  }

  // Substitui a publicação anterior desta empresa/ano — só as linhas do
  // pessoal, deixando intactas as que vieram de planilha.
  const { error: delError } = await supabase
    .from("budget_uploads_raw")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("source", PREVIA_BUDGET_SOURCE);
  if (delError) {
    if (/source|column/i.test(delError.message)) return { needsMigration: true };
    return { error: delError.message };
  }

  if (rows.length > 0) {
    const { error: insError } = await supabase
      .from("budget_uploads_raw")
      .upsert(rows, { onConflict: "company_id,year,month,label,source" });
    if (insError) return { error: insError.message };
  }

  // Cada rótulo precisa de uma linha em budget_account_mappings para APARECER em
  // Mapeamento → Linhas do Orçamento, mesmo antes de ter conta. Insere só os que
  // faltam, para nunca sobrescrever um mapeamento já feito.
  const labels = Array.from(new Set(rows.map((r) => r.label)));
  if (labels.length > 0) {
    const { data: existentes, error: exError } = await supabase
      .from("budget_account_mappings")
      .select("label")
      .eq("company_id", companyId)
      .in("label", labels);
    if (exError) return { error: exError.message };

    const jaTem = new Set((existentes ?? []).map((r) => r.label as string));
    const novos = labels
      .filter((label) => !jaTem.has(label))
      .map((label) => ({ company_id: companyId, label, dre_account_id: null }));
    if (novos.length > 0) {
      const { error: insLabelError } = await supabase
        .from("budget_account_mappings")
        .insert(novos);
      if (insLabelError) return { error: insLabelError.message };
    }
  }

  let celulasOrcamento = 0;
  let naoMapeados: string[] = [];
  try {
    const resultado = await reprocessBudgetEntriesForCompany(supabase, companyId, {
      years: [year],
    });
    celulasOrcamento = resultado.imported;
    // Só interessam os rótulos deste envio: linhas de planilha sem mapeamento
    // são assunto da tela de Mapeamento, não daqui.
    const meus = new Set(rows.map((r) => r.label));
    naoMapeados = resultado.unmappedLabels.filter((label) => meus.has(label));
  } catch (erro) {
    return { error: erro instanceof Error ? erro.message : "Falha ao reprocessar o orçamento." };
  }

  revalidatePath("/orcamento/despesas/pessoal");
  revalidatePath("/budget-forecast");
  revalidatePath("/mapeamento");

  return {
    resultado: {
      linhasGravadas: rows.length,
      totalAno: previa.totalAno,
      celulasOrcamento,
      naoMapeados,
    },
  };
}
