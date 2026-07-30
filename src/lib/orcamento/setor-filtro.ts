// Filtro de setor das telas de pessoal. Três estados distintos convivem, e o
// null do banco só cobre um deles — daí o sentinela:
//
//   null            → empresa NÃO orça por setor: quadro único, setor_id IS NULL
//   SETOR_TODOS     → empresa orça por setor, mas se quer o consolidado dela
//   "<uuid>"        → um setor específico
//
// Módulo "puro" (sem "use server"): importável por client e server.

export const SETOR_TODOS = "todos";

/** true quando o valor pede o consolidado da empresa (sem filtrar setor). */
export function isTodosSetores(setorId: string | null | undefined): boolean {
  return setorId === SETOR_TODOS;
}

/** Setor específico, ou null quando é quadro único ou consolidado. */
export function setorEspecifico(setorId: string | null | undefined): string | null {
  return setorId && setorId !== SETOR_TODOS ? setorId : null;
}
