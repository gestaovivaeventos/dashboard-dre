import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateReport } from "@/lib/intelligence/generate-report";
import { generateComparison } from "@/lib/intelligence/generate-comparison";
import { generateProjection } from "@/lib/intelligence/generate-projection";

interface GenerateBody {
  type: "relatorio" | "comparativo" | "projecao";
  companyIds: string[];
  dateFrom?: string;
  dateTo?: string;
  periodLabel?: string;
  segmentName?: string;
  horizonMonths?: number;
}

export async function POST(request: Request) {
  const { user, profile, supabase } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = (await request.json()) as GenerateBody;
  const { type, companyIds, dateFrom, dateTo, periodLabel, segmentName, horizonMonths } = body;

  if (!type || !companyIds || companyIds.length === 0) {
    return NextResponse.json(
      { error: "Campos obrigatorios: type, companyIds." },
      { status: 400 }
    );
  }

  if ((type === "relatorio" || type === "comparativo") && (!dateFrom || !dateTo)) {
    return NextResponse.json(
      { error: "dateFrom e dateTo sao obrigatorios para relatorio e comparativo." },
      { status: 400 }
    );
  }

  const adminClient = createAdminClient();

  try {
    let html: string;
    let json: Record<string, unknown>;

    if (type === "relatorio") {
      const result = await generateReport({
        supabase,
        companyIds,
        dateFrom: dateFrom!,
        dateTo: dateTo!,
        periodLabel: periodLabel ?? dateFrom!,
      });
      html = result.html;
      json = result.json;
    } else if (type === "comparativo") {
      const result = await generateComparison({
        supabase,
        companyIds,
        dateFrom: dateFrom!,
        dateTo: dateTo!,
        periodLabel: periodLabel ?? dateFrom!,
        segmentName: segmentName ?? "Geral",
      });
      html = result.html;
      json = result.json;
    } else if (type === "projecao") {
      const result = await generateProjection({
        supabase,
        companyId: companyIds[0],
        horizonMonths: horizonMonths ?? 6,
      });
      html = result.html;
      json = result.json;
    } else {
      return NextResponse.json(
        { error: "Tipo de relatorio nao suportado: " + type },
        { status: 400 }
      );
    }

    const { data, error } = await adminClient
      .from("ai_reports")
      .insert([
        {
          type,
          company_ids: companyIds,
          period_from: dateFrom ?? new Date().toISOString().slice(0, 10),
          period_to: dateTo ?? new Date().toISOString().slice(0, 10),
          content_html: html,
          content_json: json,
          status: "draft",
          created_by: user.id,
        },
      ])
      .select("id")
      .single();

    if (error || !data) {
      console.error("[intelligence/generate] Failed to save report:", error);
      return NextResponse.json({ error: "Falha ao salvar relatorio." }, { status: 500 });
    }

    return NextResponse.json({ reportId: data.id, html });
  } catch (err) {
    console.error("[intelligence/generate] AI error:", err);
    return NextResponse.json({ error: "Erro ao gerar relatorio com IA." }, { status: 500 });
  }
}
