// Tipos compartilhados do módulo Case entre client forms e server actions.

export type CaseLegKind = "pagar_custodia" | "receber_custodia" | "receber_servicos";
export type CaseContractStatus = "rascunho" | "lancado" | "parcial" | "erro" | "cancelado";
export type CaseTitleStatus = "pendente" | "lancado" | "erro";

export interface CaseClientInput {
  /** Preenchido quando seleciona um cliente já cadastrado. */
  id?: string | null;
  name: string;
  cnpj_cpf: string | null;
  pessoa_fisica: boolean;
  email: string | null;
  phone: string | null;
}

export interface CaseBandInput {
  id?: string | null;
  name: string;
  cnpj_cpf: string | null;
  pessoa_fisica: boolean;
  email: string | null;
  phone: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  chave_pix: string | null;
}

export interface CaseParcelaInput {
  /** ISO date YYYY-MM-DD */
  vencimento: string;
  valor: number;
}

export interface CreateContractInput {
  client: CaseClientInput;
  band: CaseBandInput;
  event_name: string | null;
  event_date: string | null; // ISO
  valor_artista: number;
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  observacao: string | null;
  attachment_path: string | null;
  parcelas_pagar_custodia: CaseParcelaInput[];
  parcelas_receber_custodia: CaseParcelaInput[];
  parcelas_receber_servicos: CaseParcelaInput[];
}

export interface CaseClientRow {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  pessoa_fisica: boolean;
  email: string | null;
  phone: string | null;
}

export interface CaseBandRow {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  pessoa_fisica: boolean;
  email: string | null;
  phone: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  chave_pix: string | null;
}

export interface CaseOmieConfigRow {
  codigo_categoria_custodia: string | null;
  codigo_categoria_servicos: string | null;
  codigo_conta_corrente: string | null;
}
