// Tipos compartilhados do módulo Case entre client forms e server actions.

export type CaseLegKind = "pagar_custodia" | "receber_custodia" | "receber_servicos";
export type CaseContractStatus =
  | "rascunho"
  | "aguardando_assinatura"
  | "assinado"
  | "lancado"
  | "parcial"
  | "erro"
  | "cancelado";
export type CaseTitleStatus = "pendente" | "lancado" | "erro";

export interface CaseClientInput {
  /** Preenchido quando seleciona um cliente já cadastrado. */
  id?: string | null;
  name: string;
  cnpj_cpf: string | null;
  pessoa_fisica: boolean;
  email: string | null;
  phone: string | null;
  // Bloco CONTRATANTE do contrato de venda.
  resp_legal: string | null;
  cpf_resp_legal: string | null;
  endereco: string | null;
  cidade_estado: string | null;
  cep: string | null;
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

export type CaseTipoEvento = "aberto" | "fechado" | null;

/** Campos do modelo CASE Shows que não vinham do cadastro (checkboxes/testemunhas). */
export interface CaseContractExtras {
  espec_area_interna: boolean;
  espec_area_externa: boolean;
  espec_palco: boolean;
  espec_trio: boolean;
  extra_transporte_cidade: boolean;
  extra_translado_local: boolean;
  extra_diaria_alimentacao: boolean;
  extra_hospedagem: boolean;
  /** Item livre extra (ex.: "DJ residente da Aula da Saudade") — sai marcado no PDF. */
  extra_outros: string | null;
  rider_tecnico: boolean;
  rider_camarim: boolean;
  rider_pre_producao: boolean;
  tipo_evento: CaseTipoEvento;
  cortesias: string | null;
  data_assinatura: string | null; // ISO YYYY-MM-DD
  testemunha_1_nome: string | null;
  testemunha_1_cpf: string | null;
  testemunha_1_email: string | null; // testemunha assina pelo ClickSign
  testemunha_2_nome: string | null;
  testemunha_2_cpf: string | null;
}

export interface CreateContractInput extends CaseContractExtras {
  /** Nonce por submissão do form — evita contrato duplicado em cliques repetidos. */
  idempotency_key?: string | null;
  client: CaseClientInput;
  band: CaseBandInput;
  event_name: string | null;
  event_date: string | null; // ISO — Data do Evento
  show_time: string | null;
  show_duration: string | null;
  passagem_som: string | null;
  local_name: string | null;
  local_address: string | null;
  local_city: string | null;
  local_cep: string | null;
  especificacoes: string | null;
  valor_artista: number;
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  observacao: string | null;
  /** Contrato do artista (fonte do OCR), já no bucket. */
  attachment_path: string | null;
  parcelas_pagar_custodia: CaseParcelaInput[];
  parcelas_receber_custodia: CaseParcelaInput[];
  parcelas_receber_servicos: CaseParcelaInput[];
}

/** Etapa 1 — produção do contrato com o cliente (sem dados de pagamento ao artista). */
export interface Etapa1Input extends CaseContractExtras {
  idempotency_key?: string | null;
  /** Quando presente, atualiza um contrato existente (edição do rascunho). */
  contract_id?: string | null;
  client: CaseClientInput;
  /** A atração/artista fica na aba Contrato Atração — opcional no salvamento do cliente. */
  band?: CaseBandInput | null;
  event_name: string | null;
  event_date: string | null;
  show_time: string | null;
  show_duration: string | null;
  passagem_som: string | null;
  local_name: string | null;
  local_address: string | null;
  local_city: string | null;
  local_cep: string | null;
  especificacoes: string | null;
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  observacao: string | null;
  /** Parcelas a receber do cliente (valor total cobrado). */
  receber_schedule: CaseParcelaInput[];
}

/** Aba Contrato Atração — identidade do artista + anexo + (opcional) pagamento. */
export interface Etapa2Input {
  contract_id: string;
  /** Quando presente, edita uma atração existente; ausente cria uma nova. */
  atracao_id?: string | null;
  /** Identidade do artista/atração (seleção ou cadastro na própria aba). */
  band: CaseBandInput;
  /** Contrato do artista (fonte do OCR), já no bucket. */
  attachment_path?: string | null;
  /** Pagamento — opcional: dá pra salvar só banda+anexo e informar valor depois. */
  valor_artista?: number;
  parcelas_pagar?: CaseParcelaInput[];
}

/** Atração vinculada a um contrato (um contrato pode ter várias). */
export interface CaseAtracaoRow {
  id: string;
  band_id: string;
  band_name: string;
  band_cnpj_cpf: string | null;
  attachment_path: string | null;
  valor_artista: number;
  pagar_schedule: CaseParcelaInput[];
}

/** Fornecedor pago com a verba Rider/Camarim do contrato. */
export interface CaseFornecedorRow {
  id: string;
  band_id: string;
  band_name: string;
  band_cnpj_cpf: string | null;
  descricao: string | null;
  attachment_path: string | null;
  valor: number;
  pagar_schedule: CaseParcelaInput[];
}

/** Aba Contrato Atração — fornecedor da verba Rider/Camarim. */
export interface FornecedorInput {
  contract_id: string;
  /** Quando presente, edita um fornecedor existente; ausente cria um novo. */
  fornecedor_id?: string | null;
  band: CaseBandInput;
  descricao?: string | null;
  attachment_path?: string | null;
  valor: number;
  parcelas_pagar: CaseParcelaInput[];
}

export interface CaseClientRow {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  pessoa_fisica: boolean;
  email: string | null;
  phone: string | null;
  resp_legal: string | null;
  cpf_resp_legal: string | null;
  endereco: string | null;
  cidade_estado: string | null;
  cep: string | null;
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
