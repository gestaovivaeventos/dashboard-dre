// =============================================================================
// Status de andamento do orçamento (Fase 3) — módulo PURO (client + server).
//
// A partir das contagens agregadas por empresa × ano (RPC
// orcamento_status_por_empresa), deriva um selo por módulo para as caixas do
// hub e para os cards do painel. Nível governa a cor; label é o texto curto.
// =============================================================================

/** Contagens cruas por empresa (uma linha do RPC + planejamento). */
export interface OrcamentoStatusRaw {
  colaboradores: number;
  mediaTotal: number;
  mediaComValor: number;
  metodoCount: number;
  /** Nº de categorias do método "planejamento_socios" no ano. */
  planejamentoTotal: number;
  /** Quantas dessas já têm a PROPOSTA CONFIRMADA (congelada). */
  planejamentoConfirmado: number;
}

export const STATUS_VAZIO: OrcamentoStatusRaw = {
  colaboradores: 0,
  mediaTotal: 0,
  mediaComValor: 0,
  metodoCount: 0,
  planejamentoTotal: 0,
  planejamentoConfirmado: 0,
};

export type StatusNivel = "pendente" | "andamento" | "concluido";

/** Classes Tailwind do badge de status por nível (borda + fundo + texto). */
export const STATUS_NIVEL_BADGE: Record<StatusNivel, string> = {
  pendente: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  andamento: "border-sky-500/40 bg-sky-500/10 text-sky-700 dark:text-sky-400",
  concluido: "border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
};

export interface StatusSelo {
  nivel: StatusNivel;
  label: string;
}

// ─── Status GERAL da empresa ─────────────────────────────────────────────────
// Um selo único por empresa (não por módulo, a pedido da usuária 14/08/2026):
//  - Não iniciado: nada preenchido em nenhuma tela do orçamento da empresa.
//  - Em andamento: começou a trabalhar em alguma tela.
//  - Concluído: as telas mensuráveis estão preenchidas (método definido, quadro
//    de pessoal com gente e todas as categorias por média com valor).
//
// "Concluído" é heurístico: já cobre método definido, pessoal, todas as médias com
// valor E todas as categorias por planejamento dos sócios com a PROPOSTA CONFIRMADA.
// (Valor fixo ainda não entra na conta — estender quando fizer sentido.)

export function statusGeral(raw: OrcamentoStatusRaw): StatusSelo {
  const nada =
    raw.colaboradores === 0 &&
    raw.metodoCount === 0 &&
    raw.mediaTotal === 0 &&
    raw.mediaComValor === 0;
  if (nada) return { nivel: "pendente", label: "Não iniciado" };

  const mediaCompleta = raw.mediaTotal === 0 || raw.mediaComValor >= raw.mediaTotal;
  const planejamentoCompleto =
    raw.planejamentoTotal === 0 || raw.planejamentoConfirmado >= raw.planejamentoTotal;
  const concluido =
    raw.metodoCount > 0 && raw.colaboradores > 0 && mediaCompleta && planejamentoCompleto;
  if (concluido) return { nivel: "concluido", label: "Concluído" };

  return { nivel: "andamento", label: "Em andamento" };
}
