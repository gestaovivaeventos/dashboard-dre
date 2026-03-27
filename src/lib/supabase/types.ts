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
