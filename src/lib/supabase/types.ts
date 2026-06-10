// ─── DRE roles (módulo financeiro) ────────────────────────────────────────────
export type DreRole = "admin" | "gestor_hero" | "gestor_unidade";

/** Alias retrocompatível — código legado usa UserRole */
export type UserRole = DreRole;

// ─── Ctrl roles (módulo Controladoria) ────────────────────────────────────────
// NOTA: na pratica funcionam como "permissoes" - um usuario pode ter varias
// simultaneamente (ex.: 'gerente' + 'aprovacao_fornecedor'). 'admin' e sempre
// derivado do DRE role, nunca persistido em user_module_roles.
export type CtrlRole =
  | "admin"
  | "solicitante"
  | "gerente"
  | "diretor"
  | "csc"
  | "contas_a_pagar"
  | "aprovacao_fornecedor";

// ─── Acesso por módulo ────────────────────────────────────────────────────────
export interface ModuleAccess {
  dre: {
    role: DreRole;
    companyId: string | null;
  } | null;
  ctrl: {
    /** Conjunto de permissoes no modulo. Vazio = sem acesso (equivale a null). */
    roles: CtrlRole[];
  } | null;
}

// ─── Perfil unificado (novo modelo) ──────────────────────────────────────────
// Six profiles cover all cases. Each user has exactly one. Module visibility
// is independent (can_financeiro, can_compras). Plataforma is implicit when
// profile === 'admin'.
export type UserProfileType =
  | "admin"
  | "contas_a_pagar"
  | "gerente"
  | "diretor"
  | "validador_contrato"
  | "solicitante"
  | "franqueado";

// ─── Perfil unificado ─────────────────────────────────────────────────────────
export interface UnifiedProfile {
  id: string;
  email: string;
  name: string | null;
  /** Tipo de perfil (novo modelo unificado). Sempre presente. */
  profile: UserProfileType;
  /** Visibilidade do módulo Financeiro (DRE). */
  can_financeiro: boolean;
  /** Visibilidade do módulo Compras (CTRL). */
  can_compras: boolean;
  /** Setores aos quais este usuário está vinculado (relevante pra Gerente/Solicitante). */
  sector_ids: string[];
  /** Empresas (unidades) que o usuário enxerga. Ignorado para admin (vê tudo). */
  company_ids: string[];
  active: boolean;
  created_at: string;

  // ── Compat layer (legado) ──────────────────────────────────────────────────
  // Derivados de `profile` + flags. Mantidos enquanto o código legado for
  // migrado pra usar `profile` diretamente. Não escreva diretamente — sempre
  // derive de profile/can_*.
  /** @deprecated derivado de profile + can_financeiro */
  role: DreRole;
  /** @deprecated derivado de profile + can_compras */
  ctrl_roles: CtrlRole[];
  /** @deprecated company_id "principal" (primeiro de company_ids); use company_ids */
  company_id: string | null;
  /** @deprecated equivalente a profile === 'validador_contrato' */
  contracts_only: boolean;
}

/** Alias retrocompatível — código legado usa UserProfile */
export type UserProfile = UnifiedProfile;

// ─── Outros tipos compartilhados ──────────────────────────────────────────────
export type SyncStatus = "success" | "error" | "running";

export interface Segment {
  id: string;
  name: string;
  slug: string;
  display_order: number;
  active: boolean;
}

export interface UserSegmentAccess {
  id: string;
  user_id: string;
  segment_id: string;
}

// ─── Tipos da Controladoria ───────────────────────────────────────────────────
export type CtrlRequestStatus =
  | "pendente"
  | "pendente_diretor"
  | "aprovado"
  | "rejeitado"
  | "aguardando_complementacao"
  | "estornado"
  | "agendado"
  | "travado"
  | "inativado_csc"
  | "aguardando_aprovacao_fornecedor"
  | "info_pagamento_pendente";

export type CtrlSupplierStatus = "pendente" | "aprovado" | "rejeitado";

export type CtrlHistoryAction =
  | "criado"
  | "aprovado"
  | "rejeitado"
  | "complementado"
  | "complementacao_solicitada"
  | "estornado"
  | "agendado"
  | "travado"
  | "inativado"
  | "fornecedor_aprovado"
  | "fornecedor_rejeitado"
  | "enviado_pagamento"
  | "info_solicitada"
  | "info_pagamento_solicitada"
  | "info_pagamento_respondida";

export interface CtrlSector {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
}

export interface CtrlExpenseType {
  id: string;
  name: string;
  created_at: string;
}

export interface CtrlSupplier {
  id: string;
  omie_id: number | null;
  name: string;
  cnpj_cpf: string | null;
  email: string | null;
  phone: string | null;
  status: CtrlSupplierStatus;
  rejection_reason: string | null;
  created_by: string | null;
  approved_by: string | null;
  approved_at: string | null;
  from_omie: boolean;
  created_at: string;
  updated_at: string;
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  transf_padrao: boolean;
  pix_padrao: boolean;
  omie_sync_required: boolean;
}

export interface CtrlSupplierOmieLink {
  id: string;
  supplier_id: string;
  company_id: string;
  omie_codigo_cliente: number | null;
  sync_status: "pendente" | "ok" | "erro";
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CtrlRequest {
  id: string;
  request_number: number;
  title: string;
  description: string | null;
  sector_id: string;
  expense_type_id: string | null;
  supplier_id: string | null;
  amount: number;
  due_date: string | null;
  status: CtrlRequestStatus;
  approval_level: number;
  approval_tier: "nivel_2" | "nivel_3" | null;
  // Etapa de origem guardada ao pedir complementação, para retornar a ela.
  complement_return_status: CtrlRequestStatus | null;
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
  // Payment
  payment_method: "boleto" | "pix" | "transferencia" | "cartao_credito" | "dinheiro" | null;
  reference_month: number | null;
  reference_year: number | null;
  bank_name: string | null;
  bank_agency: string | null;
  bank_account: string | null;
  bank_account_digit: string | null;
  bank_cpf_cnpj: string | null;
  pix_key: string | null;
  pix_key_type: string | null;
  favorecido: string | null;
  barcode: string | null;
  // Extra
  supplier_issues_invoice: string | null;
  invoice_number: string | null;
  invoice_attachment_path: string | null;
  justification: string | null;
  observations: string | null;
  is_budgeted: boolean;
  using_accumulated_balance: boolean;
  supplier_changed: boolean;
  supplier_change_justification: string | null;
  // Installments
  installment_number: number | null;
  installment_total: number | null;
  installment_group_id: string | null;
  // Recurrence
  is_recurring: boolean;
  recurrence_group_id: string | null;
  event_id: string | null;
  // Payment tracking
  sent_to_payment_at: string | null;
  sent_to_payment_by: string | null;
  paying_company: string | null;
  // Inactivation
  inactivated_at: string | null;
  inactivated_by: string | null;
  inactivation_reason: string | null;
  // Reversal
  reversed_at: string | null;
  reversal_reason: string | null;
  // Omie launch
  paying_company_id: string | null;
  omie_launch_status: "pendente" | "recebido" | "lancado" | "erro" | null;
  omie_contapagar_codigo: number | null;
  omie_launch_error: string | null;
  omie_launched_at: string | null;
}

export interface CtrlEvent {
  id: string;
  name: string;
  description: string | null;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CtrlRecurrenceGroup {
  id: string;
  original_request_id: string | null;
  months: number[];
  status: "ativo" | "cancelado";
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CtrlNotification {
  id: string;
  user_id: string;
  request_id: string | null;
  title: string;
  message: string;
  type: string;
  is_read: boolean;
  created_at: string;
}
