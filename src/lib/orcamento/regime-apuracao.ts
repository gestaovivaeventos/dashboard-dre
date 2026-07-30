// Regime de apuração do orçamento — caixa ou competência. Define COMO as
// provisões da folha são distribuídas nos 12 meses:
//   • caixa       → 13º sai metade em novembro e metade em dezembro (quando é
//                   efetivamente pago).
//   • competência → 13º é diluído em 1/12 por mês, igual às férias.
// Férias são diluídas nos 12 meses nos dois regimes (não se sabe quando o
// colaborador vai gozá-las).
//
// Módulo "puro" (sem "use server"): importável por client e server.

export type RegimeApuracao = "caixa" | "competencia";

export interface RegimeApuracaoMeta {
  key: RegimeApuracao;
  label: string;
}

export const REGIMES_APURACAO: readonly RegimeApuracaoMeta[] = [
  { key: "caixa", label: "Caixa" },
  { key: "competencia", label: "Competência" },
] as const;

/** Padrão do grupo: a DRE é montada em regime de caixa. */
export const REGIME_APURACAO_PADRAO: RegimeApuracao = "caixa";

export function isRegimeApuracao(value: unknown): value is RegimeApuracao {
  return value === "caixa" || value === "competencia";
}

/** Normaliza o valor lido do banco (null = empresa/ano ainda sem escolha). */
export function toRegimeApuracao(value: unknown): RegimeApuracao {
  return isRegimeApuracao(value) ? value : REGIME_APURACAO_PADRAO;
}

export function regimeApuracaoLabel(key: string): string {
  return REGIMES_APURACAO.find((r) => r.key === key)?.label ?? key;
}
