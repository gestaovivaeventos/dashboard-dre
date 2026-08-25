"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";

// Edição manual da planilha previsto × realizado (ctrl_budget), por
// setor × tipo de despesa × mês. Alternativa ao upload — grava os mesmos dados.
export interface BudgetMonth {
  month: number; // 1..12
  amount: number; // orçado
  realized: number; // realizado
}

/** Carrega os 12 meses (orçado/realizado) de uma linha setor×tipo×ano. */
export async function getBudgetLine(
  sectorId: string,
  expenseTypeId: string,
  year: number,
): Promise<{ error: string } | { months: BudgetMonth[] }> {
  await requireCtrlRole("csc", "admin");
  if (!sectorId || !expenseTypeId) return { error: "Selecione setor e tipo de despesa." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("ctrl_budget")
    .select("period_month, amount, realized")
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", year);
  if (error) return { error: error.message };

  const byMonth = new Map<number, { amount: number; realized: number }>();
  for (const r of data ?? []) {
    byMonth.set(r.period_month, {
      amount: Number(r.amount ?? 0),
      realized: Number(r.realized ?? 0),
    });
  }
  const months: BudgetMonth[] = Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    const v = byMonth.get(m);
    return { month: m, amount: v?.amount ?? 0, realized: v?.realized ?? 0 };
  });
  return { months };
}

/**
 * Grava a linha: faz upsert dos meses com valor e remove os zerados (mantém a
 * tabela limpa, sem linha 0/0). Chave única (setor, tipo, ano, mês).
 */
export async function saveBudgetLine(
  sectorId: string,
  expenseTypeId: string,
  year: number,
  months: BudgetMonth[],
): Promise<{ error: string } | { ok: true }> {
  await requireCtrlRole("csc", "admin");
  if (!sectorId || !expenseTypeId) return { error: "Selecione setor e tipo de despesa." };
  const admin = createAdminClientIfAvailable();
  if (!admin) return { error: "Operação indisponível: credencial de serviço ausente." };

  const clean = (months ?? []).filter((m) => m.month >= 1 && m.month <= 12);
  const toUpsert = clean
    .filter((m) => m.amount !== 0 || m.realized !== 0)
    .map((m) => ({
      sector_id: sectorId,
      expense_type_id: expenseTypeId,
      period_year: year,
      period_month: m.month,
      amount: Math.abs(m.amount),
      realized: Math.abs(m.realized),
    }));
  const zeroMonths = clean
    .filter((m) => m.amount === 0 && m.realized === 0)
    .map((m) => m.month);

  if (toUpsert.length > 0) {
    const { error } = await admin
      .from("ctrl_budget")
      .upsert(toUpsert, { onConflict: "sector_id,expense_type_id,period_year,period_month" });
    if (error) return { error: error.message };
  }
  if (zeroMonths.length > 0) {
    const { error } = await admin
      .from("ctrl_budget")
      .delete()
      .eq("sector_id", sectorId)
      .eq("expense_type_id", expenseTypeId)
      .eq("period_year", year)
      .in("period_month", zeroMonths);
    if (error) return { error: error.message };
  }

  revalidatePath("/ctrl/orcamento");
  revalidatePath("/ctrl/orcamento/editar");
  return { ok: true as const };
}

// ─── Gerenciamento de linhas (setor × tipo) ───────────────────────────────────

export interface BudgetLineSummary {
  sector_id: string;
  sector_name: string;
  expense_type_id: string;
  expense_type_name: string;
  orcado: number; // soma anual
  realizado: number; // soma anual (base; o consumo das requisições é dinâmico)
}

