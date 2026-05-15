import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  runCompanyRangeSync,
  runCompanySync,
  type CustomDateRange,
} from "@/lib/omie/sync";

interface Params {
  params: {
    companyId: string;
  };
}

interface ManualSyncBody {
  full?: boolean;
  rolling?: boolean;
  currentMonth?: boolean;
  years?: number[];
}

// Datas no formato DD-MM-YYYY (mesmo formato esperado pela Omie em dDtPagtoDe/Ate).
function fmt(date: Date): string {
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yyyy = date.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

interface DateRange {
  from: Date;
  to: Date;
}

// Combina ranges contiguos/sobrepostos em intervalos unicos. Reduz o numero
// de chamadas a Omie quando o usuario marca anos consecutivos (ex.: 2024 +
// 2025 viram 01-01-2024..31-12-2025). Mantem `dateFrom`/`dateTo` exatos
// para que o cleanup_obsolete_entries delete apenas dentro do escopo
// sincronizado — preservando anos nao marcados.
function mergeRanges(ranges: DateRange[]): DateRange[] {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.from.getTime() - b.from.getTime());
  const merged: DateRange[] = [
    { from: sorted[0].from, to: sorted[0].to },
  ];
  for (let i = 1; i < sorted.length; i++) {
    const last = merged[merged.length - 1];
    const curr = sorted[i];
    const lastToPlus1 = new Date(last.to);
    lastToPlus1.setDate(lastToPlus1.getDate() + 1);
    if (curr.from <= lastToPlus1) {
      if (curr.to > last.to) last.to = curr.to;
    } else {
      merged.push({ from: curr.from, to: curr.to });
    }
  }
  return merged;
}

function buildRanges(body: ManualSyncBody): DateRange[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const currentYear = today.getFullYear();
  const ranges: DateRange[] = [];

  if (body.rolling) {
    const from = new Date(today);
    from.setDate(from.getDate() - 3);
    ranges.push({ from, to: today });
  }

  if (body.currentMonth) {
    const from = new Date(currentYear, today.getMonth(), 1);
    ranges.push({ from, to: today });
  }

  for (const year of body.years ?? []) {
    if (!Number.isInteger(year) || year < 2000 || year > currentYear) continue;
    const from = new Date(year, 0, 1);
    // Para o ano corrente, dateTo = hoje (nao adianta pedir ate 31-12 — a
    // Omie nao tem o que retornar e o cleanup nao deve apagar futuro).
    const to = year === currentYear ? new Date(today) : new Date(year, 11, 31);
    ranges.push({ from, to });
  }

  return mergeRanges(ranges);
}

export async function POST(request: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin" && profile.role !== "gestor_hero") {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  let body: ManualSyncBody;
  try {
    body = (await request.json()) as ManualSyncBody;
  } catch {
    return NextResponse.json({ error: "Body invalido." }, { status: 400 });
  }

  try {
    // "Periodo todo" prevalece: ignora as outras opcoes e roda sync full.
    if (body.full) {
      const result = await runCompanySync(params.companyId, profile, "full");
      return NextResponse.json({
        ok: true,
        recordsImported: result.recordsImported,
        recordsDeleted: result.recordsDeleted,
        categoriesImported: result.categories.length,
        newUnmappedCategories: result.newUnmappedCategories.length,
        rangesProcessed: 1,
      });
    }

    const ranges = buildRanges(body);
    if (ranges.length === 0) {
      return NextResponse.json(
        { error: "Selecione pelo menos um periodo para sincronizar." },
        { status: 400 },
      );
    }

    let recordsImported = 0;
    let recordsDeleted = 0;
    let categoriesImported = 0;
    let newUnmappedCategories = 0;

    for (const range of ranges) {
      const customRange: CustomDateRange = {
        dateFrom: fmt(range.from),
        dateTo: fmt(range.to),
      };
      const result = await runCompanyRangeSync(
        params.companyId,
        profile,
        customRange,
      );
      recordsImported += result.recordsImported;
      recordsDeleted += result.recordsDeleted;
      categoriesImported += result.categories.length;
      newUnmappedCategories += result.newUnmappedCategories.length;
    }

    return NextResponse.json({
      ok: true,
      recordsImported,
      recordsDeleted,
      categoriesImported,
      newUnmappedCategories,
      rangesProcessed: ranges.length,
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha inesperada ao sincronizar empresa.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
