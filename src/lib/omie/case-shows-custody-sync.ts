// ============================================================================
// INGESTÃO DEDICADA — Custódia de Artistas por DATA DE REGISTRO (Case Shows)
// ============================================================================
// Alimenta a tabela case_shows_custody_competencia chamando ListarMovimentos da
// Omie filtrado por DATA DE REGISTRO (dDtRegDe/dDtRegAte), MÊS A MÊS — replicando
// exatamente o relatório que a antiga planilha do Google Sheets montava.
//
// ISOLAMENTO: usa o omieCall genérico (rate-limit/retry já prontos) e NÃO toca em
// nada do sync oficial (financial-processor, financial_entries, sync.ts). Só é
// chamada para a Case Shows. Faz delete+insert por empresa/anos sincronizados.
//
// VALOR: a Omie devolve vários valores por movimento (nValorMovCC, e em `resumo`
// nValLiquido/nValPago/nValAberto/nValTitulo). O campo correto (o que o relatório
// usa como "Valor da Conta") é confirmado via analyzeCaseShowsCustodyRegistration
// (dry-run) comparando com os números oficiais da Omie. A escolha entra como
// `valueField` no sync.

import type { SupabaseClient } from "@supabase/supabase-js";

import { omieCall } from "@/lib/omie/client";

const OMIE_MOV_FINANCEIRAS_URL = "https://app.omie.com.br/api/v1/financas/mf/";

export const CUSTODY_VALUE_FIELDS = ["movCC", "liquido", "pago", "aberto", "titulo"] as const;
export type CustodyValueField = (typeof CUSTODY_VALUE_FIELDS)[number];

// Campo confirmado contra o relatório oficial da Omie (bate à exatidão Jan–Mai
// 2026 nas 4 categorias): "titulo" = nValorTitulo (valor bruto do título), com
// rateio usando nDistrValor por porção.
export const DEFAULT_CUSTODY_VALUE_FIELD: CustodyValueField = "titulo";

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function toNum(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim()) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// Converte data da Omie ("dd/mm/yyyy") para ISO ("yyyy-mm-dd"). Devolve null se
// não reconhecer o formato (cai no fallback do primeiro dia do mês no sync).
function parseOmieDateToISO(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Metadados por movimento (compartilhados por todas as porções), para o detalhe
 *  por transação do drilldown. Mesmos campos que o financial-processor usa. */
interface RecordMeta {
  registrationDate: string | null;
  description: string | null;
  supplierCustomer: string | null;
  documentNumber: string | null;
  movementId: string | null;
}

function extractRecordMeta(record: Record<string, unknown>): RecordMeta {
  const detalhes = asObj(record.detalhes);
  const resumo = asObj(record.resumo);
  const merged = { ...resumo, ...detalhes, ...record };
  const str = (keys: string[]): string | null => {
    const v = pick(merged, keys);
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s === "" ? null : s;
  };
  return {
    registrationDate: parseOmieDateToISO(pick(merged, ["dDtRegistro"])),
    description:
      str(["cDescricao", "descricao", "cObs", "observacao"]),
    supplierCustomer: str([
      "cNomeCliente",
      "nome_cliente",
      "nome_fornecedor",
      "cNomeFornecedor",
    ]),
    documentNumber: str(["cNumDocFiscal", "cNumDocumento", "cNumParcela", "numero_documento"]),
    movementId: str(["nCodTitulo", "cNumTitulo", "nCodMovCC"]),
  };
}

function monthRange(year: number, month: number): { from: string; to: string } {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    from: `01/${pad2(month)}/${year}`,
    to: `${pad2(lastDay)}/${pad2(month)}/${year}`,
  };
}

function extractArray(resp: Record<string, unknown>): Record<string, unknown>[] {
  const candidates = Object.values(resp).filter(Array.isArray);
  return (candidates[0] as Record<string, unknown>[] | undefined) ?? [];
}

