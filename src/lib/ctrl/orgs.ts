import type { SupabaseClient } from "@supabase/supabase-js";

import { readActiveCtrlOrgSlug } from "@/lib/context/active-context";

// Empresa do Compras (a "organização de compras" — grupo de CNPJs). Ver
// docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md.

export interface CtrlOrg {
  id: string;
  nome: string;
  slug: string;
}

export interface CtrlOrgContext {
  /** Empresas que o usuário pode acessar (admin → todas as ativas). */
  orgs: CtrlOrg[];
  orgIds: string[];
  /** Empresa ativa (cookie validado contra `orgs`; senão a 1ª). null só se não há empresa. */
  activeOrgId: string | null;
  activeOrg: CtrlOrg | null;
}

/**
 * Empresas do Compras que o usuário pode acessar + qual está ativa.
 *
 * A RLS de `ctrl_orgs` já faz o recorte (admin vê todas; os demais só as
 * concedidas em `ctrl_user_orgs`), então basta ler a tabela com o client do
 * usuário — não é preciso saber aqui se é admin.
 *
 * A empresa ativa vem do cookie `active_ctrl_org`, validada contra a lista; se o
 * cookie estiver ausente ou apontar para uma empresa que o usuário não acessa,
 * cai na primeira (nunca erra por cookie velho).
 */
export async function getCtrlOrgContext(supabase: SupabaseClient): Promise<CtrlOrgContext> {
  const { data } = await supabase
    .from("ctrl_orgs")
    .select("id, nome, slug")
    .eq("ativo", true)
    .order("nome");
  const orgs = ((data ?? []) as CtrlOrg[]) ?? [];
  const orgIds = orgs.map((o) => o.id);

  const slug = await readActiveCtrlOrgSlug();
  const active = (slug ? orgs.find((o) => o.slug === slug) : undefined) ?? orgs[0] ?? null;

  return {
    orgs,
    orgIds,
    activeOrgId: active?.id ?? null,
    activeOrg: active ?? null,
  };
}

/**
 * CNPJs pagadores de uma empresa — alimenta o picker de empresa pagadora do
 * Contas a Pagar (restringe o pagamento aos CNPJs da empresa ativa). Lazy: só é
 * chamado onde o pagador importa, para não pesar em todo `getCtrlUser`.
 */
export async function getOrgCompanyIds(
  supabase: SupabaseClient,
  orgId: string | null,
): Promise<string[]> {
  if (!orgId) return [];
  const { data } = await supabase
    .from("ctrl_org_companies")
    .select("company_id")
    .eq("org_id", orgId);
  return (data ?? []).map((r) => r.company_id as string);
}
