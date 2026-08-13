// Geração/regeneração dos títulos do contrato Case (a pagar por atração e
// fornecedor + a receber no cronograma do cliente). Módulo puro (sem "use
// server") para ser usado tanto pelas server actions (stages.ts) quanto pelo
// lançamento no Omie (contract-launch.ts) e pelo webhook da ClickSign —
// contrato assinado sem título era lançado "no vazio" e virava status erro.

import type { SupabaseClient } from "@supabase/supabase-js";

import { cents } from "@/lib/case/parcelas";
import type { CaseParcelaInput } from "@/lib/case/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

interface AtracaoRow {
  id: string;
  band_id: string;
  attachment_path: string | null;
  valor_artista: number;
  pagar_schedule: CaseParcelaInput[] | null;
}

interface FornecedorRow {
  id: string;
  tipo: string;
  valor: number;
  pagar_schedule: CaseParcelaInput[] | null;
}

export interface ContractForAtracao {
  id: string;
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  valor_rider_camarim: number;
  receber_schedule: unknown;
  signed_at: string | null;
}

/** Carrega o contrato para as ações da aba Atração (sem bloqueio global). */
export async function loadContractForAtracao(
  db: DB,
  contractId: string,
): Promise<{ ok: true; contract: ContractForAtracao } | { ok: false; error: string }> {
  const { data: contract } = await db
    .from("case_contracts")
    .select("id, valor_atracao_cliente, valor_rider, valor_camarim, valor_extras, valor_rider_camarim, receber_schedule, signed_at")
    .eq("id", contractId)
    .single();
  if (!contract) return { ok: false, error: "Contrato não encontrado." };
  return { ok: true, contract: contract as ContractForAtracao };
}

/**
 * Recalcula os agregados do contrato e regenera os títulos POR ENTIDADE:
 * atrações/fornecedores já lançados no Omie ficam intocados (fluxo incremental
 * — o contrato assinado vai lançando despesas conforme são salvas); o restante
 * é regenerado. A receber = contrato inteiro no cronograma do cliente
 * (classificação custódia; o BV é apurado e rateado depois, no Financeiro).
 */
