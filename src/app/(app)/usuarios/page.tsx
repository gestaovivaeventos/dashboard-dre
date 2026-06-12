import { redirect } from "next/navigation";

import { UsersAdminManager } from "@/components/app/users-admin-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export default async function UsuariosPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.profile !== "admin") redirect("/dashboard");

  const adminClient = createAdminClient();

  const [
    { data: users },
    { data: companies },
    { data: sectors },
    { data: compAccessData },
    { data: sectorAccessData },
  ] = await Promise.all([
    adminClient
      .from("users")
      .select(
        "id,email,name,phone,position,profile,can_financeiro,can_compras,active,created_at",
      )
      .order("name", { ascending: true, nullsFirst: false }),
    adminClient.from("companies").select("id,name").eq("active", true).order("name"),
    adminClient.from("ctrl_sectors").select("id,name").eq("active", true).order("name"),
    adminClient.from("user_company_access").select("user_id,company_id"),
    adminClient.from("user_sectors").select("user_id,sector_id"),
  ]);

  const companyById = new Map((companies ?? []).map((c) => [c.id as string, c.name as string]));
  const sectorById = new Map((sectors ?? []).map((s) => [s.id as string, s.name as string]));

  const userCompanies = new Map<string, string[]>();
  (compAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const cid = row.company_id as string;
    if (!companyById.has(cid)) return;
    const list = userCompanies.get(uid) ?? [];
    list.push(cid);
    userCompanies.set(uid, list);
  });

  const userSectors = new Map<string, string[]>();
  (sectorAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const sid = row.sector_id as string;
    if (!sectorById.has(sid)) return;
    const list = userSectors.get(uid) ?? [];
    list.push(sid);
    userSectors.set(uid, list);
  });

  const usersData = (users ?? []).map((item) => ({
    id: item.id as string,
    email: item.email as string,
    name: ((item.name as string | null) ?? "") as string,
    phone: (item.phone as string | null) ?? "",
    position: (item.position as string | null) ?? "",
    profile: (item.profile as string | null) ?? "solicitante",
    can_financeiro: Boolean(item.can_financeiro),
    can_compras: Boolean(item.can_compras),
    active: Boolean(item.active),
    company_ids: userCompanies.get(item.id as string) ?? [],
    sector_ids: userSectors.get(item.id as string) ?? [],
  }));

  return (
    <UsersAdminManager
      initialUsers={usersData}
      companies={(companies ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))}
      sectors={(sectors ?? []).map((s) => ({ id: s.id as string, name: s.name as string }))}
    />
  );
}
