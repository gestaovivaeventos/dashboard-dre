import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { reprocessBudgetEntriesForCompany } from "@/lib/budget/reprocess";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: { companyId: string };
}

const MONTH_TOKENS: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3, "março": 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

// Labels that correspond to formula rows in the DRE (codes 4, 6, 8, 11) — they
// are recomputed by the DRE engine from the leaves, so importing them as raw
// values would double-count. Everything else is treated as a mapping candidate
// (group rows / sub-totals can simply be left unmapped on the mapping screen).
const SKIP_LABELS = new Set(
  [
    "Receita Liquida",
    "Receita Líquida",
    "LUCRO OPERACIONAL BRUTO",
    "Lucro Operacional Bruto",
    "Lucro ou Prejuizo Operacional",
    "Lucro ou Prejuízo Operacional",
    "Resultado do Exercicio",
    "Resultado do Exercício",
  ].map((s) => normalize(s)),
);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return null;
    return Math.abs(raw);
  }
  const text = String(raw).trim();
  if (!text || text === "-") return null;
  // Strip currency symbols, spaces, parentheses and any leading/trailing dashes;
  // we ingest the magnitude only — DRE formulas (1+2-3, 4-5, 6-7, ...) already
  // encode the sign via the operator, mirroring the Dashboard DRE behavior.
  const body = text.replace(/[R$\s()]/g, "").replace(/-+$/g, "").replace(/^-+/g, "");
  if (!body) return null;
  let num: number;
  if (body.includes(",")) {
    num = Number(body.replace(/\./g, "").replace(",", "."));
  } else {
    num = Number(body);
  }
  if (!Number.isFinite(num)) return null;
  return Math.abs(num);
}

interface ParsedRow {
  label: string;
  values: Record<number, number>; // month -> amount
}

