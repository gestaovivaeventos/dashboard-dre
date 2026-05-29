import { NextResponse } from "next/server";
import * as XLSX from "xlsx";

import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

const MONTH_TOKENS: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
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

function normalize(s: unknown): string {
  return String(s ?? "")
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
  sectorName: string;
  typeName: string;
  values: Record<number, number>; // month -> amount
}

interface ParseResult {
  rows: ParsedRow[];
  format: "longo" | "largo";
}

// ─── Formato LONGO ──────────────────────────────────────────────────────────
// Uma linha por (item, mês). Cabeçalho tem colunas nomeadas, ex.:
//   Fornecedor | Tipo de Despesa | Descrição | Data | Valor orçado | ... | Setor
// "Data" carrega o mês por extenso; "Valor orçado" o valor; "Setor"/"Tipo de
// Despesa" as chaves do ctrl_budget. Acumula valores repetidos da mesma
// combinação (setor × tipo × mês), somando fornecedores/itens distintos.
function parseLong(data: unknown[][]): ParsedRow[] | null {
  let headerRowIdx = -1;
  let cSetor = -1;
  let cTipo = -1;
  let cMonth = -1;
  let cValue = -1;

  for (let i = 0; i < Math.min(data.length, 25); i += 1) {
    const row = data[i] ?? [];
    let setor = -1;
    let tipo = -1;
    let month = -1;
    let value = -1;
    for (let c = 0; c < row.length; c += 1) {
      const h = normalize(row[c]);
      if (!h) continue;
      if (setor === -1 && h.includes("setor")) setor = c;
      if (tipo === -1 && h.includes("tipo")) tipo = c;
      // mês: coluna "Data" / "Mês" / "Competência"
      if (month === -1 && (h === "data" || h.includes("mes") || h.includes("competenc"))) month = c;
      // valor orçado (e não "realizado")
      if (value === -1 && h.includes("orcado")) value = c;
    }
    if (setor !== -1 && tipo !== -1 && month !== -1 && value !== -1) {
      headerRowIdx = i;
      cSetor = setor;
      cTipo = tipo;
      cMonth = month;
      cValue = value;
      break;
    }
  }

  if (headerRowIdx === -1) return null;

  const map = new Map<string, ParsedRow>();
  for (let i = headerRowIdx + 1; i < data.length; i += 1) {
    const row = data[i] ?? [];
    const sectorName = String(row[cSetor] ?? "").trim();
    const typeName = String(row[cTipo] ?? "").trim();
    if (!sectorName && !typeName) continue;

    const month = MONTH_TOKENS[normalize(row[cMonth])];
    if (!month) continue;

    const amount = parseAmount(row[cValue]);
    if (amount == null || amount === 0) continue;

    const key = `${normalize(sectorName)}|${normalize(typeName)}`;
    let entry = map.get(key);
    if (!entry) {
      entry = { sectorName, typeName, values: {} };
      map.set(key, entry);
    }
    entry.values[month] = (entry.values[month] ?? 0) + amount;
  }

  return Array.from(map.values());
}

