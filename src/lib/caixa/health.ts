// Saúde da atualização de saldos: o que a tela avisa quando algo não rodou
// ou rodou com erro. Puro e testado — a leitura do banco fica em queries.ts.
//
// Existe porque o cron devolve o erro só no JSON da execução, que ninguém lê:
// sem isto, uma credencial quebrada congelaria o saldo de uma empresa com um
// ponto âmbar na linha, e só descobriria quem abrisse a tela e reparasse.

import { lastExpectedCronSlot, type CronSlot } from "@/lib/caixa/schedule";

/** Uma linha de caixa_sync_runs (só o que a regra usa). */
export interface CaixaRunSummary {
  trigger: "cron" | "manual";
  startedAt: string;
  finishedAt: string | null;
  companiesTotal: number;
  companiesOk: number;
  accountsError: number;
  errors: Array<{ company_name?: string; error?: string }>;
}

export type CaixaSyncAlert =
  | {
      /** Começou e nunca terminou (estourou o tempo da Vercel ou caiu). */
      kind: "crashed";
      trigger: "cron" | "manual";
      startedAt: string;
    }
  | {
      /** Terminou, mas com empresa/conta falhando. */
      kind: "failed";
      trigger: "cron" | "manual";
      finishedAt: string;
      companiesFailed: number;
      companiesTotal: number;
      accountsFailed: number;
      /** Nomes das empresas com erro (para a tela citar). */
      companies: string[];
    }
  | {
      /** O horário do cron passou (com folga) e não há execução dele desde então. */
      kind: "missing";
      expectedLabel: string;
      expectedAt: string;
      expectedToday: boolean;
      lastCronAt: string | null;
    };

/**
 * Uma execução que começou há mais que isto e não terminou está morta — a
 * varredura inteira leva ~2 min; 15 min é o teto dos 300s da Vercel com folga.
 */
const CRASH_AFTER_MINUTES = 15;

/**
 * Decide o alerta a partir da execução mais recente (qualquer gatilho) e da
 * mais recente do cron.
 *
 * Prioridade: morta > com falha > não rodou. Uma execução manual bem-sucedida
 * DEPOIS de um cron com falha apaga o "com falha" (os saldos foram refeitos),
 * mas não o "não rodou" — o problema ali é o cron estar parado, e isso
 * continua verdadeiro depois de um clique manual.
 */
export function evaluateSyncHealth(
  lastRun: CaixaRunSummary | null,
  lastCronRun: CaixaRunSummary | null,
  now: Date,
  slots?: readonly CronSlot[],
): CaixaSyncAlert | null {
  if (lastRun) {
    const started = new Date(lastRun.startedAt).getTime();
    if (!lastRun.finishedAt) {
      if (now.getTime() - started > CRASH_AFTER_MINUTES * 60_000) {
        return { kind: "crashed", trigger: lastRun.trigger, startedAt: lastRun.startedAt };
      }
      // Ainda rodando — sem alerta.
    } else {
      const companiesFailed = Math.max(0, lastRun.companiesTotal - lastRun.companiesOk);
      if (companiesFailed > 0 || lastRun.accountsError > 0) {
        return {
          kind: "failed",
          trigger: lastRun.trigger,
          finishedAt: lastRun.finishedAt,
          companiesFailed,
          companiesTotal: lastRun.companiesTotal,
          accountsFailed: lastRun.accountsError,
          companies: lastRun.errors
            .map((e) => e.company_name ?? "")
            .filter((name) => name !== ""),
        };
      }
    }
  }

  const expected = lastExpectedCronSlot(now, slots);
  if (!expected) return null;
  const lastCronAt = lastCronRun ? new Date(lastCronRun.startedAt).getTime() : null;
  if (lastCronAt === null || lastCronAt < expected.at.getTime()) {
    return {
      kind: "missing",
      expectedLabel: expected.label,
      expectedAt: expected.at.toISOString(),
      expectedToday: expected.isToday,
      lastCronAt: lastCronRun?.startedAt ?? null,
    };
  }

  return null;
}
