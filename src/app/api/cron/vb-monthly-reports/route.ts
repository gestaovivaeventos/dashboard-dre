import { NextResponse } from "next/server";

import { isCronAuthorized } from "@/lib/auth/cron";
import { sendEmailViaResend } from "@/lib/email/resend";
import { currentMonthBR, currentYearBR } from "@/lib/ctrl/datetime";
import { createAdminClient } from "@/lib/supabase/admin";
import { VB_CDI_MONTH_CLOSE_DESCRIPTION } from "@/lib/vb/cdi/config";
import { buildCdiPlan, CdiDuplicateError, postCdiPlan, previousMonthEnd } from "@/lib/vb/cdi/service";
import { syncCdiRates } from "@/lib/vb/cdi/sync";
import { monthLabel } from "@/lib/vb/report/monthly-email";
import { loadMonthlyReportRows } from "@/lib/vb/report/queries";
import { previousMonth, VB_REPORT_STATUS_LABELS, type VbReportStatus } from "@/lib/vb/report/status";

// ============================================================================
// GET /api/cron/vb-monthly-reports — FECHAMENTO E AVISO DO EXTRATO MENSAL
//
// Dia 5, 09:00 de Brasília (12:00 UTC). Duas etapas:
//   1. Fecha o rendimento por CDI de todos os credores ativos até o último
//      dia do mês anterior (uma linha por credor, marcada como fechamento
//      automático). É a única gravação de lançamento feita por cron no VB —
//      decisão 15/09/2026, para o extrato mensal sair sempre completo.
//   2. Manda aos gestores do VB o resumo do mês (prontos, sem e-mail…) com
//      o link da tela. NÃO envia nada ao credor: extrato de dinheiro de sócio
//      não sai sem alguém olhar; o envio é clique em /vb/relatorios.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 60;

const ORDER: VbReportStatus[] = ["pronto", "rendimento_pendente", "sem_email", "enviado"];

export async function GET(request: Request) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const admin = createAdminClient();
    const today = `${currentYearBR()}-${String(currentMonthBR()).padStart(2, "0")}-01`;
    const month = previousMonth(today.slice(0, 7));

    // Etapa 1: fechamento do mês. Sem taxa até o fim do mês (BCB atrasado),
    // o plano para onde a taxa para e a tela mostra "rendimento pendente".
    let closed = { created: 0, total: 0 };
    let closeError: string | null = null;
    try {
      await syncCdiRates();
      const plan = await buildCdiPlan(admin, { upTo: previousMonthEnd(today) });
      closed = await postCdiPlan(admin, plan, { userId: null, description: VB_CDI_MONTH_CLOSE_DESCRIPTION });
    } catch (error) {
      closeError = error instanceof CdiDuplicateError ? null : error instanceof Error ? error.message : String(error);
      if (closeError) console.error("[vb-monthly-reports] month close failed:", closeError);
    }

    const rows = await loadMonthlyReportRows(admin, month);

    const { data: grants, error: grantsError } = await admin
      .from("user_module_roles")
      .select("user_id")
      .eq("module", "vb")
      .eq("role", "gestor");
    if (grantsError) throw new Error(grantsError.message);
    const ids = Array.from(new Set((grants ?? []).map((g) => g.user_id as string)));
    const { data: users, error: usersError } = ids.length
      ? await admin.from("users").select("email").in("id", ids).eq("active", true)
      : { data: [], error: null };
    if (usersError) throw new Error(usersError.message);
    const to = (users ?? []).map((u) => String(u.email ?? "").trim()).filter(Boolean);

    if (rows.length === 0 || to.length === 0) {
      return NextResponse.json({ ok: true, month, rows: rows.length, notified: 0, closed, closeError });
    }

    const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    const link = `${appUrl}/vb/relatorios?mes=${month}`;
    const counts = ORDER.map((s) => ({ s, n: rows.filter((r) => r.status === s).length }));
    const list = ORDER.map((s) => {
      const names = rows.filter((r) => r.status === s).map((r) => r.creditor.name);
      return names.length ? `<li><b>${VB_REPORT_STATUS_LABELS[s]}</b>: ${names.join(", ")}</li>` : "";
    }).join("");

    const html = `
<div style="font-family:'IBM Plex Sans',Helvetica,Arial,sans-serif;color:#1B2430;font-size:14px;line-height:1.5;max-width:560px">
  <p style="font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#6B7686;margin:0 0 6px">VB · Viva Bank</p>
  <p style="font-size:18px;font-weight:600;margin:0 0 12px">Extratos de ${monthLabel(month)} disponíveis</p>
  <p style="margin:0 0 12px">${counts.map((c) => `${c.n} ${VB_REPORT_STATUS_LABELS[c.s].toLowerCase()}`).join(" · ")}.</p>
  <p style="margin:0 0 12px;color:#6B7686">${
    closeError
      ? `Fechamento automático do rendimento falhou: ${closeError}. Use “Calcular rendimento” até ${monthLabel(month)}.`
      : closed.created > 0
        ? `Rendimento do mês fechado automaticamente: ${closed.created} lançamento(s).`
        : "Rendimento do mês já estava fechado."
  }</p>
  <ul style="margin:0 0 16px;padding-left:18px">${list}</ul>
  <p style="margin:0 0 16px"><a href="${link}" style="color:#0B6E99">Abrir Relatórios mensais</a> para conferir e enviar. Nada foi enviado aos credores.</p>
  <p style="font-size:12px;color:#6B7686;margin:0">“Rendimento pendente” significa que o CDI do mês ainda não foi lançado — use “Calcular rendimento” antes de enviar.</p>
</div>`;

    const result = await sendEmailViaResend({
      to,
      subject: `VB · Extratos de ${monthLabel(month)} prontos para envio`,
      html,
      headers: { "X-Entity-Ref-ID": `vb-monthly-${month}-${Date.now()}` },
    });
    if (!result.ok) throw new Error(result.error ?? "Falha no envio do aviso.");

    return NextResponse.json({ ok: true, month, rows: rows.length, notified: to.length, counts, closed, closeError });
  } catch (error) {
    const message = error instanceof Error ? error.message : "VB monthly report notice failed.";
    console.error("[vb-monthly-reports] cron failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