// ─── Formato LARGO ──────────────────────────────────────────────────────────
// Modelo gerado pelo sistema: colunas Setor | Tipo de Despesa | Jan | ... | Dez.
function parseWide(data: unknown[][]): ParsedRow[] | null {
  let headerRowIdx = -1;
  let monthCols: Record<number, number> = {};
  for (let i = 0; i < Math.min(data.length, 25); i += 1) {
    const row = data[i] ?? [];
    const candidate: Record<number, number> = {};
    let hits = 0;
    for (let c = 0; c < row.length; c += 1) {
      const month = MONTH_TOKENS[normalize(row[c])];
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

  if (headerRowIdx === -1) return null;

  const monthColIndices = Object.keys(monthCols).map(Number).sort((a, b) => a - b);
  const firstMonthCol = monthColIndices[0];
  if (firstMonthCol < 2) return null;

  const headerRow = data[headerRowIdx] ?? [];
  let sectorCol = 0;
  let typeCol = 1;
  for (let c = 0; c < firstMonthCol; c += 1) {
    const h = normalize(headerRow[c]);
    if (h.includes("setor")) sectorCol = c;
    if (h.includes("tipo")) typeCol = c;
  }

  const rows: ParsedRow[] = [];
  for (let i = headerRowIdx + 1; i < data.length; i += 1) {
    const row = data[i] ?? [];
    const sectorName = String(row[sectorCol] ?? "").trim();
    const typeName = String(row[typeCol] ?? "").trim();
    if (!sectorName && !typeName) continue;

    const values: Record<number, number> = {};
    let hasAny = false;
    for (const col of monthColIndices) {
      const parsed = parseAmount(row[col]);
      if (parsed != null && parsed !== 0) {
        values[monthCols[col]] = parsed;
        hasAny = true;
      }
    }
    if (!hasAny) continue;
    rows.push({ sectorName, typeName, values });
  }

  return rows;
}

function parseSheet(sheet: XLSX.WorkSheet): ParseResult {
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  // Prefere o formato longo (planilha-base da controladoria); cai pro largo
  // (modelo gerado pelo sistema) quando não houver coluna de mês "Data".
  const long = parseLong(data);
  if (long && long.length > 0) return { rows: long, format: "longo" };

  const wide = parseWide(data);
  if (wide && wide.length > 0) return { rows: wide, format: "largo" };

  throw new Error(
    "Não foi possível interpretar a planilha. Use o formato com colunas " +
      "'Setor', 'Tipo de Despesa', 'Data' (mês) e 'Valor orçado', ou o modelo " +
      "gerado pelo sistema (Setor, Tipo de Despesa, Jan..Dez).",
  );
}

export async function POST(request: Request) {
  const ctx = await getCtrlUser();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  if (!hasCtrlRole(ctx, "csc", "admin")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const db = createAdminClientIfAvailable() ?? (await createClient());

  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  const year = Number(formData.get("year"));
  if (!file) return NextResponse.json({ error: "Envie um arquivo .xlsx." }, { status: 400 });
  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: "Informe um ano válido (ex: 2026)." }, { status: 400 });
  }

  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
  } catch (error) {
    return NextResponse.json(
      { error: `Falha ao ler o arquivo: ${error instanceof Error ? error.message : String(error)}` },
      { status: 400 },
    );
  }

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return NextResponse.json({ error: "Planilha sem abas." }, { status: 400 });

  let parsed: ParseResult;
  try {
    parsed = parseSheet(workbook.Sheets[sheetName]);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }

  if (parsed.rows.length === 0) {
    return NextResponse.json(
      { error: "Nenhuma linha com valores foi encontrada na planilha." },
      { status: 400 },
    );
  }

  // Resolve setor / tipo names against the catalog.
  const [sectorsRes, typesRes] = await Promise.all([
    db.from("ctrl_sectors").select("id, name"),
    db.from("ctrl_expense_types").select("id, name"),
  ]);
  if (sectorsRes.error || typesRes.error) {
    return NextResponse.json(
      { error: `Falha ao carregar catálogo: ${(sectorsRes.error ?? typesRes.error)?.message}` },
      { status: 500 },
    );
  }
  const sectorByName = new Map((sectorsRes.data ?? []).map((s) => [normalize(s.name), s.id]));
  const typeByName = new Map((typesRes.data ?? []).map((t) => [normalize(t.name), t.id]));

  // Setores são validados de forma estrita: têm que existir no cadastro.
  const unknownSectors = new Set<string>();
  for (const row of parsed.rows) {
    if (!sectorByName.has(normalize(row.sectorName))) unknownSectors.add(row.sectorName || "(vazio)");
  }
  if (unknownSectors.size > 0) {
    return NextResponse.json(
      {
        error: "Alguns setores não batem com o cadastro. Corrija na planilha e reenvie.",
        unknownSectors: Array.from(unknownSectors),
      },
      { status: 400 },
    );
  }

  // Tipos de despesa que faltam são criados automaticamente no catálogo.
  // Linhas com tipo em branco são ignoradas (não há nome para cadastrar).
  const missingTypes = new Map<string, string>(); // normalized -> nome original
  for (const row of parsed.rows) {
    const name = row.typeName.trim();
    const key = normalize(name);
    if (name && !typeByName.has(key) && !missingTypes.has(key)) {
      missingTypes.set(key, name);
    }
  }
  const createdTypes: string[] = [];
  if (missingTypes.size > 0) {
    const toInsert = Array.from(missingTypes.values()).map((name) => ({ name }));
    const { data: inserted, error: insertTypeErr } = await db
      .from("ctrl_expense_types")
      .insert(toInsert)
      .select("id, name");
    if (insertTypeErr) {
      return NextResponse.json(
        { error: `Falha ao cadastrar tipos de despesa novos: ${insertTypeErr.message}` },
        { status: 500 },
      );
    }
    for (const t of inserted ?? []) {
      typeByName.set(normalize(t.name), t.id);
      createdTypes.push(t.name);
    }
  }

  const skippedBlankType = parsed.rows.filter((r) => !r.typeName.trim()).length;

  // Build entries, summing duplicate (setor, tipo, mês) lines.
  const entryMap = new Map<
    string,
    { sector_id: string; expense_type_id: string; period_year: number; period_month: number; amount: number }
  >();
  for (const row of parsed.rows) {
    const sectorId = sectorByName.get(normalize(row.sectorName))!;
    const typeId = typeByName.get(normalize(row.typeName));
    if (!typeId) continue; // linha com tipo em branco — ignorada
    for (const [monthStr, amount] of Object.entries(row.values)) {
      const month = Number(monthStr);
      const key = `${sectorId}|${typeId}|${month}`;
      const existing = entryMap.get(key);
      if (existing) existing.amount += amount;
      else entryMap.set(key, { sector_id: sectorId, expense_type_id: typeId, period_year: year, period_month: month, amount });
    }
  }
  const entries = Array.from(entryMap.values());

  // Overwrite the whole year, then insert the new budget.
  const { error: deleteErr } = await db.from("ctrl_budget").delete().eq("period_year", year);
  if (deleteErr) {
    return NextResponse.json(
      { error: `Falha ao limpar orçamento anterior: ${deleteErr.message}` },
      { status: 500 },
    );
  }

  const batchSize = 500;
  for (let i = 0; i < entries.length; i += batchSize) {
    const { error: insertErr } = await db.from("ctrl_budget").insert(entries.slice(i, i + batchSize));
    if (insertErr) {
      return NextResponse.json(
        { error: `Falha ao gravar orçamento: ${insertErr.message}` },
        { status: 500 },
      );
    }
  }

  const totalAmount = entries.reduce((s, e) => s + e.amount, 0);
  return NextResponse.json({
    ok: true,
    year,
    format: parsed.format,
    rowsParsed: parsed.rows.length,
    entriesInserted: entries.length,
    totalAmount,
    createdTypes,
    skippedBlankType,
  });
}
