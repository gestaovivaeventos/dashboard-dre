// Preferências da tela Caixa Geral, por usuário: os filtros/ordenação da
// tabela, a janela do gráfico e o escopo dos botões. Guardadas em
// user_preferences (chave CAIXA_REAL_PREFS_KEY) e restauradas ao abrir —
// sobrevivem a logout, a dias sem entrar e a outra máquina.
//
// Motivo: o módulo é de poucas pessoas e cada uma cuida de um conjunto de
// empresas; abrir a tela e ver o próprio recorte é o uso normal, não a
// exceção. "Último filtro que a pessoa fez" — não há botão Salvar.
//
// Puro (sem import de servidor): a tela usa o padrão e o parser; a leitura
// do banco fica em queries.ts e a escrita na rota /api/caixa/prefs.

import {
  EMPTY_SNAPSHOT,
  parseSnapshot,
  stableJson,
  type FilterTableSnapshot,
} from "@/components/data-table/filter-logic";
import { CAIXA_STATUS_ATIVA, CAIXA_TIPOS_LIQUIDOS, tipoLabel } from "@/lib/caixa/types";

export const CAIXA_REAL_PREFS_KEY = "caixa_real";

export const CHART_DAYS_OPTIONS = [30, 90, 180, 365] as const;
export type ChartDays = (typeof CHART_DAYS_OPTIONS)[number];

export interface CaixaRealPrefs {
  /** Versão do formato — mudar a forma exige bump e um `parse` que entenda a antiga. */
  v: 1;
  table: FilterTableSnapshot;
  chartDays: ChartDays;
  /** Empresas do escopo dos botões; null = todas. */
  scope: string[] | null;
}

/**
 * O que a tela mostra para quem nunca mexeu em nada: contas ATIVAS e só
 * DINHEIRO (ver CAIXA_TIPOS_LIQUIDOS), 90 dias no gráfico, todas as empresas
 * nos botões. É também o alvo de "Voltar ao padrão".
 */
export function defaultCaixaRealPrefs(): CaixaRealPrefs {
  return {
    v: 1,
    table: {
      ...EMPTY_SNAPSHOT,
      values: {
        tipo: CAIXA_TIPOS_LIQUIDOS.map((t) => tipoLabel(t)),
        status: [CAIXA_STATUS_ATIVA],
      },
    },
    chartDays: 90,
    scope: null,
  };
}

/**
 * Valida o JSON do banco. Devolve null quando não há nada aproveitável (a
 * tela cai no padrão). Campo a campo: uma parte corrompida não invalida o
 * resto, e ninguém fica preso num filtro que não consegue tirar.
 */
export function parseCaixaRealPrefs(raw: unknown): CaixaRealPrefs | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (r.v !== 1) return null;

  const days = Number(r.chartDays);
  const chartDays = (CHART_DAYS_OPTIONS as readonly number[]).includes(days)
    ? (days as ChartDays)
    : 90;

  const scope =
    Array.isArray(r.scope) && r.scope.every((id) => typeof id === "string")
      ? (r.scope as string[])
      : null;

  return { v: 1, table: parseSnapshot(r.table), chartDays, scope };
}

/** String estável para comparar "mudou?" sem salvar à toa. */
export function prefsKey(p: CaixaRealPrefs): string {
  return JSON.stringify({
    table: stableJson(p.table),
    chartDays: p.chartDays,
    scope: p.scope ? p.scope.slice().sort() : null,
  });
}