// Busca todas as páginas de ListarMovimentos de UM mês, filtrado por data de
// registro (dDtRegDe/dDtRegAte) — exatamente o filtro da planilha antiga.
async function fetchMovimentosByRegistrationMonth(
  appKey: string,
  appSecret: string,
  year: number,
  month: number,
): Promise<Record<string, unknown>[]> {
  const { from, to } = monthRange(year, month);
  const all: Record<string, unknown>[] = [];
  let page = 1;
  let totalPages = 1;
  while (page <= totalPages) {
    const { data } = await omieCall(
      OMIE_MOV_FINANCEIRAS_URL,
      "ListarMovimentos",
      appKey,
      appSecret,
      {
        nPagina: page,
        nRegPorPagina: 500,
        dDtRegDe: from,
        dDtRegAte: to,
        cExibirDepartamentos: "S",
        lDadosCad: "S",
      },
    );
    all.push(...extractArray(data));
    const tp = Number(data["nTotPaginas"] ?? data["total_de_paginas"] ?? 1);
    totalPages = Number.isFinite(tp) && tp >= 1 ? tp : page;
    page += 1;
  }
  return all;
}

interface Portion {
  code: string;
  /** Valor da porção sob cada campo candidato (já em magnitude positiva). */
  values: Record<CustodyValueField, number>;
}

// Extrai as porções de categoria de um movimento que pertencem às categorias da
// Custódia. Exclui baixas (BAXP/BAXR) para não duplicar. Trata rateio (array
// `categorias` na raiz): nesse caso o valor da categoria é o nDistrValor.
function extractPortions(
  record: Record<string, unknown>,
  candidateCodes: Set<string>,
): Portion[] {
  const detalhes = asObj(record.detalhes);
  const resumo = asObj(record.resumo);

  const cOrigem = String(pick(detalhes, ["cOrigem"]) ?? pick(record, ["cOrigem"]) ?? "").toUpperCase();
  if (cOrigem === "BAXP" || cOrigem === "BAXR") return [];

  // Títulos CANCELADOS não entram no relatório da Omie por data de registro
  // (ex.: títulos VENR cancelados e re-emitidos como MANR no mesmo mês). Somá-los
  // inflava o total — confirmado em jun/2026: 3 cancelados = R$ 71.000 a mais.
  const cStatus = String(pick(detalhes, ["cStatus"]) ?? pick(resumo, ["cStatus"]) ?? "").toUpperCase();
  if (cStatus === "CANCELADO") return [];

  const rateio = Array.isArray(record.categorias)
    ? (record.categorias as Record<string, unknown>[])
    : [];

  if (rateio.length > 0) {
    const out: Portion[] = [];
    for (const por of rateio) {
      const code = String(pick(por, ["cCodCateg"]) ?? "");
      if (!candidateCodes.has(code)) continue;
      const dist = Math.abs(toNum(pick(por, ["nDistrValor"])));
      out.push({
        code,
        values: { movCC: dist, liquido: dist, pago: dist, aberto: dist, titulo: dist },
      });
    }
    return out;
  }

  const code = String(pick(detalhes, ["cCodCateg"]) ?? pick(record, ["cCodCateg"]) ?? "");
  if (!candidateCodes.has(code)) return [];
  return [
    {
      code,
      values: {
        movCC: Math.abs(toNum(pick(detalhes, ["nValorMovCC"]))),
        liquido: Math.abs(toNum(pick(resumo, ["nValLiquido"]))),
        pago: Math.abs(toNum(pick(resumo, ["nValPago"]))),
        aberto: Math.abs(toNum(pick(resumo, ["nValAberto"]))),
        titulo: Math.abs(
          toNum(
            pick(resumo, ["nValTitulo", "nValBruto", "nValDocTotal", "nValMovto"]) ??
              pick(detalhes, ["nValorTitulo", "nValDocTotal"]),
          ),
        ),
      },
    },
  ];
}

function currentYearMonthUTC(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
}

function monthsToSync(yearFrom: number): Array<{ year: number; month: number }> {
  const { year: ty, month: tm } = currentYearMonthUTC();
  const out: Array<{ year: number; month: number }> = [];
  for (let y = yearFrom; y <= ty; y += 1) {
    const lastMonth = y === ty ? tm : 12;
    for (let m = 1; m <= lastMonth; m += 1) out.push({ year: y, month: m });
  }
  return out;
}

// ---------------------------------------------------------------------------
// DRY-RUN: soma por (campo candidato, categoria, mês) e devolve amostras cruas,
// para confirmar qual campo de valor reproduz o relatório oficial da Omie.
// ---------------------------------------------------------------------------
export interface CustodyAnalyzeResult {
  monthsFetched: number;
  totalRecords: number;
  // candidato -> categoria -> mês -> soma
  sumsByCandidate: Record<CustodyValueField, Record<string, Record<number, number>>>;
  sampleRecords: Array<{ detalhes: Record<string, unknown>; resumo: Record<string, unknown>; categorias: unknown }>;
}

