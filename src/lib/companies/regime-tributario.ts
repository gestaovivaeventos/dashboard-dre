// Regime tributário da empresa — atributo fiscal cadastral (não versionado por
// ano). O orçamento usa isto para escolher a regra de encargos sobre a folha,
// que muda conforme a tributação (ex.: INSS patronal não incide no Simples).
// Módulo "puro" (sem "use server"): importável por client e server.

export type RegimeTributario = "simples_nacional" | "lucro_presumido" | "lucro_real";

export interface RegimeTributarioMeta {
  key: RegimeTributario;
  label: string;
}

// Só os três regimes usados pelas empresas do grupo. Ordem de exibição.
export const REGIMES_TRIBUTARIOS: readonly RegimeTributarioMeta[] = [
  { key: "simples_nacional", label: "Simples Nacional" },
  { key: "lucro_presumido", label: "Lucro Presumido" },
  { key: "lucro_real", label: "Lucro Real" },
] as const;

export function isRegimeTributario(value: unknown): value is RegimeTributario {
  return REGIMES_TRIBUTARIOS.some((r) => r.key === value);
}

/** Rótulo do regime. `null` (empresa sem regime definido) → travessão. */
export function regimeTributarioLabel(key: string | null): string {
  if (!key) return "—";
  return REGIMES_TRIBUTARIOS.find((r) => r.key === key)?.label ?? key;
}
