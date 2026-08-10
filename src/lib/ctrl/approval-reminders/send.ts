// Rotina diária: um e-mail por aprovador, com todas as pendências dele.
//
// Ordem das garantias (nesta ordem, de propósito):
//   1. destinatários vêm de buildApprovalReminderTargets (mesma regra da tela de
//      Aprovações) — nunca de uma lista paralela;
//   2. usuário sem pendência não entra na lista, logo não recebe nada;
//   3. antes de qualquer envio a linha do dia é RESERVADA em
//      ctrl_approval_email_log (unique user_id + run_date). Quem já está
//      'enviado' é pulado — reexecutar o cron no mesmo dia não duplica e-mail;
//   4. só depois o Resend é chamado, e o resultado (id ou erro) volta para a
//      mesma linha.
//
// `runDate` é sempre o dia em Brasília (todayBR()).

import { isWeekendBR, todayBR } from "@/lib/ctrl/datetime";
import { isResendConfigured, sendEmailViaResend } from "@/lib/email/resend";
import type { SupabaseClient } from "@supabase/supabase-js";

import { FORTUNE_HISTORY_WINDOW, pickFortune } from "./fortunes";
import {
  buildApprovalReminderPlan,
  type ApprovalReminderPlan,
  type OrphanPendingRequest,
} from "./recipients";
import { approvalReminderSubject, renderApprovalReminderEmail } from "./template";

const LOG_TABLE = "ctrl_approval_email_log";

/** Dias para trás considerados no histórico de mensagens do dia. */
const FORTUNE_LOOKBACK_DAYS = 45;

export interface ApprovalReminderDetail {
  userId: string;
  email: string;
  requestCount: number;
  requestIds: string[];
  outcome: "enviado" | "duplicado" | "erro" | "simulado";
  resendId?: string;
  error?: string;
}

export interface ApprovalReminderRunResult {
  ok: boolean;
  runDate: string;
  dryRun: boolean;
  /** Usuários com pendência hoje (candidatos a receber). */
  candidates: number;
  sent: number;
  /** Pulados por já terem recebido o e-mail de hoje. */
  duplicated: number;
  failed: number;
  /** Requisições pendentes consideradas (as duas etapas). */
  pendingRequests: number;
  /**
   * Requisições pendentes sem nenhum aprovador elegível — ninguém foi avisado
   * sobre elas. Sempre indica cadastro a corrigir (setor sem gerente vinculado,
   * alçada restrita demais, aprovador inativo).
   */
  orphans: OrphanPendingRequest[];
  /** O dia da execução (em Brasília) é sábado ou domingo. */
  weekend: boolean;
  /** Motivo de a rotina não ter enviado nada. Hoje só 'fim_de_semana'. */
  skipped?: "fim_de_semana";
  error?: string;
  details: ApprovalReminderDetail[];
}

interface LogRow {
  id: string;
  user_id: string;
  status: string;
  fortune: string | null;
  run_date: string;
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  return err.code === "42P01" || /ctrl_approval_email_log/i.test(err.message ?? "");
}