export async function analyzeCaseShowsCustodyRegistration(params: {
  appKey: string;
  appSecret: string;
  categoryCodes: string[];
  yearFrom: number;
}): Promise<CustodyAnalyzeResult> {
  const { appKey, appSecret, categoryCodes, yearFrom } = params;
  const codeSet = new Set(categoryCodes);
  const months = monthsToSync(yearFrom);

  const sums = Object.fromEntries(
    CUSTODY_VALUE_FIELDS.map((f) => [f, {} as Record<string, Record<number, number>>]),
  ) as Record<CustodyValueField, Record<string, Record<number, number>>>;
  const samples: CustodyAnalyzeResult["sampleRecords"] = [];
  let totalRecords = 0;

  for (const { year, month } of months) {
    const records = await fetchMovimentosByRegistrationMonth(appKey, appSecret, year, month);
    totalRecords += records.length;
    for (const record of records) {
      const portions = extractPortions(record, codeSet);
      if (portions.length === 0) continue;
      if (samples.length < 4) {
        samples.push({
          detalhes: asObj(record.detalhes),
          resumo: asObj(record.resumo),
          categorias: record.categorias ?? null,
        });
      }
      for (const portion of portions) {
        for (const field of CUSTODY_VALUE_FIELDS) {
          const byCode = sums[field];
          const byMonth = (byCode[portion.code] ??= {});
          byMonth[month] = (byMonth[month] ?? 0) + portion.values[field];
        }
      }
    }
  }

  return { monthsFetched: months.length, totalRecords, sumsByCandidate: sums, sampleRecords: samples };
}

// ---------------------------------------------------------------------------
// SYNC real: agrega por (ano, mês, categoria) usando o campo escolhido e grava
// na tabela (delete+insert por empresa/anos sincronizados).
// ---------------------------------------------------------------------------
export async function syncCaseShowsCustodyCompetencia(params: {
  supabase: SupabaseClient;
  companyId: string;
  appKey: string;
  appSecret: string;
  categoryCodes: string[];
  /** code -> nome legível (opcional, só para auditoria/exibição). */
  categoryNames?: Map<string, string>;
  valueField: CustodyValueField;
  yearFrom: number;
}): Promise<{ rowsUpserted: number; monthsFetched: number; totalRecords: number }> {
  const { supabase, companyId, appKey, appSecret, categoryCodes, categoryNames, valueField, yearFrom } = params;
  const codeSet = new Set(categoryCodes);
  const months = monthsToSync(yearFrom);

  // (year-month-code) -> amount
  const agg = new Map<string, { year: number; month: number; code: string; amount: number }>();
  // Detalhe por transação (uma linha por porção) — alimenta o drilldown da seção.
  const entries: Array<{
    company_id: string;
    period_year: number;
    period_month: number;
    registration_date: string;
    category_code: string;
    category_name: string | null;
    description: string | null;
    supplier_customer: string | null;
    document_number: string | null;
    omie_movement_id: string | null;
    amount: number;
  }> = [];
  let totalRecords = 0;

  for (const { year, month } of months) {
    const records = await fetchMovimentosByRegistrationMonth(appKey, appSecret, year, month);
    totalRecords += records.length;
    const monthFirstDay = `${year}-${pad2(month)}-01`;
    for (const record of records) {
      const portions = extractPortions(record, codeSet);
      if (portions.length === 0) continue;
      const meta = extractRecordMeta(record);
      for (const portion of portions) {
        const amount = portion.values[valueField];
        const key = `${year}-${month}-${portion.code}`;
        const slot = agg.get(key) ?? { year, month, code: portion.code, amount: 0 };
        slot.amount += amount;
        agg.set(key, slot);
        if (amount !== 0) {
          entries.push({
            company_id: companyId,
            period_year: year,
            period_month: month,
            // A data de registro alimenta o filtro por intervalo do drilldown;
            // se a Omie não a devolver, cai no 1º dia do mês de busca (que já é
            // por data de registro), preservando a consistência com a célula.
            registration_date: meta.registrationDate ?? monthFirstDay,
            category_code: portion.code,
            category_name: categoryNames?.get(portion.code) ?? null,
            description: meta.description,
            supplier_customer: meta.supplierCustomer,
            document_number: meta.documentNumber,
            omie_movement_id: meta.movementId,
            amount,
          });
        }
      }
    }
  }

  const years = Array.from(new Set(months.map((m) => m.year)));
  // Espelho: limpa os anos sincronizados desta empresa e reinsere (agregado + detalhe).
  await supabase
    .from("case_shows_custody_competencia")
    .delete()
    .eq("company_id", companyId)
    .in("period_year", years);
  await supabase
    .from("case_shows_custody_competencia_entries")
    .delete()
    .eq("company_id", companyId)
    .in("period_year", years);

  const rows = Array.from(agg.values())
    .filter((r) => r.amount !== 0)
    .map((r) => ({
      company_id: companyId,
      period_year: r.year,
      period_month: r.month,
      category_code: r.code,
      category_name: categoryNames?.get(r.code) ?? null,
      amount: r.amount,
    }));

  if (rows.length > 0) {
    const { error } = await supabase.from("case_shows_custody_competencia").insert(rows);
    if (error) throw new Error(`Falha ao gravar competência da Custódia: ${error.message}`);
  }

  // Detalhe em chunks (pode ter centenas/milhares de linhas).
  for (let i = 0; i < entries.length; i += 500) {
    const chunk = entries.slice(i, i + 500);
    const { error } = await supabase
      .from("case_shows_custody_competencia_entries")
      .insert(chunk);
    if (error) throw new Error(`Falha ao gravar detalhe da Custódia (competência): ${error.message}`);
  }

  return { rowsUpserted: rows.length, monthsFetched: months.length, totalRecords };
}

