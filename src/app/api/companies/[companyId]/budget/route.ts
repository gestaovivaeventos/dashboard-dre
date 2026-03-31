import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

interface ParsedRow {
  year: number;
  month: number;
  accountName: string;
  amount: number;
  lineNumber: number;
}

function unwrapOuterQuotes(line: string): string {
  // Excel/Sheets brasileiro exporta linhas inteiras envolvidas em aspas:
  // "Viva Petropolis,2026,1,Conta,""66.719,88"""
  // Precisamos remover as aspas externas e desescapar as internas.
  const trimmed = line.trim();
  if (
    trimmed.length >= 2 &&
    trimmed[0] === '"' &&
    trimmed[trimmed.length - 1] === '"'
  ) {
    const inner = trimmed.slice(1, -1);
    // Only unwrap if the inner content has commas (it's a wrapped row, not a single quoted field)
    if (inner.includes(",")) {
      // Desescapar aspas duplas internas: "" → "
      return inner.replace(/""/g, '"');
    }
  }
  return trimmed;
}

function parseCsvLine(rawLine: string): string[] {
  const line = unwrapOuterQuotes(rawLine);
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (inQuotes) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === "," || char === ";") {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  // Handle Brazilian format: "1.234,56" → 1234.56
  const cleaned = raw.replace(/[R$\s]/g, "");
  if (cleaned.includes(",")) {
    const normalized = cleaned.replace(/\./g, "").replace(",", ".");
    const n = Number(normalized);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

export async function POST(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode enviar orcamentos." }, { status: 403 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const companyId = params.companyId;

  // Validate company exists
  const { data: company, error: companyErr } = await db
    .from("companies")
    .select("id,name")
    .eq("id", companyId)
    .single();
  if (companyErr || !company) {
    return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
  }

  // Read CSV from form data
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "Envie um arquivo CSV." }, { status: 400 });
  }

  const text = await file.text();
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) {
    return NextResponse.json({ error: "O CSV deve ter cabecalho e ao menos 1 linha de dados." }, { status: 400 });
  }

  // Parse header to find column indices
  const header = parseCsvLine(lines[0]).map((h) => h.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""));

  const colYear = header.findIndex((h) => h === "ano");
  const colMonth = header.findIndex((h) => h === "mes");
  const colAccount = header.findIndex((h) => h.includes("conta") && h.includes("dre"));
  const colAmount = header.findIndex((h) => h.includes("valor") || h.includes("orcado") || h.includes("orcamento"));

  if (colYear === -1 || colMonth === -1 || colAccount === -1 || colAmount === -1) {
    return NextResponse.json({
      error: `Cabecalho invalido. Colunas esperadas: Ano, Mes, Conta do DRE, Valor orcado. Encontradas: ${parseCsvLine(lines[0]).join(", ")}`,
    }, { status: 400 });
  }

  // Load DRE accounts for matching (by code, exact name, or normalized name)
  const { data: dreAccounts } = await db
    .from("dre_accounts")
    .select("id,code,name")
    .eq("active", true);

  function normalize(s: string): string {
    return s.toLowerCase().trim()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
      .replace(/[^a-z0-9\s]/g, " ") // non-alphanumeric → space
      .replace(/\s+/g, " ").trim();
  }

  const accountByCode = new Map<string, string>();
  const accountByExactName = new Map<string, string>();
  const accountByNormName = new Map<string, string>();
  const allAccounts = (dreAccounts ?? []).map((a) => ({
    id: a.id as string,
    code: a.code as string,
    name: a.name as string,
    norm: normalize(a.name as string),
  }));

  allAccounts.forEach((a) => {
    accountByCode.set(a.code, a.id);
    accountByExactName.set(a.name.toLowerCase().trim(), a.id);
    accountByNormName.set(a.norm, a.id);
  });

  // Match an input string to a DRE account ID
  function matchAccount(input: string): string | null {
    const trimmed = input.trim();
    // 1. Try as code (e.g. "7.2.1")
    if (accountByCode.has(trimmed)) return accountByCode.get(trimmed)!;
    // 2. Try "code - name" format (e.g. "7.2.1 - Salarios")
    const codePart = trimmed.split(/\s*-\s*/)[0];
    if (accountByCode.has(codePart)) return accountByCode.get(codePart)!;
    // 3. Exact name (case-insensitive)
    const lower = trimmed.toLowerCase();
    if (accountByExactName.has(lower)) return accountByExactName.get(lower)!;
    // 4. Normalized name (no accents, no special chars)
    const norm = normalize(trimmed);
    if (accountByNormName.has(norm)) return accountByNormName.get(norm)!;
    // 5. Partial match: find account whose normalized name contains the input
    for (const a of allAccounts) {
      if (a.norm.includes(norm) || norm.includes(a.norm)) {
        return a.id;
      }
    }
    return null;
  }

  // Parse data rows
  const parsed: ParsedRow[] = [];
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.every((f) => !f)) continue; // skip empty lines

    const yearRaw = fields[colYear] ?? "";
    const monthRaw = fields[colMonth] ?? "";
    const accountRaw = (fields[colAccount] ?? "").trim();
    const amountRaw = fields[colAmount] ?? "";

    const year = parseInt(yearRaw, 10);
    const month = parseInt(monthRaw, 10);

    if (!Number.isFinite(year) || year < 2000 || year > 2100) {
      errors.push(`Linha ${i + 1}: Ano invalido "${yearRaw}"`);
      continue;
    }
    if (!Number.isFinite(month) || month < 1 || month > 12) {
      errors.push(`Linha ${i + 1}: Mes invalido "${monthRaw}"`);
      continue;
    }
    if (!accountRaw) {
      errors.push(`Linha ${i + 1}: Conta do DRE vazia`);
      continue;
    }

    const amount = parseAmount(amountRaw);

    parsed.push({
      year,
      month,
      accountName: accountRaw,
      amount,
      lineNumber: i + 1,
    });
  }

  // Match account names to IDs and aggregate duplicates
  // (e.g. "Outras" appears under multiple parents but maps to the same dre_account_id)
  const aggregated = new Map<string, {
    company_id: string;
    dre_account_id: string;
    year: number;
    month: number;
    amount: number;
  }>();
  const unmatchedAccounts = new Set<string>();

  for (const row of parsed) {
    const accountId = matchAccount(row.accountName);
    if (!accountId) {
      unmatchedAccounts.add(row.accountName);
      continue;
    }

    const key = `${accountId}:${row.year}:${row.month}`;
    const existing = aggregated.get(key);
    if (existing) {
      existing.amount += row.amount;
    } else {
      aggregated.set(key, {
        company_id: companyId,
        dre_account_id: accountId,
        year: row.year,
        month: row.month,
        amount: row.amount,
      });
    }
  }

  const toInsert = Array.from(aggregated.values());

  if (toInsert.length === 0) {
    return NextResponse.json({
      error: `Nenhum registro valido encontrado. ${errors.length} erros de parse. ${unmatchedAccounts.size} contas nao encontradas: ${Array.from(unmatchedAccounts).join(", ")}`,
    }, { status: 400 });
  }

  // Upsert in batches
  let inserted = 0;
  const batchSize = 200;
  for (let i = 0; i < toInsert.length; i += batchSize) {
    const batch = toInsert.slice(i, i + batchSize);
    const { error: upsertErr } = await db
      .from("budget_entries")
      .upsert(batch, {
        onConflict: "company_id,dre_account_id,year,month",
      });
    if (upsertErr) {
      return NextResponse.json({
        error: `Falha ao salvar lote ${Math.floor(i / batchSize) + 1}: ${upsertErr.message}`,
      }, { status: 400 });
    }
    inserted += batch.length;
  }

  return NextResponse.json({
    ok: true,
    imported: inserted,
    skipped: unmatchedAccounts.size,
    unmatchedAccounts: Array.from(unmatchedAccounts),
    parseErrors: errors,
  });
}

export async function GET(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { data, error } = await db
    .from("budget_entries")
    .select("id,dre_account_id,year,month,amount")
    .eq("company_id", params.companyId)
    .order("year")
    .order("month");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ entries: data ?? [], count: (data ?? []).length });
}

export async function DELETE(_: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode excluir orcamentos." }, { status: 403 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { error } = await db
    .from("budget_entries")
    .delete()
    .eq("company_id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
