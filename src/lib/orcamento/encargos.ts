// Encargos sobre a folha — catálogo, padrões por regime tributário e a base de
// cálculo de cada linha da prévia. Módulo "puro" (client + server).
//
// Todas as alíquotas são PONTOS PERCENTUAIS (20 = 20%), como os índices de
// correção: o número da tela é o número do banco.

export type EncargoKey = "inss_patronal" | "rat_fap" | "terceiros" | "fgts";

export interface EncargoMeta {
  key: EncargoKey;
  label: string;
  hint: string;
  /** Linha da prévia em que este encargo é exibido. */
  linha: "inss" | "fgts";
}

// Ordem de exibição na tela de configuração.
export const ENCARGOS: readonly EncargoMeta[] = [
  {
    key: "inss_patronal",
    label: "INSS patronal",
    hint: "20% no regime normal. No Simples Nacional a CPP já está dentro do DAS (exceto Anexo IV).",
    linha: "inss",
  },
  {
    key: "rat_fap",
    label: "RAT × FAP",
    hint: "RAT de 1% a 3% pelo CNAE, multiplicado pelo FAP da empresa (0,5 a 2,0).",
    linha: "inss",
  },
  {
    key: "terceiros",
    label: "Terceiros",
    hint: "Sistema S, salário-educação, INCRA/SEBRAE — ~5,8% pelo FPAS. Simples Nacional é isento.",
    linha: "inss",
  },
  { key: "fgts", label: "FGTS", hint: "8% sobre a remuneração, em qualquer regime.", linha: "fgts" },
] as const;

/** Alíquotas de encargos de uma empresa num ano, em pontos percentuais. */
export type EncargoValues = Record<EncargoKey, number>;

// Padrões por regime tributário. Servem de ponto de partida quando a empresa
// ainda não tem linha própria no ano — o RAT/FAP e o FPAS variam empresa a
// empresa, então a expectativa é que sejam ajustados.
const PADRAO_NORMAL: EncargoValues = {
  inss_patronal: 20,
  rat_fap: 2,
  terceiros: 5.8,
  fgts: 8,
};

// Simples Nacional: a contribuição previdenciária patronal está embutida no DAS
// e não há contribuição a terceiros. Sobra o FGTS.
// (Anexo IV é a exceção — recolhe INSS + RAT por fora; nesse caso o admin
// sobrescreve o padrão na tela de Encargos.)
const PADRAO_SIMPLES: EncargoValues = {
  inss_patronal: 0,
  rat_fap: 0,
  terceiros: 0,
  fgts: 8,
};

export function encargosPadrao(regime: string | null): EncargoValues {
  return regime === "simples_nacional" ? { ...PADRAO_SIMPLES } : { ...PADRAO_NORMAL };
}

export function isEncargoKey(value: unknown): value is EncargoKey {
  return ENCARGOS.some((e) => e.key === value);
}

/** Fração (não percentual) do bloco INSS: patronal + RAT×FAP + terceiros. */
export function fatorInss(values: EncargoValues): number {
  return (values.inss_patronal + values.rat_fap + values.terceiros) / 100;
}

/** Fração (não percentual) do FGTS. */
export function fatorFgts(values: EncargoValues): number {
  return values.fgts / 100;
}

/** Fração total de encargos sobre a remuneração (INSS + FGTS). */
export function fatorEncargos(values: EncargoValues): number {
  return fatorInss(values) + fatorFgts(values);
}

// ─── Frações das provisões ───────────────────────────────────────────────────

/**
 * Férias, por mês: SOMENTE o terço constitucional.
 *
 * As férias custam 1 salário + 1/3 uma vez por ano, mas o salário do mês de
 * férias já está na linha de Salários (a prévia projeta os 12 meses do quadro).
 * Contar 1/9 aqui — a provisão contábil clássica, que pressupõe uma linha de
 * salários com 11 meses — cobraria um salário a mais por colaborador por ano.
 * Sobra o incremental: (1/3) ÷ 12 = 1/36.
 */
export const FRACAO_FERIAS_MES = 1 / 36;

/**
 * 13º, por mês, no regime de competência: 1 salário ÷ 12. Sem correção, porque
 * o 13º é um pagamento genuinamente extra — não existe nas 12 folhas mensais.
 */
export const FRACAO_DECIMO_MES = 1 / 12;