function parseSheet(
  sheet: XLSX.WorkSheet,
  // Nomes (normalizados) das contas-resumo do plano DRE da empresa. Servem para
  // detectar as linhas de GRUPO da planilha (ex.: "Despesas com Imoveis
  // Locados") e, assim, diferenciar itens de mesmo nome que aparecem em grupos
  // diferentes (ex.: "TERRAZZO" como receita e como despesa na SGX).
  summaryNames: Set<string>,
): { rows: ParsedRow[]; warnings: string[] } {
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  const warnings: string[] = [];

  // Find the row that contains the month headers (Jan..Dez)
  let headerRowIdx = -1;
  let monthCols: Record<number, number> = {}; // colIndex -> month number

  for (let i = 0; i < Math.min(data.length, 25); i += 1) {
    const row = data[i] ?? [];
    const candidate: Record<number, number> = {};
    let hits = 0;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell == null) continue;
      const norm = normalize(String(cell));
      const month = MONTH_TOKENS[norm];
      if (month) {
        candidate[c] = month;
        hits += 1;
      }
    }
    if (hits >= 6) {
      headerRowIdx = i;
      monthCols = candidate;
      break;
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(
      "Nao foi possivel encontrar o cabecalho de meses (JANEIRO..DEZEMBRO) na planilha.",
    );
  }

  // Determine label column: first column to the LEFT of the leftmost month column
  const monthColIndices = Object.keys(monthCols).map(Number).sort((a, b) => a - b);
  const firstMonthCol = monthColIndices[0];
  const labelCol = firstMonthCol > 0 ? 0 : -1;
  if (labelCol === -1) {
    throw new Error("Nao foi possivel localizar a coluna de nome das contas.");
  }

  // 1a passada: coleta cada linha com o GRUPO a que pertence. Uma linha cujo
  // nome bate com uma conta-resumo do plano vira o "grupo corrente"; as linhas
  // seguintes (itens) herdam esse grupo. Nao filtramos linhas vazias aqui — a
  // deteccao de colisao precisa enxergar TODAS as ocorrencias para ficar
  // estavel (independente de quais meses tem valor).
  interface RawEntry {
    label: string;
    group: string | null;
    values: Record<number, number>;
    hasAny: boolean;
  }
  const entries: RawEntry[] = [];
  let currentGroup: string | null = null;

  for (let i = headerRowIdx + 1; i < data.length; i += 1) {
    const raw = data[i] ?? [];
    const labelCell = raw[labelCol];
    if (labelCell == null) continue;
    const label = String(labelCell).trim();
    if (!label) continue;

    // Skip rows that are aggregations / known totals
    const norm = normalize(label);
    if (SKIP_LABELS.has(norm)) continue;
    // NOTA: aqui existia uma heuristica que pulava linhas em CAIXA ALTA com
    // 2+ palavras e >=10 letras (supostos cabecalhos visuais). Ela foi
    // REMOVIDA porque descartava contas-folha legitimas que sao escritas em
    // maiusculas — ex.: na SGX "PREDIO SAO PEDRO", "CASA SANTA LUZIA -
    // TORREOES 196", "EMPREENDIMENTO GRAMINHA"/"...MARABO"/etc., "LOTEAMENTO
    // BARBACENA", "TAMISA BOM PASTOR", "JARDIM DAS ACACIAS" — fazendo essas
    // linhas (e suas repeticoes receita/despesa) simplesmente sumirem do
    // Mapeamento. Os cabecalhos/totais reais ja sao tratados de forma
    // confiavel por SKIP_LABELS (totais de formula) + summaryNames (linhas de
    // grupo do plano) + o filtro de linhas sem valor (`hasAny`) mais abaixo.
    // Verificado em todos os orcamentos 2026: a unica linha ALLCAPS das demais
    // empresas e "LUCRO OPERACIONAL BRUTO", ja coberta por SKIP_LABELS — logo
    // remover a heuristica nao afeta nenhuma outra empresa.

    const values: Record<number, number> = {};
    let hasAny = false;
    for (const col of monthColIndices) {
      const month = monthCols[col];
      const parsed = parseAmount(raw[col]);
      if (parsed != null && parsed !== 0) {
        values[month] = parsed;
        hasAny = true;
      }
    }

    // Linha de grupo (conta-resumo do plano): atualiza o grupo corrente e e
    // emitida como rotulo "solto" (sem grupo) — segue aparecendo no Mapeamento
    // como nao mapeada, igual antes.
    if (summaryNames.has(norm)) {
      currentGroup = label;
      entries.push({ label, group: null, values, hasAny });
      continue;
    }

    entries.push({ label, group: currentGroup, values, hasAny });
  }

  // Detecta colisoes: o MESMO nome de item sob 2+ grupos distintos. A chave e
  // NORMALIZADA (ignora acento/espaco/maiusculas) para pegar grafias levemente
  // diferentes do mesmo item entre os grupos (ex.: "PREDIO" vs "PRÉDIO").
  const groupsByLabel = new Map<string, Set<string>>();
  entries.forEach((e) => {
    if (e.group == null) return;
    const key = normalize(e.label);
    const set = groupsByLabel.get(key) ?? new Set<string>();
    set.add(e.group);
    groupsByLabel.set(key, set);
  });

  // 2a passada: monta as linhas finais. So os nomes que colidem recebem o
  // prefixo do grupo — nomes unicos (e outras empresas) ficam IDENTICOS. O
  // rotulo final preserva a grafia original da propria ocorrencia.
  const disambiguated = new Set<string>();
  const rows: ParsedRow[] = [];
  entries.forEach((e) => {
    if (!e.hasAny) return; // mantem o comportamento: linha sem valores nao entra
    const collides = e.group != null && (groupsByLabel.get(normalize(e.label))?.size ?? 0) > 1;
    const finalLabel = collides ? `${e.group} - ${e.label}` : e.label;
    if (collides) disambiguated.add(e.label);
    rows.push({ label: finalLabel, values: e.values });
  });

  if (disambiguated.size > 0) {
    warnings.push(
      `Nomes repetidos em grupos diferentes foram diferenciados pelo grupo: ${Array.from(disambiguated).join(", ")}.`,
    );
  }

  return { rows, warnings };
}

