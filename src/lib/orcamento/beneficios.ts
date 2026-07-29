// Benefícios do quadro de pessoal (a "parte verde" da planilha) — valores
// MENSAIS por colaborador. As chaves batem 1:1 com as colunas da tabela
// orcamento_pessoal_colaboradores, então adicionar um benefício novo = entrada
// aqui + coluna na migration, sem mudar a action.
// Módulo "puro" (sem "use server"): importável por client e server.

import type { VinculoKey } from "@/lib/orcamento/vinculos";

export type BeneficioKey =
  | "vale_transporte"
  | "beneficio_gasolina"
  | "beneficio_alimentacao"
  | "refeicoes_empresa"
  | "assistencia_medica"
  | "auxilio_home_office"
  | "seguro_vida";

export interface BeneficioMeta {
  key: BeneficioKey;
  label: string;
  /** Se definido, o benefício só se aplica (célula habilitada) a este vínculo. */
  onlyVinculo?: VinculoKey;
}

// Ordem de exibição na aba de benefícios.
export const BENEFICIOS: readonly BeneficioMeta[] = [
  { key: "vale_transporte", label: "Vale transporte" },
  { key: "beneficio_gasolina", label: "Gasolina (flex.)" },
  { key: "beneficio_alimentacao", label: "Alimentação (flex.)" },
  { key: "refeicoes_empresa", label: "Refeições na empresa" },
  { key: "assistencia_medica", label: "Assistência médica" },
  { key: "auxilio_home_office", label: "Aux. home office" },
  { key: "seguro_vida", label: "Seguro de vida", onlyVinculo: "estagio" },
] as const;

/** Valores de benefício de um colaborador, indexados pela chave (= coluna). */
export type Beneficios = Record<BeneficioKey, number | null>;
