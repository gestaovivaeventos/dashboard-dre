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

function parseCsvLine(line: string): string[] {
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

  // Load DRE accounts for name matching
  const { data: dreAccounts } = await db
    .from("dre_accounts")
    .select("id,code,name")
    .eq("active", true);

  const accountByName = new Map<string, string>();
  const accountByCode = new Map<string, string>();
  (dreAccounts ?? []).forEach((a) => {
    const name = (a.name as string).toLowerCase().trim();
    accountByName.set(name, a.id as string);
    accountByCode.set(a.code as string, a.id as string);
  });

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

  // Match account names to IDs
  const toInsert: Array<{
    company_id: string;
    dre_account_id: string;
    year: number;
    month: number;
    amount: number;
  }> = [];
  const unmatchedAccounts = new Set<string>();

  for (const row of parsed) {
    const nameLower = row.accountName.toLowerCase().trim();
    // Try exact name match, then code match
    let accountId = accountByName.get(nameLower);
    if (!accountId) {
      accountId = accountByCode.get(row.accountName.trim());
    }
    if (!accountId) {
      unmatchedAccounts.add(row.accountName);
      continue;
    }

    toInsert.push({
      company_id: companyId,
      dre_account_id: accountId,
      year: row.year,
      month: row.month,
      amount: row.amount,
    });
  }

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
