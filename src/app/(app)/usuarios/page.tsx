import { redirect } from "next/navigation";

import { UsersAdminManager } from "@/components/app/users-admin-manager";
import { getCurrentSessionContext } from "@/lib/auth/session";

export default async function UsuariosPage() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    redirect("/login");
  }
  if (!profile || profile.role !== "admin") {
    redirect("/dashboard");
  }

  const [{ data: users }, { data: companies }] = await Promise.all([
    supabase
      .from("users")
      .select("id,email,name,role,company_id,active,companies(name)")
      .order("created_at", { ascending: false }),
    supabase.from("companies").select("id,name").eq("active", true).order("name"),
  ]);

  const usersData = (users ?? []).map((item) => ({
    id: item.id as string,
    email: item.email as string,
    name: ((item.name as string | null) ?? "") as string,
    role: item.role as "admin" | "gestor_hero" | "gestor_unidade",
    company_id: (item.company_id as string | null) ?? null,
    company_name: ((item.companies as { name?: string } | null)?.name ?? null) as string | null,
    active: Boolean(item.active),
  }));

  const companyOptions = (companies ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
  }));

  return <UsersAdminManager initialUsers={usersData} companies={companyOptions} />;
}
