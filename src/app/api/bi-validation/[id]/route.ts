import { NextResponse } from "next/server";

import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  acceptValidation,
  addValidationContext,
  generateValidationReport,
  markValidationForReview,
  sendValidationReport,
  type ValidationActor,
  type ValidationRow,
} from "@/lib/financeiro/relatorios/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// POST /api/bi-validation/[id]
//
// Acoes da tela "Validação Relatório" sobre UM relatorio (empresa × periodo):
//   { action: "aceitar" }
//   { action: "revisao", note?: string }
//   { action: "contexto", context: string }
//   { action: "regerar" }
//   { action: "enviar" }
//
// Acesso: CSC, admin e os e-mails nominais (canAccessBiValidation) — mesma
// regra da tela e do RLS (public.can_validate_bi_reports()).
//
// ISOLAMENTO: o client so informa o ID da linha. Empresa, periodo, relatorio e
// destinatarios sao sempre lidos no servidor a partir dessa linha — nao ha
// como enviar o relatorio de uma empresa para o gestor de outra.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  action?: "aceitar" | "revisao" | "contexto" | "regerar" | "enviar";
  note?: string;
  context?: string;
}

/**
 * GET /api/bi-validation/[id]
 *
 * Devolve o relatório gerado (`report_json`) EXATAMENTE como a rota
 * /api/intelligence/one-page devolveria — a tela o passa pelo mesmo mapper e
 * pelo mesmo <OnePageReportPreview />, garantindo que o que o CSC valida é o
 * que a tela de Business Intelligence mostra e o que o e-mail envia.
 */
export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!canAccessBiValidation(profile)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("bi_report_validations")
    .select("id, company_id, period_label, status, version, report_json, extra_context")
    .eq("id", params.id)
    .maybeSingle<{
      id: string;
      company_id: string;
      period_label: string;
      status: string;
      version: number;
      report_json: unknown;
      extra_context: string | null;
    }>();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!data) return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });

  // Histórico de contextos da PRÓPRIA linha (e da própria empresa).
  const { data: contexts } = await admin
    .from("bi_report_validation_contexts")
    .select("id, context_text, applied_version, created_at")
    .eq("validation_id", params.id)
    .eq("company_id", data.company_id)
    .order("created_at", { ascending: false });

  return NextResponse.json({
    id: data.id,
    periodLabel: data.period_label,
    status: data.status,
    version: data.version,
    report: data.report_json,
    extraContext: data.extra_context,
    contexts: contexts ?? [],
  });
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!canAccessBiValidation(profile)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const action = body.action;
  if (!action) {
    return NextResponse.json({ error: "Campo obrigatório: action." }, { status: 400 });
  }

  const admin = createAdminClient();
  const actor: ValidationActor = {
    id: profile.id,
    label: profile.name?.trim() || profile.email,
  };
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  switch (action) {
    case "aceitar": {
      const result = await acceptValidation(admin, { validationId: params.id, actor });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "revisao": {
      const result = await markValidationForReview(admin, {
        validationId: params.id,
        actor,
        note: body.note ?? null,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "contexto": {
      const result = await addValidationContext(admin, {
        validationId: params.id,
        actor,
        context: body.context ?? "",
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "regerar": {
      // Regera com os dados atuais do banco (pós-ajustes na Omie), mantendo o
      // contexto já aplicado. Empresa/período vêm da própria linha.
      const { data: row, error } = await admin
        .from("bi_report_validations")
        .select("*")
        .eq("id", params.id)
        .maybeSingle<ValidationRow>();
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      if (!row) return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
      if (row.sent_at) {
        return NextResponse.json(
          { error: "Relatório já enviado ao gestor — não pode ser regerado." },
          { status: 400 },
        );
      }

      const result = await generateValidationReport({
        admin,
        companyId: row.company_id,
        range: {
          dateFrom: row.period_from,
          dateTo: row.period_to,
          periodLabel: row.period_label,
        },
        actor,
        businessContext: row.extra_context,
        statusOnSuccess: row.extra_context ? "contexto_adicionado" : "pendente_validacao",
        eventAction: "regerado",
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true });
    }

    case "enviar": {
      const result = await sendValidationReport({
        admin,
        validationId: params.id,
        mode: "manual",
        actor,
        appUrl,
        // Envio manual só acontece após o aceite (regra 7/10).
        requireAccepted: true,
      });
      if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
      return NextResponse.json({ ok: true, recipients: result.recipients });
    }

    default:
      return NextResponse.json({ error: "Ação desconhecida." }, { status: 400 });
  }
}