/** Lista todas as linhas (setor × tipo) do ano com os totais anuais. */
export async function listBudgetLines(
  year: number,
): Promise<{ error: string } | { lines: BudgetLineSummary[] }> {
  await requireCtrlRole("csc", "admin");
  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const { data, error } = await supabase
    .from("ctrl_budget")
    .select("sector_id, expense_type_id, amount, realized, ctrl_sectors(name), ctrl_expense_types(name)")
    .eq("period_year", year);
  if (error) return { error: error.message };

  const map = new Map<string, BudgetLineSummary>();
  for (const r of data ?? []) {
    if (!r.sector_id || !r.expense_type_id) continue;
    const key = `${r.sector_id}|${r.expense_type_id}`;
    let e = map.get(key);
    if (!e) {
      const sec = Array.isArray(r.ctrl_sectors) ? r.ctrl_sectors[0] : r.ctrl_sectors;
      const typ = Array.isArray(r.ctrl_expense_types) ? r.ctrl_expense_types[0] : r.ctrl_expense_types;
      e = {
        sector_id: r.sector_id as string,
        sector_name: (sec as { name: string } | null)?.name ?? "Sem setor",
        expense_type_id: r.expense_type_id as string,
        expense_type_name: (typ as { name: string } | null)?.name ?? "Sem tipo",
        orcado: 0,
        realizado: 0,
      };
      map.set(key, e);
    }
    e.orcado += Number(r.amount ?? 0);
    e.realizado += Number(r.realized ?? 0);
  }
  const lines = Array.from(map.values()).sort(
    (a, b) =>
      a.sector_name.localeCompare(b.sector_name, "pt-BR", { sensitivity: "base" }) ||
      a.expense_type_name.localeCompare(b.expense_type_name, "pt-BR", { sensitivity: "base" }),
  );
  return { lines };
}

/** Exclui a linha inteira (12 meses) de um setor × tipo × ano. */
export async function deleteBudgetLine(
  sectorId: string,
  expenseTypeId: string,
  year: number,
): Promise<{ error: string } | { ok: true }> {
  // Editar Orçamento é uma tela do hub Configurações: admin + Contas a Pagar.
  await requireCtrlRole("contas_a_pagar", "admin");
  const admin = createAdminClientIfAvailable();
  if (!admin) return { error: "Operação indisponível: credencial de serviço ausente." };
  if (!sectorId || !expenseTypeId) return { error: "Linha inválida." };

  const { error } = await admin
    .from("ctrl_budget")
    .delete()
    .eq("sector_id", sectorId)
    .eq("expense_type_id", expenseTypeId)
    .eq("period_year", year);
  if (error) return { error: error.message };

  revalidatePath("/ctrl/orcamento");
  revalidatePath("/ctrl/orcamento/editar");
  return { ok: true as const };
}

/**
 * Move uma linha (setor × tipo) para outro setor e/ou tipo, no mesmo ano. Se o
 * destino já tiver uma linha daquele setor × tipo, os valores são SOMADOS mês a
 * mês (orçado e realizado) — vira uma linha só. A origem é removida.
 *
 * `moveRequests`: quando true, RE-ETIQUETA também as requisições de 1 setor desse
 * tipo (sector_id/expense_type_id da ORIGEM → DESTINO), para o realizado dinâmico
 * seguir junto. As requisições RATEADAS não são movidas automaticamente (o rateio
 * divide por setor e mover uma parcela pode colidir com outra do mesmo pedido) —
 * elas só são CONTADAS no retorno, para o usuário tratar à mão. Requisição já
 * lançada no Omie mantém o departamento do título antigo; só o vínculo de setor
 * (que rege o orçamento) muda — o realizado no orçamento passa a bater.
 */
export async function moveBudgetLine(
  from: { sectorId: string; expenseTypeId: string },
  to: { sectorId: string; expenseTypeId: string },
  year: number,
  opts: { moveRequests?: boolean } = {},
): Promise<
  { error: string } | { ok: true; merged: boolean; requestsMoved: number; rateioSkipped: number }
