// src/lib/vb/cdi/config.ts
// Regime de rendimento por CDI do VB. Sem retroativo: nada anterior ao marco
// zero rende, porque o histórico importado já fechou os períodos até ali.

/** Série do SGS/BCB: CDI diário, percentual ao dia. */
export const VB_CDI_SGS_SERIES = 12;

/**
 * Marco zero ('YYYY-MM-DD'): última data com CDI publicado quando o regime
 * entrou. Pelo intervalo meio aberto, o primeiro dia que rende é o seguinte.
 */
export const VB_CDI_START_DATE = "2026-09-10";

/** Descrição dos lançamentos gerados. */
export const VB_CDI_DESCRIPTION = "Rendimento CDI";
