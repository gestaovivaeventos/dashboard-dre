// Horários da atualização automática do Caixa (cron /api/cron/caixa-saldos).
//
// ⚠️ O cron NÃO lê daqui — a Vercel agenda pelo vercel.json, em UTC. Mudar um
// horário exige editar os DOIS lugares (mesma regra dos crons do BI, ver
// CLAUDE.md). Aqui é a fonte para o que a tela mostra e para o alerta de
// "a atualização das 12:30 não rodou".
//
// Puro — sem import de servidor; a tela também usa.

export interface CronSlot {
  hour: number;
  minute: number;
}

/** Em hora de Brasília. vercel.json: "0 7 * * *" e "30 15 * * *" (UTC). */
export const CAIXA_CRON_SLOTS_BRT: readonly CronSlot[] = [
  { hour: 4, minute: 0 },
  { hour: 12, minute: 30 },
];

/** Para textos de tela. */
export const CAIXA_CRON_SLOTS_LABEL = CAIXA_CRON_SLOTS_BRT.map(slotLabel).join(" e ");

/**
 * Quanto tempo depois do horário esperamos antes de dizer que a execução não
 * aconteceu. A Vercel pode atrasar alguns minutos e a varredura leva ~2 min;
 * 45 min é folga para não alarmar à toa.
 */
export const CAIXA_CRON_GRACE_MINUTES = 45;

/** Brasília não tem horário de verão desde 2019: UTC−3 fixo. */
const BRT_OFFSET_HOURS = 3;

export function slotLabel(slot: CronSlot): string {
  return `${String(slot.hour).padStart(2, "0")}:${String(slot.minute).padStart(2, "0")}`;
}

/**
 * O último horário de cron que JÁ deveria ter rodado, considerando a folga.
 * Devolve o instante (UTC) e o rótulo em BRT. Olha hoje e ontem em Brasília —
 * o de ontem cobre a madrugada (às 04:20 de hoje, o último "vencido" ainda é
 * o das 12:30 de ontem, porque o das 04:00 está dentro da folga).
 */
export function lastExpectedCronSlot(
  now: Date,
  slots: readonly CronSlot[] = CAIXA_CRON_SLOTS_BRT,
  graceMinutes: number = CAIXA_CRON_GRACE_MINUTES,
): { at: Date; label: string; isToday: boolean } | null {
  const deadline = now.getTime() - graceMinutes * 60_000;

  // "Hoje" em Brasília: desloca o instante e lê a data em UTC.
  const shifted = new Date(now.getTime() - BRT_OFFSET_HOURS * 3_600_000);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth();
  const d = shifted.getUTCDate();

  let best: { at: Date; label: string; isToday: boolean } | null = null;
  for (const dayOffset of [0, -1]) {
    for (const slot of slots) {
      const at = new Date(
        Date.UTC(y, m, d + dayOffset, slot.hour + BRT_OFFSET_HOURS, slot.minute),
      );
      if (at.getTime() > deadline) continue;
      if (!best || at.getTime() > best.at.getTime()) {
        best = { at, label: slotLabel(slot), isToday: dayOffset === 0 };
      }
    }
  }
  return best;
}
