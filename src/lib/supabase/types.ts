export type UserRole = "admin" | "gestor_hero" | "gestor_unidade";

export interface UserProfile {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  company_id: string | null;
  active: boolean;
  created_at: string;
}

export type SyncStatus = "success" | "error" | "running";