export async function recomputeContractTitles(
  db: DB,
  contract: ContractForAtracao,
): Promise<{ ok: true; totalArtista: number } | { error: string }> {
  const [{ data: atracoesData }, { data: fornecedoresData }, { data: titlesData }] = await Promise.all([
    db
      .from("case_contract_atracoes")
      .select("id, band_id, attachment_path, valor_artista, pagar_schedule")
      .eq("contract_id", contract.id)
      .order("created_at"),
    db
      .from("case_contract_fornecedores")
      .select("id, tipo, valor, pagar_schedule")
      .eq("contract_id", contract.id)
      .order("created_at"),
    db
      .from("case_titles")
      .select("id, status, leg, atracao_id, fornecedor_id")
      .eq("contract_id", contract.id),
  ]);
  const atracoes = (atracoesData ?? []) as AtracaoRow[];
  const fornecedores = (fornecedoresData ?? []) as FornecedorRow[];
  const existingTitles = (titlesData ?? []) as Array<{
    id: string;
    status: string;
    leg: string;
    atracao_id: string | null;
    fornecedor_id: string | null;
  }>;

  const totalArtista = atracoes.reduce((acc, a) => acc + (Number(a.valor_artista) || 0), 0);
  // Só os fornecedores da verba contam contra ela — comissões são despesas próprias.
  const totalFornecedores = fornecedores
    .filter((f) => (f.tipo ?? "rider_camarim") === "rider_camarim")
    .reduce((acc, f) => acc + (Number(f.valor) || 0), 0);
  const verba = Number(contract.valor_rider_camarim) || 0;
  const valorAtracao = Number(contract.valor_atracao_cliente) || 0;
  const valorRider = Number(contract.valor_rider) || 0;
  const valorCamarim = Number(contract.valor_camarim) || 0;
  const valorExtras = Number(contract.valor_extras) || 0;

  if (cents(totalArtista) + cents(verba) > cents(valorAtracao)) {
    return { error: `Atrações (R$ ${totalArtista.toFixed(2)}) + verba Rider/Camarim (R$ ${verba.toFixed(2)}) não podem passar do valor do contrato do cliente (R$ ${valorAtracao.toFixed(2)}).` };
  }
  if (cents(totalFornecedores) > cents(verba)) {
    return { error: `As parcelas de fornecedores Rider/Camarim (R$ ${totalFornecedores.toFixed(2)}) passam da verba (R$ ${verba.toFixed(2)}). Aumente a verba ou reduza os fornecedores.` };
  }

  // BV = contrato do cliente − atrações − verba Rider/Camarim (+ colunas legadas, hoje 0).
  const valorMargem = valorAtracao - totalArtista - verba;
  const valorServicos = valorMargem + valorRider + valorCamarim + valorExtras;
  const custodiaTotal = totalArtista + verba;
  const primeira = atracoes[0] ?? null;
  // Omie limita codigo_lancamento_integracao a 60 chars — usa o contrato encurtado.
  const c12 = contract.id.replace(/-/g, "").slice(0, 12);

  await db
    .from("case_contracts")
    .update({
      // band_id/attachment_path espelham a 1ª atração (compat telas/PDF/lista).
      band_id: primeira?.band_id ?? null,
      attachment_path: primeira?.attachment_path ?? null,
      valor_artista: totalArtista,
      valor_custodia: custodiaTotal,
      valor_margem: valorMargem,
      valor_servicos: valorServicos,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  // Entidades com título já LANÇADO no Omie ficam intocadas (títulos estáveis).
  const lockedAtracoes = new Set(existingTitles.filter((t) => t.status === "lancado" && t.atracao_id).map((t) => t.atracao_id!));
  const lockedFornecedores = new Set(existingTitles.filter((t) => t.status === "lancado" && t.fornecedor_id).map((t) => t.fornecedor_id!));
  const receberLocked = existingTitles.some((t) => t.leg !== "pagar_custodia" && t.status === "lancado");

  const deletableIds = existingTitles
    .filter((t) => {
      if (t.status === "lancado") return false;
      if (t.leg !== "pagar_custodia") return !receberLocked;
      if (t.atracao_id) return !lockedAtracoes.has(t.atracao_id);
      if (t.fornecedor_id) return !lockedFornecedores.has(t.fornecedor_id);
      return true; // órfão (entidade removida)
    })
    .map((t) => t.id);
  if (deletableIds.length > 0) {
    await db.from("case_titles").delete().in("id", deletableIds);
  }

  const titleRows: Array<Record<string, unknown>> = [];

  // A pagar: por atração (categoria custódia), com o cronograma próprio de cada uma.
  for (const a of atracoes) {
    if (lockedAtracoes.has(a.id)) continue;
    const parcelas = (a.pagar_schedule ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);
    if ((Number(a.valor_artista) || 0) <= 0 || parcelas.length === 0) continue;
    const shortId = a.id.slice(0, 8);
    parcelas.forEach((p, idx) => {
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id, atracao_id: a.id, leg: "pagar_custodia", parcela_numero: n, parcela_total: parcelas.length,
        vencimento: p.vencimento, valor: p.valor, codigo_integracao: `case-${c12}-pg-${shortId}-${n}`, status: "pendente",
      });
    });
  }

  // A pagar: fornecedores (verba Rider/Camarim e comissões), cada um com seu cronograma.
  for (const f of fornecedores) {
    if (lockedFornecedores.has(f.id)) continue;
    const parcelas = (f.pagar_schedule ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);
    if ((Number(f.valor) || 0) <= 0 || parcelas.length === 0) continue;
    const shortId = f.id.slice(0, 8);
    parcelas.forEach((p, idx) => {
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id, fornecedor_id: f.id, leg: "pagar_custodia", parcela_numero: n, parcela_total: parcelas.length,
        vencimento: p.vencimento, valor: p.valor, codigo_integracao: `case-${c12}-pf-${shortId}-${n}`, status: "pendente",
      });
    });
  }

  // A receber: o CONTRATO INTEIRO no cronograma do cliente, como custódia.
  // O BV é apurado no fim (recebido − saídas) e rateado por categoria no Omie.
  const receberSchedule = (contract.receber_schedule as CaseParcelaInput[] | null) ?? [];
  if (!receberLocked && receberSchedule.length > 0) {
    receberSchedule.forEach((p, idx) => {
      if (!p.vencimento || Number(p.valor) <= 0) return;
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id, leg: "receber_custodia", parcela_numero: n, parcela_total: receberSchedule.length,
        vencimento: p.vencimento, valor: Number(p.valor), codigo_integracao: `case-${c12}-rc-${n}`, status: "pendente",
      });
    });
  }

  if (titleRows.length > 0) {
    const { error } = await db.from("case_titles").insert(titleRows);
    if (error) return { error: `Falha ao gerar os títulos: ${error.message}` };
  }
  return { ok: true, totalArtista };
}

/**
 * Garante que o contrato tenha títulos: se não houver NENHUM, regenera a partir
 * do cronograma do cliente + atrações/fornecedores salvos. Usado como
 * self-healing antes do lançamento no Omie (webhook de assinatura e botão
 * Lançar no Omie).
 */
export async function ensureContractTitles(
  db: DB,
  contractId: string,
): Promise<{ ok: true } | { error: string }> {
  const { count } = await db
    .from("case_titles")
    .select("id", { count: "exact", head: true })
    .eq("contract_id", contractId);
  if (count && count > 0) return { ok: true };

  const loaded = await loadContractForAtracao(db, contractId);
  if (!loaded.ok) return { error: loaded.error };
  const rec = await recomputeContractTitles(db, loaded.contract);
  if ("error" in rec) return { error: rec.error };
  return { ok: true };
}
