import type { SupabaseClient } from "@supabase/supabase-js";

import { sendEmailViaResend } from "@/lib/email/resend";
import { analyzeOnePageReport } from "@/lib/financeiro/relatorios/one-page-analyzer";
import { renderOnePageEmail } from "@/lib/financeiro/relatorios/one-page-email";
import { buildOnePagePayload } from "@/lib/financeiro/relatorios/one-page-payload";
import {
  mapOnePageApiResponseToPreviewData,
  type OnePageApiResponse,
} from "@/lib/financeiro/relatorios/one-page-report-mapper";

// ============================================================================
// Geracao + envio do One Page Report (Business Intelligence) por e-mail.
//
// Caminho UNICO de codigo compartilhado por:
//   - cron mensal            (/api/cron/monthly-bi-report)
//   - envio manual "Enviar agora" (/api/bi-subscriptions/send)
//   - fluxo de validacao CSC (tela Validacao Relatorio + crons dos dias 4/10)
//
// Pipeline: buildOnePagePayload → IA → mapper → HTML de e-mail → Resend →
// registro em ai_reports.
//
// O `mapOnePageApiResponseToPreviewData` no meio do caminho e o que garante
// que o e-mail seja IDENTICO a tela: e o mesmo mapper que o Business
// Intelligence usa para alimentar o <OnePageReportPreview />.
//
// O envio e feito pela API do Resend (regra de negocio) — ver
// @/lib/email/resend.
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
    // Mesmo formato do rótulo derivado na tela de Business Intelligence
    // ("Julho/2026") — o período aparece no cabeçalho do relatório, então
    // manter o formato evita divergência visual entre tela e e-mail.
    periodLabel: `${MONTH_NAMES[prevMonthIndex]}/${prevYear}`,
  };
}

// ─── Geracao do relatorio (sem envio) ───────────────────────────────────────

export interface BuildOnePageReportArgs {
  /** Cliente service-role (bypassa RLS). */
  admin: SupabaseClient;
  companyId: string;
  range: MonthRange;
  /** Contexto de negocio do CSC — so influencia a analise textual da IA. */
  businessContext?: string | null;
}

export type BuildOnePageReportResult =
  | { ok: true; report: OnePageApiResponse }
  | { ok: false; error: string };

/**
 * Gera o relatorio COMPLETO de uma empresa/periodo — exatamente o corpo que a
 * rota /api/intelligence/one-page devolve para a tela de Business
 * Intelligence (analysis + payload). Nao envia nada e nao grava nada.
 */
export async function buildOnePageReport({
  admin,
  companyId,
  range,
  businessContext,
}: BuildOnePageReportArgs): Promise<BuildOnePageReportResult> {
  try {
    const result = await buildOnePagePayload(admin, {
      companyId,
      dateFrom: range.dateFrom,
      dateTo: range.dateTo,
      periodLabel: range.periodLabel,
    });
    if (!result.ok) return { ok: false, error: result.error };

    const analysis = await analyzeOnePageReport(result.payload.input, {
      businessContext: businessContext ?? undefined,
    });

    return {
      ok: true,
      report: { analysis, ...result.payload } as unknown as OnePageApiResponse,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Falha inesperada ao gerar relatório.",
    };
  }
}

/**
 * Converte o relatorio gerado no HTML do e-mail. Passa pelo MESMO mapper da
 * tela — por isso o e-mail respeita template, blocos exclusivos e campos
 * ocultos de cada empresa sem nenhuma configuracao extra.
 */
export function renderReportEmailHtml(
  report: OnePageApiResponse,
  appUrl?: string,
): string {
  const data = mapOnePageApiResponseToPreviewData(report);
  return renderOnePageEmail({ data, appUrl });
}

/** Assunto padronizado do e-mail do relatorio. */
export function reportEmailSubject(companyName: string, periodLabel: string): string {
  return `[Control Hub] Relatório BI — ${companyName} — ${periodLabel}`;
}

// ─── Geracao + envio (caminho legado do cron mensal / "Enviar agora") ───────

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
 * Gera o relatorio do periodo para uma empresa e envia para os e-mails dados.
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

    const built = await buildOnePageReport({ admin, companyId, range });
    if (!built.ok) throw new Error(built.error);

    const html = renderReportEmailHtml(built.report, appUrl);

    const sendResult = await sendEmailViaResend({
      to: emails,
      subject: reportEmailSubject(companyName, periodLabel),
      html,
    });
    if (!sendResult.ok) throw new Error(sendResult.error ?? "Falha no envio do email.");

    await admin.from("ai_reports").insert({
      type: "one-page-monthly",
      company_ids: [companyId],
      period_from: dateFrom,
      period_to: dateTo,
      content_html: html,
      content_json: built.report as unknown as Record<string, unknown>,
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