export async function POST(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode enviar orcamentos." }, { status: 403 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const companyId = params.companyId;

  const { data: company, error: companyErr } = await db
    .from("companies")
    .select("id,name")
    .eq("id", companyId)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const yearRaw = formData.get("year");
  if (!file) return NextResponse.json({ error: "Envie um arquivo .xlsx." }, { status: 400 });
  const year = Number(yearRaw);
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json(
      { error: "Informe um ano valido (ex: 2026)." },
      { status: 400 },
    );
  }

  let workbook: XLSX.WorkBook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = XLSX.read(buffer, { type: "array" });
  } catch (error) {
    return NextResponse.json(
      { error: `Falha ao ler o arquivo: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    return NextResponse.json({ error: "Planilha sem abas." }, { status: 400 });
  }
  const sheet = workbook.Sheets[sheetName];

  // Nomes das contas-resumo (is_summary) do plano da empresa (ou global). Sao
  // os marcadores de GRUPO usados para diferenciar itens de mesmo nome (ex.:
  // SGX tem "TERRAZZO" em receita e em despesa).
  const { data: summaryAccounts } = await db
    .from("dre_accounts")
    .select("name")
    .eq("active", true)
    .eq("is_summary", true)
    .or(`company_id.eq.${companyId},company_id.is.null`);
  const summaryNames = new Set(
    ((summaryAccounts ?? []) as Array<{ name: string }>).map((a) => normalize(a.name)),
  );

  let parsed: { rows: ParsedRow[]; warnings: string[] };
  try {
    parsed = parseSheet(sheet, summaryNames);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha valida encontrada na planilha." },
      { status: 400 },
    );
  }

  // Replace any existing raw rows for this (company, year) to keep the upload idempotent.
  const { error: deleteErr } = await db
    .from("budget_uploads_raw")
    .delete()
    .eq("company_id", companyId)
    .eq("year", year);
  if (deleteErr) {
    return NextResponse.json(
      { error: `Falha ao limpar uploads anteriores: ${deleteErr.message}` },
      { status: 400 },
    );
  }

  // Agrega por (mes, label) somando — alem de evitar o erro do Postgres
  // "ON CONFLICT DO UPDATE cannot affect row a second time" (que so ocorreria
  // se restasse alguma colisao apos a desambiguacao por grupo), garante 1 linha
  // por chave unica (company_id, year, month, label).
  const rawByKey = new Map<
    string,
    { company_id: string; year: number; month: number; label: string; amount: number }
  >();
  parsed.rows.forEach((row) => {
    Object.entries(row.values).forEach(([monthStr, amount]) => {
      const month = Number(monthStr);
      const key = `${month} ${row.label}`;
      const existing = rawByKey.get(key);
      if (existing) {
        existing.amount += amount;
      } else {
        rawByKey.set(key, { company_id: companyId, year, month, label: row.label, amount });
      }
    });
  });
  const rawInserts = Array.from(rawByKey.values());

  const batchSize = 500;
  for (let i = 0; i < rawInserts.length; i += batchSize) {
    const batch = rawInserts.slice(i, i + batchSize);
    const { error: insertErr } = await db
      .from("budget_uploads_raw")
      .upsert(batch, { onConflict: "company_id,year,month,label" });
    if (insertErr) {
      return NextResponse.json(
        { error: `Falha ao gravar uploads brutos: ${insertErr.message}` },
        { status: 400 },
      );
    }
  }

  // Ensure each distinct label has a row in budget_account_mappings (so it shows
  // up in the mapping screen even before the user maps it).
  const distinctLabels = Array.from(new Set(parsed.rows.map((r) => r.label)));
  if (distinctLabels.length > 0) {
    const labelRows = distinctLabels.map((label) => ({
      company_id: companyId,
      label,
      dre_account_id: null,
    }));
    // Use ON CONFLICT DO NOTHING semantics: upsert without overwriting dre_account_id.
    // We achieve that with a select-then-insert pass.
    const { data: existing } = await db
      .from("budget_account_mappings")
      .select("label")
      .eq("company_id", companyId)
      .in("label", distinctLabels);
    const existingSet = new Set(((existing ?? []) as Array<{ label: string }>).map((r) => r.label));
    const toInsert = labelRows.filter((r) => !existingSet.has(r.label));
    if (toInsert.length > 0) {
      const { error: insertLabelErr } = await db
        .from("budget_account_mappings")
        .insert(toInsert);
      if (insertLabelErr) {
        return NextResponse.json(
          { error: `Falha ao registrar labels: ${insertLabelErr.message}` },
          { status: 400 },
        );
      }
    }
  }

  // Re-apply the (label -> dre_account) mapping for this year.
  let processed: { imported: number; unmappedLabels: string[] };
  try {
    processed = await reprocessBudgetEntriesForCompany(db, companyId, { years: [year] });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  return NextResponse.json({
    ok: true,
    year,
    rowsParsed: parsed.rows.length,
    rawCells: rawInserts.length,
    imported: processed.imported,
    unmappedLabels: processed.unmappedLabels,
    warnings: parsed.warnings,
    distinctLabels: distinctLabels.length,
  });
}
