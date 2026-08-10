// ============================================================================
// Calendário mensal do relatório BI — fonte única dos dois dias da rotina.
//
// ATENÇÃO: o agendamento real está no `vercel.json` (cron não lê constante de
// código). Ao mudar um dia aqui, mude a expressão cron correspondente lá — as
// duas coisas TÊM de casar:
//
//   BI_GENERATION_DAY  →  "/api/cron/bi-monthly-validation"  →  "0 12 D * *"
//                         (e a janela de 6 meses do "/api/cron/sync-all",
//                          que roda ANTES, no mesmo dia)
//   BI_AUTOSEND_DAY    →  "/api/cron/bi-monthly-autosend"    →  "0 12 D * *"
//
// O horário é 12:00 UTC = 09:00 BRT (cron da Vercel é sempre UTC).
//
// Existe para os textos de tela/e-mail não ficarem com o dia escrito à mão em
// dezenas de lugares: já aconteceu de a rotina mudar e a legenda continuar
// prometendo a data antiga ao CSC.
// ============================================================================

/** Dia em que o relatório do mês anterior é gerado (sem envio). */
export const BI_GENERATION_DAY = 5;

/** Dia em que o que não foi aceito é enviado automaticamente. */
export const BI_AUTOSEND_DAY = 11;
