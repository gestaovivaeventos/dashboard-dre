// Vínculos empregatícios e tipos de movimentação do quadro de pessoal.
// Módulo "puro" (sem "use server"): importável por client e server.

export type VinculoKey = "clt" | "pj" | "estagio";

export interface VinculoMeta {
  key: VinculoKey;
  label: string;
}

export const VINCULOS: readonly VinculoMeta[] = [
  { key: "clt", label: "CLT" },
  { key: "pj", label: "PJ" },
  { key: "estagio", label: "Estágio" },
] as const;

export function isVinculo(v: unknown): v is VinculoKey {
  return v === "clt" || v === "pj" || v === "estagio";
}

export function vinculoLabel(key: string): string {
  return VINCULOS.find((v) => v.key === key)?.label ?? key;
}

// ─── Movimentações previstas ─────────────────────────────────────────────────

// 'admissao'     — o colaborador só passa a existir a partir do mês informado
//                  (contratação prevista para o meio do ano).
// 'movimentacao' — muda de cargo/salário a partir do mês.
// 'desligamento' — sai do quadro depois do mês (a folha do próprio mês ainda
//                  é contada por inteiro).
export type MovTipo = "admissao" | "movimentacao" | "desligamento";

export interface MovTipoMeta {
  key: MovTipo;
  label: string;
}

export const MOV_TIPOS: readonly MovTipoMeta[] = [
  { key: "admissao", label: "Admissão" },
  { key: "movimentacao", label: "Movimentação de cargo" },
  { key: "desligamento", label: "Desligamento" },
] as const;

export function isMovTipo(v: unknown): v is MovTipo {
  return v === "admissao" || v === "movimentacao" || v === "desligamento";
}

/** Tipos que trazem cargo e salário próprios (desligamento não traz). */
export function movTemCargo(tipo: MovTipo): boolean {
  return tipo === "admissao" || tipo === "movimentacao";
}

export function movTipoLabel(key: string): string {
  return MOV_TIPOS.find((m) => m.key === key)?.label ?? key;
}