/** 'YYYY-MM-DD' N dias antes de `day`, sem depender do fuso do runtime. */
function daysBefore(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const ms = Date.UTC(y, (m || 1) - 1, d || 1) - days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

export async function runApprovalReminders(
  db: SupabaseClient,
  opts: {
    /** Monta os e-mails e devolve o resumo sem enviar nem gravar log. */
    dryRun?: boolean;
    /** Reenvia mesmo para quem já recebeu hoje (uso manual, excepcional). */
    force?: boolean;
  } = {},
): Promise<ApprovalReminderRunResult> {
  const runDate = todayBR();
  const dryRun = opts.dryRun ?? false;
  const weekend = isWeekendBR(runDate);
  const details: ApprovalReminderDetail[] = [];

  const base: ApprovalReminderRunResult = {
    ok: true,
    runDate,
    dryRun,
    candidates: 0,
    sent: 0,
    duplicated: 0,
    failed: 0,
    pendingRequests: 0,
    orphans: [],
    weekend,
    details,
  };

  // Sábado e domingo não têm expediente de compras: o lembrete só vai de
  // segunda a sexta. O agendamento do cron já exclui o fim de semana, mas a
  // regra vive aqui também porque uma execução manual (ou uma mudança futura no
  // vercel.json) não pode furá-la sem querer. `force` é a saída consciente,
  // para teste. Em dryRun a regra é apenas sinalizada — nada sai mesmo —, assim
  // dá para conferir o conteúdo num sábado.
  if (weekend && !dryRun && !opts.force) {
    return { ...base, skipped: "fim_de_semana" };
  }

  if (!dryRun && !isResendConfigured()) {
    return {
      ...base,
      ok: false,
      error: "Resend não configurado (falta RESEND_API_KEY). Nenhum e-mail foi enviado.",
    };
  }

  let plan: ApprovalReminderPlan;
  try {
    plan = await buildApprovalReminderPlan(db);
  } catch (err) {
    return { ...base, ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const targets = plan.targets;
  base.candidates = targets.length;
  base.pendingRequests = plan.pendingCount;
  base.orphans = plan.orphans;
  if (targets.length === 0) return base;

  const userIds = targets.map((t) => t.userId);

  // Log do dia (trava de duplicidade) + histórico de frases, numa consulta só.
  const { data: logRows, error: logErr } = await db
    .from(LOG_TABLE)
    .select("id, user_id, status, fortune, run_date")
    .in("user_id", userIds)
    .gte("run_date", daysBefore(runDate, FORTUNE_LOOKBACK_DAYS))
    .order("run_date", { ascending: false });

  if (logErr && !dryRun) {
    // Sem a tabela não existe trava de duplicidade — abortar é mais seguro do
    // que enviar e correr o risco de repetir o e-mail a cada execução.
    return {
      ...base,
      ok: false,
      error: isMissingTable(logErr)
        ? "Tabela ctrl_approval_email_log ausente: aplique a migration 20260804120000_ctrl_approval_email_log.sql antes de rodar a rotina."
        : `Falha ao ler o log de envios: ${logErr.message}`,
    };
  }

  const rows = (logRows ?? []) as LogRow[];
  const todayByUser = new Map<string, LogRow>();
  const historyByUser = new Map<string, string[]>();
  for (const row of rows) {
    if (row.run_date === runDate) {
      if (!todayByUser.has(row.user_id)) todayByUser.set(row.user_id, row);
      continue;
    }
    if (!row.fortune) continue;
    const list = historyByUser.get(row.user_id) ?? [];
    if (list.length < FORTUNE_HISTORY_WINDOW) {
      list.push(row.fortune);
      historyByUser.set(row.user_id, list);
    }
  }

  for (const target of targets) {
    const requestIds = target.requests.map((r) => r.id);
    const already = todayByUser.get(target.userId);

    if (already?.status === "enviado" && !opts.force) {
      base.duplicated += 1;
      details.push({
        userId: target.userId,
        email: target.email,
        requestCount: target.requests.length,
        requestIds,
        outcome: "duplicado",
      });
      continue;
    }

    // A frase do dia já registrada é mantida em um reprocessamento, para o log
    // refletir exatamente o que o usuário viu.
    const fortune =
      already?.fortune ??
      pickFortune(target.userId, runDate, historyByUser.get(target.userId) ?? []);

    const subject = approvalReminderSubject(target.requests.length);
    const html = renderApprovalReminderEmail({
      recipientName: target.name,
      fortune,
      requests: target.requests,
    });

    if (dryRun) {
      details.push({
        userId: target.userId,
        email: target.email,
        requestCount: target.requests.length,
        requestIds,
        outcome: "simulado",
      });
      continue;
    }

    const claim = {
      run_date: runDate,
      user_id: target.userId,
      recipient_email: target.email,
      stage: target.stage,
      request_count: target.requests.length,
      request_ids: requestIds,
      fortune,
      status: "enviando",
      error: null,
      updated_at: new Date().toISOString(),
    };

    let logId = already?.id ?? null;
    if (logId) {
      await db.from(LOG_TABLE).update(claim).eq("id", logId);
    } else {
      const { data: inserted, error: insertErr } = await db
        .from(LOG_TABLE)
        .insert(claim)
        .select("id")
        .single();
      if (insertErr) {
        // 23505 = outra execução reservou a linha no mesmo instante: ela envia.
        if (insertErr.code === "23505") {
          base.duplicated += 1;
          details.push({
            userId: target.userId,
            email: target.email,
            requestCount: target.requests.length,
            requestIds,
            outcome: "duplicado",
          });
          continue;
        }
        base.failed += 1;
        base.ok = false;
        details.push({
          userId: target.userId,
          email: target.email,
          requestCount: target.requests.length,
          requestIds,
          outcome: "erro",
          error: `Falha ao registrar o envio: ${insertErr.message}`,
        });
        continue;
      }
      logId = inserted?.id ?? null;
    }

    const result = await sendEmailViaResend({ to: target.email, subject, html });
    const now = new Date().toISOString();

    if (logId) {
      await db
        .from(LOG_TABLE)
        .update(
          result.ok
            ? { status: "enviado", resend_id: result.id ?? null, error: null, sent_at: now, updated_at: now }
            : { status: "erro", error: result.error ?? "Falha desconhecida no Resend.", updated_at: now },
        )
        .eq("id", logId);
    }

    if (result.ok) {
      base.sent += 1;
      details.push({
        userId: target.userId,
        email: target.email,
        requestCount: target.requests.length,
        requestIds,
        outcome: "enviado",
        resendId: result.id,
      });
    } else {
      base.failed += 1;
      base.ok = false;
      details.push({
        userId: target.userId,
        email: target.email,
        requestCount: target.requests.length,
        requestIds,
        outcome: "erro",
        error: result.error,
      });
    }
  }

  return base;
}