// Resolve os códigos (e nomes) das categorias Omie da Custódia da empresa, a
// partir do de/para que alimenta as contas 6.2/6.3/6.4. Escopo da empresa tem
// prioridade sobre o global.
export async function resolveCustodyCategoryCodes(
  supabase: SupabaseClient,
  companyId: string,
): Promise<{ codes: string[]; names: Map<string, string> }> {
  const { data: accounts } = await supabase
    .from("cash_flow_accounts")
    .select("id,code,company_id")
    .in("code", ["6.2", "6.3", "6.4"]);
  const accountIds = ((accounts as Array<{ id: string; company_id: string | null }> | null) ?? [])
    .filter((a) => a.company_id === companyId || a.company_id === null)
    .map((a) => a.id);
  if (accountIds.length === 0) return { codes: [], names: new Map() };

  const { data: mappings } = await supabase
    .from("cash_flow_category_mappings")
    .select("omie_category_code,omie_category_name,company_id,cash_flow_account_id")
    .in("cash_flow_account_id", accountIds);

  const names = new Map<string, string>();
  const codes = Array.from(
    new Set(
      ((mappings as Array<{ omie_category_code: string; omie_category_name: string | null; company_id: string | null }> | null) ?? [])
        .filter((m) => m.company_id === companyId || m.company_id === null)
        .map((m) => {
          if (m.omie_category_name) names.set(m.omie_category_code, m.omie_category_name);
          return m.omie_category_code;
        }),
    ),
  );
  return { codes, names };
}

// Wrapper de alto nível: resolve categorias e grava a competência da Custódia
// para uma empresa. No-op seguro se não houver categorias mapeadas. Usado pelo
// endpoint e pelo hook best-effort do sync.
export async function runCaseShowsCustodyCompetenciaSync(params: {
  supabase: SupabaseClient;
  companyId: string;
  appKey: string;
  appSecret: string;
  valueField?: CustodyValueField;
  yearFrom?: number;
}): Promise<{ rowsUpserted: number; monthsFetched: number; totalRecords: number; categoryCodes: string[] }> {
  const { supabase, companyId, appKey, appSecret } = params;
  const { codes, names } = await resolveCustodyCategoryCodes(supabase, companyId);
  if (codes.length === 0) {
    return { rowsUpserted: 0, monthsFetched: 0, totalRecords: 0, categoryCodes: [] };
  }
  const result = await syncCaseShowsCustodyCompetencia({
    supabase,
    companyId,
    appKey,
    appSecret,
    categoryCodes: codes,
    categoryNames: names,
    valueField: params.valueField ?? DEFAULT_CUSTODY_VALUE_FIELD,
    yearFrom: params.yearFrom ?? COMPETENCIA_FLOOR_YEAR_INGESTION,
  });
  return { ...result, categoryCodes: codes };
}

// Piso de ingestão (mesma regra de produto da seção: só 2026+).
export const COMPETENCIA_FLOOR_YEAR_INGESTION = 2026;
