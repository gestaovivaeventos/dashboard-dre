// ─── DRE roles (módulo financeiro) ────────────────────────────────────────────
export type DreRole = "admin" | "gestor_hero" | "gestor_unidade";

/** Alias retrocompatível — código legado usa UserRole */
export type UserRole = DreRole;

// ─── Ctrl roles (módulo Controladoria) ────────────────────────────────────────
export type CtrlRole = "admin" | "solicitante" | "gerente" | "diretor" | "csc";

// ─── Acesso por módulo ────────────────────────────────────────────────────────
export interface ModuleAccess {
  dre: {
    role: DreRole;
    companyId: string | null;
  } | null;
  ctrl: {
    role: CtrlRole;
  } | null;
}

// ─── Perfil unificado ─────────────────────────────────────────────────────────
export interface UnifiedProfile {
  id: string;
  email: string;
  name: string | null;
  /** Role no módulo DRE — sempre presente */
  role: DreRole;
  /** Role no módulo Controladoria — null se sem acesso */
  ctrl_role: CtrlRole | null;
  company_id: string | null;
  active: boolean;
  created_at: string;
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
  | "aprovado"
  | "rejeitado"
  | "aguardando_complementacao"
  | "estornado"
  | "agendado"
  | "travado"
  | "inativado_csc"
  | "aguardando_aprovacao_fornecedor";

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
  | "fornecedor_rejeitado";

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
  created_by: string;
  approved_by: string | null;
  approved_at: string | null;
  rejected_at: string | null;
  scheduled_for: string | null;
  created_at: string;
  updated_at: string;
}

export interface CtrlNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  type: string;
  read: boolean;
  created_at: string;
}