> {
  // Editar Orçamento é uma tela do hub Configurações: admin + Contas a Pagar.
  await requireCtrlRole("contas_a_pagar", "admin");
  const admin = createAdminClientIfAvailable();
  if (!admin) return { error: "Operação indisponível: credencial de serviço ausente." };
  if (!from.sectorId || !from.expenseTypeId || !to.sectorId || !to.expenseTypeId) {
    return { error: "Selecione a origem e o destino." };
  }
  if (from.sectorId === to.sectorId && from.expenseTypeId === to.expenseTypeId) {
    return { error: "O destino é igual à origem." };
  }

  const { data: src, error: srcErr } = await admin
    .from("ctrl_budget")
    .select("period_month, amount, realized")
    .eq("sector_id", from.sectorId)
    .eq("expense_type_id", from.expenseTypeId)
    .eq("period_year", year);
  if (srcErr) return { error: srcErr.message };
  if (!src || src.length === 0) return { error: "Linha de origem não encontrada." };

  const { data: dst, error: dstErr } = await admin
    .from("ctrl_budget")
    .select("period_month, amount, realized")
    .eq("sector_id", to.sectorId)
    .eq("expense_type_id", to.expenseTypeId)
    .eq("period_year", year);
  if (dstErr) return { error: dstErr.message };
  const merged = (dst?.length ?? 0) > 0;

  // Mescla por mês: destino existente + origem.
  const byMonth = new Map<number, { amount: number; realized: number }>();
  for (const r of dst ?? []) {
    byMonth.set(r.period_month, { amount: Number(r.amount ?? 0), realized: Number(r.realized ?? 0) });
  }
  for (const r of src) {
    const cur = byMonth.get(r.period_month) ?? { amount: 0, realized: 0 };
    byMonth.set(r.period_month, {
      amount: cur.amount + Number(r.amount ?? 0),
      realized: cur.realized + Number(r.realized ?? 0),
    });
  }
  const upserts = Array.from(byMonth.entries()).map(([month, v]) => ({
    sector_id: to.sectorId,
    expense_type_id: to.expenseTypeId,
    period_year: year,
    period_month: month,
    amount: v.amount,
    realized: v.realized,
  }));

  const { error: upErr } = await admin
    .from("ctrl_budget")
    .upsert(upserts, { onConflict: "sector_id,expense_type_id,period_year,period_month" });
  if (upErr) return { error: upErr.message };

  const { error: delErr } = await admin
    .from("ctrl_budget")
    .delete()
    .eq("sector_id", from.sectorId)
    .eq("expense_type_id", from.expenseTypeId)
    .eq("period_year", year);
  if (delErr) return { error: delErr.message };

  // Move também as requisições, para o realizado dinâmico seguir o novo setor/tipo.
  let requestsMoved = 0;
  let rateioSkipped = 0;
  if (opts.moveRequests) {
    // Requisições de 1 setor: re-etiqueta setor (+ tipo, se mudou). É o que o
    // orçamento soma como realizado/pendente daquele setor × tipo.
    const { data: moved, error: reqErr } = await admin
      .from("ctrl_requests")
      .update({
        sector_id: to.sectorId,
        expense_type_id: to.expenseTypeId,
        updated_at: new Date().toISOString(),
      })
      .eq("sector_id", from.sectorId)
      .eq("expense_type_id", from.expenseTypeId)
      .eq("is_rateio", false)
      .is("deleted_at", null)
      .select("id");
    if (reqErr) {
      return { error: `Orçamento movido, mas falhou ao mover as requisições: ${reqErr.message}` };
    }
    requestsMoved = moved?.length ?? 0;

    // Rateadas: só CONTA (não move — mover uma parcela poderia colidir com outra
    // parcela do mesmo pedido no setor de destino). O usuário trata essas à mão.
    const { data: rateio } = await admin
      .from("ctrl_request_sectors")
      .select("id, ctrl_requests!inner(expense_type_id, deleted_at)")
      .eq("sector_id", from.sectorId)
      .eq("ctrl_requests.expense_type_id", from.expenseTypeId)
      .is("ctrl_requests.deleted_at", null);
    rateioSkipped = rateio?.length ?? 0;
  }

  revalidatePath("/ctrl/orcamento");
  revalidatePath("/ctrl/orcamento/editar");
  revalidatePath("/ctrl/requisicoes");
  revalidatePath("/ctrl/aprovacoes");
  return { ok: true as const, merged, requestsMoved, rateioSkipped };
}
