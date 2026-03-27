import { redirect } from "next/navigation";

import { UsersAdminManager } from "@/components/app/users-admin-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export default async function UsuariosPage() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const adminClient = createAdminClient();

  const [{ data: users }, { data: companies }, { data: segments }, { data: segAccessData }, { data: compAccessData }] = await Promise.all([
    supabase
      .from("users")
      .select("id,email,name,role,company_id,active,companies(name)")
      .order("created_at", { ascending: false }),
    supabase.from("companies").select("id,name,segment_id").eq("active", true).order("name"),
    supabase.from("segments").select("id,name,slug").eq("active", true).order("display_order"),
    adminClient.from("user_segment_access").select("user_id,segment_id"),
    adminClient.from("user_company_access").select("user_id,company_id"),
  ]);

  const segmentNames = new Map((segments ?? []).map((s) => [s.id as string, s.name as string]));
  const companyNames = new Map((companies ?? []).map((c) => [c.id as string, c.name as string]));

  const userSegments = new Map<string, string[]>();
  (segAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const name = segmentNames.get(row.segment_id as string);
    if (name) {
      const list = userSegments.get(uid) ?? [];
      list.push(name);
      userSegments.set(uid, list);
    }
  });

  const userCompanies = new Map<string, string[]>();
  (compAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const name = companyNames.get(row.company_id as string);
    if (name) {
      const list = userCompanies.get(uid) ?? [];
      list.push(name);
      userCompanies.set(uid, list);
    }
  });

  const usersData = (users ?? []).map((item) => ({
    id: item.id as string,
    email: item.email as string,
    name: ((item.name as string | null) ?? "") as string,
    role: item.role as "admin" | "gestor_hero" | "gestor_unidade",
    company_id: (item.company_id as string | null) ?? null,
    company_name: ((item.companies as { name?: string } | null)?.name ?? null) as string | null,
    active: Boolean(item.active),
    segment_names: userSegments.get(item.id as string) ?? [],
    company_names: userCompanies.get(item.id as string) ?? [],
  }));

  const companyOptions = (companies ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
    segment_id: (company.segment_id as string | null) ?? null,
  }));

  const segmentOptions = (segments ?? []).map((s) => ({
    id: s.id as string,
    name: s.name as string,
  }));

  return (
    <UsersAdminManager
      initialUsers={usersData}
      companies={companyOptions}
      segments={segmentOptions}
    />
  );
}
