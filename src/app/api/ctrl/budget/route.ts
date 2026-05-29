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
}

function parseSheet(sheet: XLSX.WorkSheet): ParseResult {
  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  // Locate the header row containing the month names (Jan..Dez).
  let headerRowIdx = -1;
  let monthCols: Record<number, number> = {}; // colIndex -> month number
  for (let i = 0; i < Math.min(data.length, 25); i += 1) {
    const row = data[i] ?? [];
    const candidate: Record<number, number> = {};
    let hits = 0;
    for (let c = 0; c < row.length; c += 1) {
      const cell = row[c];
      if (cell == null) continue;
      const month = MONTH_TOKENS[normalize(String(cell))];
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
      "Não foi possível encontrar o cabeçalho de meses (Janeiro..Dezembro) na planilha.",
    );
  }

  const monthColIndices = Object.keys(monthCols).map(Number).sort((a, b) => a - b);
  const firstMonthCol = monthColIndices[0];
  if (firstMonthCol < 2) {
    throw new Error(
      "A planilha precisa ter as colunas 'Setor' e 'Tipo de Despesa' antes dos meses.",
    );
  }

  // Identify the setor / tipo columns by their header names; fall back to the
  // first two columns to the left of the months.
  const headerRow = data[headerRowIdx] ?? [];
  let sectorCol = 0;
  let typeCol = 1;
  for (let c = 0; c < firstMonthCol; c += 1) {
    const h = normalize(String(headerRow[c] ?? ""));
    if (h.includes("setor")) sectorCol = c;
    if (h.includes("tipo")) typeCol = c;
  }

  const rows: ParsedRow[] = [];
  for (let i = headerRowIdx + 1; i < data.length; i += 1) {
    const raw = data[i] ?? [];
    const sectorName = String(raw[sectorCol] ?? "").trim();
    const typeName = String(raw[typeCol] ?? "").trim();
    if (!sectorName && !typeName) continue;

    const values: Record<number, number> = {};
    let hasAny = false;
    for (const col of monthColIndices) {
      const parsed = parseAmount(raw[col]);
      if (parsed != null && parsed !== 0) {
        values[monthCols[col]] = parsed;
        hasAny = true;
      }
    }
    if (!hasAny) continue;

    rows.push({ sectorName, typeName, values });
  }

  return { rows };
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

  // Validate everything before writing — the import is all-or-nothing.
  const unknownSectors = new Set<string>();
  const unknownTypes = new Set<string>();
  for (const row of parsed.rows) {
    if (!sectorByName.has(normalize(row.sectorName))) unknownSectors.add(row.sectorName || "(vazio)");
    if (!typeByName.has(normalize(row.typeName))) unknownTypes.add(row.typeName || "(vazio)");
  }
  if (unknownSectors.size > 0 || unknownTypes.size > 0) {
    return NextResponse.json(
      {
        error: "Alguns nomes não batem com o cadastro. Corrija na planilha e reenvie.",
        unknownSectors: Array.from(unknownSectors),
        unknownTypes: Array.from(unknownTypes),
      },
      { status: 400 },
    );
  }

  // Build entries, summing duplicate (setor, tipo, mês) lines.
  const entryMap = new Map<string, { sector_id: string; expense_type_id: string; period_year: number; period_month: number; amount: number }>();
  for (const row of parsed.rows) {
    const sectorId = sectorByName.get(normalize(row.sectorName))!;
    const typeId = typeByName.get(normalize(row.typeName))!;
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
    rowsParsed: parsed.rows.length,
    entriesInserted: entries.length,
    totalAmount,
  });
}
