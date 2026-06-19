// ============================================================================
// LIMITE DE PERÍODO POR EMPRESA (camada de visualização — Dashboard DRE + Fluxo)
// ============================================================================
//
// Algumas empresas só devem EXIBIR/calcular dados a partir de um ano-piso nas
// telas Dashboard DRE e Fluxo de Caixa — independentemente de existirem
// lançamentos anteriores na base. É uma regra de VISUALIZAÇÃO/COMPOSIÇÃO: não
// apaga nada, não altera os dados de origem (Omie, planilha, mapeamento de
// categorias, cálculo de impostos) e não toca em nenhuma outra empresa.
//
// Caso de uso atual — SIRENA:
//   A Sirena é composta a partir da Omie da Feat Produções, filtrada pelo
//   departamento "Sirena" (department routing — os lançamentos continuam
//   pertencendo à Feat Produções). Aqui apenas restringimos o intervalo
//   CONSULTADO quando a Sirena é a empresa selecionada, para que apareçam só
//   dados de 2026 em diante. A Feat Produções NUNCA casa este piso (a regra é
//   keyed por nome de empresa e só vale single-company), então sua DRE, seu
//   fluxo de caixa e os lançamentos do departamento Sirena na base seguem
//   intactos.
//
// ISOLAMENTO: o piso só se aplica quando a ÚNICA empresa selecionada está em
// LIMITS_BY_NORMALIZED_NAME — mesma regra de escopo single-company usada pelos
// impostos da Sirena (ver sirena-taxes.ts). Em consolidado/multiempresa retorna
// null (regra inerte), de modo que o piso de uma empresa nunca corta o período
// de outra.

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

interface CompanyYearLimit {
  /** Primeiro ano (inclusive) que a empresa pode exibir. */
  minYear: number;
}

// Pisos por nome de empresa (normalizado). Mantido pequeno e explícito.
// - Sirena: só 2026 em diante.
const LIMITS_BY_NORMALIZED_NAME: Record<string, CompanyYearLimit> = {
  sirena: { minYear: 2026 },
};

export interface CompanyPeriodFloor {
  minYear: number;
  minMonth: number;
  /** Primeiro dia consultável, no formato ISO "YYYY-MM-DD". */
  minDate: string;
}

export interface PeriodWindow {
  yearFrom: number;
  monthFrom: number;
  yearTo: number;
  monthTo: number;
}

/**
 * Resolve o piso de período para a seleção atual. Só retorna piso quando há
 * EXATAMENTE uma empresa selecionada e ela está na lista de limites. Em
 * qualquer outro caso retorna null (regra inerte) — garante que o piso de uma
 * empresa nunca afete o consolidado nem outra empresa.
 */
export function resolveCompanyPeriodFloor(
  selectedCompanyIds: string[],
  companies: Array<{ id: string; name: string }>,
): CompanyPeriodFloor | null {
  if (selectedCompanyIds.length !== 1) return null;
  const company = companies.find((c) => c.id === selectedCompanyIds[0]);
  if (!company) return null;
  const limit = LIMITS_BY_NORMALIZED_NAME[normalizeName(company.name)];
  if (!limit) return null;
  return {
    minYear: limit.minYear,
    minMonth: 1,
    minDate: `${limit.minYear}-01-01`,
  };
}

/**
 * Eleva uma data ISO ao piso (lower bound). Inerte quando floor é null.
 * Usado para cortar baselines "desde o início da história" (saldo inicial /
 * acumulados do Fluxo de Caixa) e o intervalo do drilldown ao ano-piso.
 */
export function clampDateFromToFloor(
  dateFrom: string,
  floor: CompanyPeriodFloor | null,
): string {
  if (!floor) return dateFrom;
  return dateFrom < floor.minDate ? floor.minDate : dateFrom;
}

/**
 * Aplica o piso ao intervalo selecionado, MUTANDO o filtro no lugar (mesmo
 * estilo das demais normalizações de filtro nas páginas):
 * - Se TODO o intervalo está abaixo do piso → retorna isEmpty = true (o
 *   chamador deve renderizar o estado vazio — nada a exibir).
 * - Se começa antes do piso → eleva o início para (minYear, minMonth).
 * - Caso contrário, mantém o filtro intacto.
 *
 * Nunca produz intervalo invertido: quando vazio, sinaliza via isEmpty para o
 * chamador (evita buckets vazios / datas inválidas nos RPCs).
 */
export function applyPeriodFloor(
  filter: PeriodWindow,
  floor: CompanyPeriodFloor | null,
): { isEmpty: boolean } {
  if (!floor) return { isEmpty: false };
  if (filter.yearTo < floor.minYear) return { isEmpty: true };
  if (filter.yearFrom < floor.minYear) {
    filter.yearFrom = floor.minYear;
    filter.monthFrom = floor.minMonth;
  }
  return { isEmpty: false };
}
