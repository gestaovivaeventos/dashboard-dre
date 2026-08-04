import { NextResponse } from "next/server";

import { sendEmail } from "@/lib/email/gmail";
import { getPreviousMonthRange } from "@/lib/financeiro/relatorios/monthly-bi-sender";
import {
  NOT_SENT_STATUSES,
  sendValidationReport,
  SYSTEM_ACTOR,
  VALIDATION_STATUS_LABEL,
  type ValidationStatus,
} from "@/lib/financeiro/relatorios/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/cron/bi-monthly-autosend   — ROTINA DO DIA 10
//
// Envia automaticamente, via Resend, os relatorios do MES ANTERIOR que ainda
// NAO foram enviados ao gestor — ou seja, aqueles em que o CSC nao deu o
// aceite ate o dia 10.
//
// Regras aplicadas:
//   - so entram relatorios NAO enviados (sent_at IS NULL) → zero duplicidade
//     com o envio manual;
//   - usa a VERSAO MAIS RECENTE disponivel do relatorio daquela empresa/periodo
//     (a linha guarda sempre o ultimo `report_json` gerado);
//   - destinatarios sao resolvidos no servidor a partir do company_id da
//     propria linha (ver sendValidationReport) — nunca ha cruzamento entre
//     empresas;
//   - relatorio EM REVISAO nao e enviado às cegas: como ainda pode estar
//     incorreto, ele NAO sai e vira alerta critico para Admin/CSC (comportamento
//     seguro exigido pela regra 11.10);
//   - relatorio sem conteudo gerado (erro na geracao) tambem nao e enviado —
//     entra no mesmo alerta.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

interface PendingRow {
  id: string;
  company_id: string;
  period_label: string;
  status: ValidationStatus;
  report_json: unknown;
  accepted_at: string | null;
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const range = getPreviousMonthRange(new Date());
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  const { data, error } = await admin
    .from("bi_report_validations")
    .select("id, company_id, period_label, status, report_json, accepted_at")
    .eq("period_from", range.dateFrom)
    .eq("period_to", range.dateTo)
    .is("sent_at", null)
    .in("status", NOT_SENT_STATUSES);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const rows = (data ?? []) as PendingRow[];

  const sent: Array<{ companyId: string; recipients: string[] }> = [];
  const failed: Array<{ companyId: string; error: string }> = [];
  // Casos que exigem olho humano: em revisão ou sem relatório gerado.
  const blocked: Array<{ companyId: string; status: ValidationStatus }> = [];

  for (const row of rows) {
    if (row.status === "em_revisao" || !row.report_json) {
      blocked.push({ companyId: row.company_id, status: row.status });
      continue;
    }

    const result = await sendValidationReport({
      admin,
      validationId: row.id,
      mode: "automatico",
      actor: SYSTEM_ACTOR,
      appUrl,
      // Dia 10 envia mesmo sem aceite — é exatamente o objetivo da rotina.
      requireAccepted: false,
    });

    if (result.ok) {
      sent.push({ companyId: row.company_id, recipients: result.recipients ?? [] });
    } else {
      failed.push({ companyId: row.company_id, error: result.error ?? "Falha desconhecida." });
    }
  }

  // Alerta ao admin quando algo ficou de fora ou falhou. Usa o canal interno de
  // alertas (não é relatório para gestor — este segue exclusivamente no Resend).
  if ((blocked.length > 0 || failed.length > 0) && process.env.ADMIN_EMAIL) {
    const companyIds = Array.from(
      new Set([...blocked.map((b) => b.companyId), ...failed.map((f) => f.companyId)]),
    );
    const { data: companiesData } = await admin
      .from("companies")
      .select("id,name")
      .in("id", companyIds);
    const nameById = new Map(
      (companiesData ?? []).map((c) => [c.id as string, c.name as string]),
    );

    const blockedList = blocked
      .map(
        (b) =>
          `<li><strong>${nameById.get(b.companyId) ?? b.companyId}</strong>: ${
            VALIDATION_STATUS_LABEL[b.status]
          } — não enviado, requer validação do CSC.</li>`,
      )
      .join("");
    const failedList = failed
      .map(
        (f) =>
          `<li><strong>${nameById.get(f.companyId) ?? f.companyId}</strong>: ${f.error}</li>`,
      )
      .join("");

    await sendEmail({
      to: process.env.ADMIN_EMAIL,
      subject: `[Control Hub] Relatórios BI pendentes no envio automático — ${range.periodLabel}`,
      html:
        `<h2>Envio automático do dia 10 — ${range.periodLabel}</h2>` +
        `<p>${sent.length} relatório(s) enviados com sucesso.</p>` +
        (blockedList
          ? `<h3>Pendência crítica (não enviados)</h3><ul>${blockedList}</ul>`
          : "") +
        (failedList ? `<h3>Falhas de envio</h3><ul>${failedList}</ul>` : ""),
    });
  }

  return NextResponse.json({
    ok: failed.length === 0,
    period: range.periodLabel,
    candidates: rows.length,
    sent: sent.length,
    blocked: blocked.length,
    failed: failed.length,
    details: { sent, blocked, failed },
  });
}
