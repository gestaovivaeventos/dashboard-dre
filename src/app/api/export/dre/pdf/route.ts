import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  buildDreGerencialPdf,
  type DreGerencialInput,
  type DreGerencialInputRow,
  type DreGerencialMonth,
} from "@/lib/pdf/dre-gerencial";

export const maxDuration = 60;

interface ExportBody {
  unidade?: string;
  segmento?: string;
  periodo?: string;
  meses?: DreGerencialMonth[];
  rows?: DreGerencialInputRow[];
}

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  const body = (await request.json()) as ExportBody;
  const meses = body.meses ?? [];
  const rows = body.rows ?? [];
  if (meses.length === 0 || rows.length === 0) {
    return NextResponse.json({ error: "Sem dados para exportar." }, { status: 400 });
  }

  // Fórmulas das contas calculadas — o template reavalia os subtotais a partir
  // dos grupos recalculados para o documento sempre fechar.
  const calculadoIds = rows.filter((row) => row.type === "calculado").map((row) => row.id);
  const formulasById: Record<string, string> = {};
  if (calculadoIds.length > 0) {
    const { data } = await supabase
      .from("dre_accounts")
      .select("id, formula")
      .in("id", calculadoIds);
    (data ?? []).forEach((account) => {
      if (account.formula) formulasById[account.id] = account.formula;
    });
  }

  const geradoEm = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(new Date())
    .replace(",", "");

  const input: DreGerencialInput = {
    unidade: body.unidade?.trim() || "Consolidado",
    segmento: body.segmento?.trim() || "—",
    periodo: body.periodo?.trim() || "—",
    geradoEm,
    geradoPor: profile?.name?.trim() || user.email || "—",
    meses,
    rows,
  };

  try {
    const pdf = await buildDreGerencialPdf(input, formulasById);
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="DRE_Gerencial.pdf"',
      },
    });
  } catch (error) {
    console.error("[export/dre/pdf] render failed:", error);
    return NextResponse.json({ error: "Falha ao gerar o PDF do DRE." }, { status: 500 });
  }
}
