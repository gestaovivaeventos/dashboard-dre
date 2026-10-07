import { redirect } from "next/navigation";

import { UsersAdminManager } from "@/components/app/users-admin-manager";
import { fetchCaixaGrantUserIds } from "@/lib/auth/caixa";
import { fetchOrcamentoGrantUserIds } from "@/lib/auth/orcamento";
import { nomesUnicos } from "@/lib/orcamento/setor-atribuicao";
import { fetchContratosGrantUserIds } from "@/lib/auth/contratos";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { isCtrlOrgRole, type CtrlOrgRole } from "@/lib/ctrl/roles";
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
    { data: ctrlOrgsData },
    { data: ctrlOrgAccessData },
  ] = await Promise.all([
    adminClient
      .from("users")
      .select(
        "id,email,name,phone,position,profile,can_financeiro,can_compras,can_case,can_viagens,can_viagens_aprovar,active,created_at",
      )
      .order("name", { ascending: true, nullsFirst: false }),
    adminClient.from("companies").select("id,name").eq("active", true).order("name"),
    // org_id em ctrl_sectors (multiempresa): o seletor da tela agrupa por empresa.
    adminClient.from("ctrl_sectors").select("id,name,org_id").eq("active", true).order("name"),
    adminClient.from("user_company_access").select("user_id,company_id"),
    adminClient.from("user_sectors").select("user_id,sector_id"),
    // Empresas do Compras (multiempresa) e as concessões por usuário.
    adminClient.from("ctrl_orgs").select("id,nome,slug").eq("ativo", true).order("nome"),
    adminClient.from("ctrl_user_orgs").select("user_id,org_id,role"),
  ]);

  // Módulo Validação de Contratos: a concessão mora em user_module_roles, não
  // numa coluna de `users` (ver @/lib/auth/contratos).
  const contratosUserIds = await fetchContratosGrantUserIds(adminClient);
  // Modulo Caixa: mesma ideia (ver @/lib/auth/caixa).
  const caixaUserIds = await fetchCaixaGrantUserIds(adminClient);
  // Modulo Orcamento: mesma ideia (ver @/lib/auth/orcamento).
  const orcamentoUserIds = await fetchOrcamentoGrantUserIds(adminClient);

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

  // Empresas do Compras (multiempresa) concedidas por usuário + o papel por
  // empresa (override). role NULL/ausente = usa o perfil global.
  const orgById = new Map((ctrlOrgsData ?? []).map((o) => [o.id as string, o]));
  const userCtrlOrgs = new Map<string, string[]>();
  const userCtrlOrgRoles = new Map<string, Record<string, CtrlOrgRole>>();
  (ctrlOrgAccessData ?? []).forEach((row) => {
    const uid = row.user_id as string;
    const oid = row.org_id as string;
    if (!orgById.has(oid)) return;
    const list = userCtrlOrgs.get(uid) ?? [];
    list.push(oid);
    userCtrlOrgs.set(uid, list);
    const role = (row as { role?: string | null }).role ?? null;
    if (isCtrlOrgRole(role)) {
      const roles = userCtrlOrgRoles.get(uid) ?? {};
      roles[oid] = role;
      userCtrlOrgRoles.set(uid, roles);
    }
  });

  // Uma consulta para a lista inteira: a tela abre com o mapa pronto, e buscar
  // por usuário faria N requisições só para desenhar o formulário.
  const orcamentoSetores = new Map<string, Record<string, string[]>>();
  {
    const { data } = await adminClient
      .from("orcamento_user_setores")
      .select("user_id, company_id, setor_nome");
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      const uid = row.user_id as string;
      const mapa = orcamentoSetores.get(uid) ?? {};
      (mapa[row.company_id as string] ??= []).push(row.setor_nome as string);
      orcamentoSetores.set(uid, mapa);
    }
  }

  // Setores do ORÇAMENTO por empresa, para o seletor da tela. De TODOS os anos,
  // deduplicados por nome: a atribuição é year-agnostic (casa por nome), e o
  // mesmo setor aparece uma vez por ano clonado.
  const orcamentoSetoresPorEmpresa: Record<string, string[]> = {};
  {
    const { data } = await adminClient
      .from("orcamento_setores")
      .select("company_id, name, active");
    const porEmpresa = new Map<string, string[]>();
    for (const row of (data ?? []) as Array<Record<string, unknown>>) {
      if (row.active === false) continue;
      const cid = row.company_id as string;
      porEmpresa.set(cid, [...(porEmpresa.get(cid) ?? []), (row.name as string) ?? ""]);
    }
    for (const [cid, nomes] of Array.from(porEmpresa.entries())) {
      orcamentoSetoresPorEmpresa[cid] = nomesUnicos(nomes).sort((a: string, b: string) =>
        a.localeCompare(b, "pt-BR", { sensitivity: "base" }),
      );
    }
  }

  const usersData = (users ?? []).map((item) => ({
    id: item.id as string,
    email: item.email as string,
    name: ((item.name as string | null) ?? "") as string,
    phone: (item.phone as string | null) ?? "",
    position: (item.position as string | null) ?? "",
    profile: (item.profile as string | null) ?? "solicitante",
    can_financeiro: Boolean(item.can_financeiro),
    can_compras: Boolean(item.can_compras),
    can_case: Boolean(item.can_case),
    can_viagens: Boolean(item.can_viagens),
    can_viagens_aprovar: Boolean(item.can_viagens_aprovar),
    // O perfil 'validador_contrato' implica o módulo mesmo sem a linha.
    can_contratos:
      contratosUserIds.has(item.id as string) || item.profile === "validador_contrato",
    // Admin enxerga o Caixa sem a linha (modelo do Case/Contratos).
    can_caixa: caixaUserIds.has(item.id as string) || item.profile === "admin",
    can_orcamento:
      orcamentoUserIds.has(item.id as string) || item.profile === "admin",
    // Setores do Orçamento são POR EMPRESA (migration 20260929120000) — e por
    // isso não cabem em `sector_ids`, que é o recorte do Compras.
    orcamento_setores: orcamentoSetores.get(item.id as string) ?? {},
    active: Boolean(item.active),
    company_ids: userCompanies.get(item.id as string) ?? [],
    sector_ids: userSectors.get(item.id as string) ?? [],
    // Empresas do Compras (multiempresa). Admin herda todas via RLS — não precisa
    // de linha; para os demais, é o que define o acesso por empresa.
    ctrl_org_ids: userCtrlOrgs.get(item.id as string) ?? [],
    // Papel do Compras por empresa (override). Ausência = usa o perfil global.
    ctrl_org_roles: userCtrlOrgRoles.get(item.id as string) ?? {},
  }));

  return (
    <UsersAdminManager
      initialUsers={usersData}
      companies={(companies ?? []).map((c) => ({ id: c.id as string, name: c.name as string }))}
      orcamentoSetores={orcamentoSetoresPorEmpresa}
      sectors={(sectors ?? []).map((s) => ({
        id: s.id as string,
        name: s.name as string,
        orgId: (s.org_id as string | null) ?? null,
      }))}
      ctrlOrgs={(ctrlOrgsData ?? []).map((o) => ({
        id: o.id as string,
        nome: o.nome as string,
        slug: o.slug as string,
      }))}
    />
  );
}
