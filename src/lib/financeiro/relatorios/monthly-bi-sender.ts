import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmail } from "@/lib/email/gmail";
import { analyzeOnePageReport } from "@/lib/financeiro/relatorios/one-page-analyzer";
import { renderOnePageEmail } from "@/lib/financeiro/relatorios/one-page-email";
import { buildOnePagePayload } from "@/lib/financeiro/relatorios/one-page-payload";

// ============================================================================
// Geracao + envio do One Page Report (Business Intelligence) por email.
// Compartilhado entre o cron mensal (/api/cron/monthly-bi-report) e o envio
// manual "Enviar agora" (/api/bi-subscriptions/send). Mantem um unico caminho
// de codigo: build payload → IA → email HTML → registro em ai_reports.
// ============================================================================

const MONTH_NAMES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export interface MonthRange {
  dateFrom: string;
  dateTo: string;
  periodLabel: string;
}

/** Intervalo do mes anterior (em UTC) relativo a `now`. */
export function getPreviousMonthRange(now: Date): MonthRange {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const prevMonthIndex = month === 0 ? 11 : month - 1;
  const prevYear = month === 0 ? year - 1 : year;
  const prevMonth1 = prevMonthIndex + 1;
  const lastDay = new Date(Date.UTC(prevYear, prevMonthIndex + 1, 0)).getUTCDate();

  return {
    dateFrom: `${prevYear}-${String(prevMonth1).padStart(2, "0")}-01`,
    dateTo: `${prevYear}-${String(prevMonth1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
    periodLabel: `${MONTH_NAMES[prevMonthIndex]} ${prevYear}`,
  };
}

export interface SendOnePageArgs {
  /** Cliente service-role (bypassa RLS — escreve em ai_reports). */
  admin: SupabaseClient;
  companyId: string;
  companyName: string;
  emails: string[];
  range: MonthRange;
  appUrl?: string;
}

export interface SendOnePageResult {
  ok: boolean;
  error?: string;
}

/**
 * Gera o relatorio do periodo para uma empresa e envia para os emails dados.
 * Registra sucesso/erro em `ai_reports`. Nunca lanca: devolve { ok, error }.
 */
export async function sendOnePageForCompany({
  admin,
  companyId,
  companyName,
  emails,
  range,
  appUrl,
}: SendOnePageArgs): Promise<SendOnePageResult> {
  const { dateFrom, dateTo, periodLabel } = range;

  try {
    if (emails.length === 0) {
      throw new Error("Nenhum destinatário informado.");
    }

    const result = await buildOnePagePayload(admin, { companyId, dateFrom, dateTo, periodLabel });
    if (!result.ok) throw new Error(result.error);

    const analysis = await analyzeOnePageReport(result.payload.input);
    const html = renderOnePageEmail({ companyName, periodLabel, payload: result.payload, analysis, appUrl });

    const sendResult = await sendEmail({
      to: emails,
      subject: `[Control Hub] Relatório BI — ${companyName} — ${periodLabel}`,
      html,
    });
    if (!sendResult.ok) throw new Error(sendResult.error ?? "Falha no envio do email.");

    await admin.from("ai_reports").insert({
      type: "one-page-monthly",
      company_ids: [companyId],
      period_from: dateFrom,
      period_to: dateTo,
      content_html: html,
      content_json: { analysis, ...result.payload } as unknown as Record<string, unknown>,
      recipients: emails,
      sent_at: new Date().toISOString(),
      status: "sent",
    });

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha inesperada ao gerar relatório.";

    await admin.from("ai_reports").insert({
      type: "one-page-monthly",
      company_ids: [companyId],
      period_from: dateFrom,
      period_to: dateTo,
      content_html: "",
      content_json: {},
      recipients: emails,
      status: "error",
      error_message: message,
    });

    return { ok: false, error: message };
  }
}
