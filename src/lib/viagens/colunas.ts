import type { ModalTrecho } from "@/lib/viagens/custo/tipos";

// =============================================================================
// Colunas e saneadores compartilhados pelos dois arquivos de action da viagem
// (`actions/viagens.ts` e `actions/viagens-entrevista.ts`).
//
// Vive num módulo PURO porque um arquivo `"use server"` só pode exportar função
// async — constante nenhuma sai de lá. E as duas actions precisam LER a viagem
// com a mesma lista de colunas: duplicar a lista é o tipo de divergência que faz
// o prompt da entrevista enxergar um roteiro diferente do que a tela mostra.
//
// As listas são string LITERAL porque o client tipado do Supabase analisa o
// `select` em tempo de compilação — template literal ou concatenação ele não
// entende. O lado bom é que coluna inexistente aqui vira erro de `tsc`, não
// erro em runtime.
// =============================================================================

export const VIAGEM_COLS =
  "id, titulo, finalidade, origem, data_ida, pessoas, pessoas_por_quarto, tipo_id, translado_custo_trajeto, translado_trajetos, volta_modal, volta_distancia_km, volta_preco_pessoa, volta_preco_total, volta_pedagios, volta_veiculos, outros, custo_total, meses, grupos, premissas, parametros, calculado_em, status, category_code, setor_id, updated_at";

export const PARADA_COLS =
  "id, ordem, cidade, noites, chegada_de, chegada_modal, chegada_distancia_km, chegada_preco_pessoa, chegada_preco_total, chegada_pedagios, chegada_veiculos, diaria_hotel, local_trajetos_dia, local_custo_trajeto, local_destino, local_endereco";

const MODAIS: readonly ModalTrecho[] = ["carro", "onibus", "aviao", "van", "outro"];

export function modalDaLinha(v: unknown): ModalTrecho {
  return MODAIS.includes(v as ModalTrecho) ? (v as ModalTrecho) : "outro";
}

/** `numeric` do Postgres pode chegar como string pelo PostgREST. */
export function numDaLinha(v: unknown): number | null {
  if (v == null || v === "") return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

export function textoDaLinha(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
