// src/lib/vb/cdi/config.ts
// Regime de rendimento por CDI do VB. Cada credor rende desde o próprio
// último lançamento (ver queries.ts, accrualStartFor); não há data única.

/** Série do SGS/BCB: CDI diário, percentual ao dia. */
export const VB_CDI_SGS_SERIES = 12;

/**
 * Início padrão do download de taxas ('YYYY-MM-DD'), usado só quando não há
 * credor ativo com lançamento para ancorar o ponto de partida. Não é marco
 * zero do rendimento: o download volta até o último lançamento mais antigo.
 */
export const VB_CDI_START_DATE = "2026-09-10";

/** Descrição dos lançamentos gerados. */
export const VB_CDI_DESCRIPTION = "Rendimento CDI";
