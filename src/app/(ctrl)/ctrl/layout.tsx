import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { getCtrlOrgContext } from "@/lib/ctrl/orgs";
import { resolveCtrlRolesForOrg } from "@/lib/ctrl/roles";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";

export default async function CtrlLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.modules?.ctrl) redirect("/dashboard");

  const { profile, supabase, modules } = ctx;
  const userName  = profile?.name || ctx.user.email || "Usuario";
  const userEmail = profile?.email || ctx.user.email || "";
  // dreRole pode não vir em `modules.dre` quando o user só tem Compras
  // (can_financeiro=false). Fallback pro role legado derivado em
  // session.ts → garante que o AppShell receba um valor válido.
  const dreRole   = modules.dre?.role ?? profile?.role ?? "gestor_unidade";
  // Papel DRE para o MENU: só quem realmente tem o módulo Financeiro. Sem isso,
  // perfis só-Compras (ex.: solicitante) herdariam o fallback 'gestor_unidade'
  // e veriam telas financeiras globais (ex.: "Documentos anexos") no menu — o
  // mesmo tratamento do layout (app). `dreRole` acima segue servindo o resto.
  const navDreRole = modules.dre?.role ?? null;
  const ctrlRoles = modules.ctrl?.roles ?? [];
  const canCase = Boolean(modules.case);
  const canViagens = Boolean(modules.viagens);
  const canViagensAprovar = Boolean(modules.viagens?.aprovador);
  const canContratos = Boolean(modules.contratos);
  const vbRole = modules.vb?.role ?? null;
  const canCaixa = Boolean(modules.caixa);
  const orcamentoPapel = modules.orcamento?.papel ?? null;
  const canDp = Boolean(modules.dp);

  // Segmentos para o shell DRE — fonte única compartilhada com o (app) layout
  // e as páginas DRE (resolveUserSegments): admin vê todos; os demais recebem a
  // UNIÃO de user_segment_access com os segmentos derivados das empresas em
  // user_company_access. Sem a união, um perfil com 1 acesso explícito + várias
  // empresas em outros segmentos (ou só acesso por unidade) ficava preso num
  // único segmento → itens scope:"segment" do menu Financeiro somem/limitam.
  const segments = await resolveUserSegments(supabase, {
    isAdmin: dreRole === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  // Resolve module/segment context — ctrl layout always lands in ctrl module.
  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    dreRole,
    ctrlRoles,
    segments,
    "ctrl",
    canCase,
    canViagens,
    vbRole !== null,
    canCaixa,
    canDp,
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;

  // Empresas do Compras (multiempresa) para o seletor do cabeçalho.
  const orgCtx = await getCtrlOrgContext(supabase);

  // Papéis do Compras NA EMPRESA ATIVA — alimentam o MENU lateral do Compras
  // (quais itens aparecem). O override por empresa estreita aqui; com override
  // NULL, é igual ao global. A DISPONIBILIDADE do módulo (resolveLayoutContext
  // acima) segue no papel GLOBAL, de propósito: o usuário tem de poder entrar no
  // Compras e trocar de empresa independentemente da empresa ativa. Como o papel
  // por empresa nunca é vazio para quem tem o módulo, isso nunca o esconde.
  const ctrlRolesActiveOrg = resolveCtrlRolesForOrg(
    profile?.profile ?? null,
    ctrlRoles,
    orgCtx.activeOrgRole,
  );

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={navDreRole}
      ctrlRoles={ctrlRolesActiveOrg}
      canCase={canCase}
      canViagens={canViagens}
      canViagensAprovar={canViagensAprovar}
      canContratos={canContratos}
      vbRole={vbRole}
      canCaixa={canCaixa}
      orcamentoPapel={orcamentoPapel}
      canDp={canDp}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      ctrlOrgs={orgCtx.orgs}
      activeCtrlOrgSlug={orgCtx.activeOrg?.slug ?? null}
      canBiValidation={canAccessBiValidation(profile)}
      // Visão completa do módulo Compras (override nominal): só faz sentido
      // para quem já tem o módulo — não concede o módulo a ninguém.
      ctrlFullView={ctrlRoles.length > 0 && hasCtrlFullView(userEmail)}
      unreadNotifications={unreadNotifications}
      // Perfil unificado: o tour guiado usa para escolher a variante de texto
      // dos passos que mudam conforme quem lê (os cinco perfis do Compras).
      userProfile={profile?.profile ?? null}
      // Tour guiado: aparece sozinho uma única vez por usuário. A marca vive em
      // user_module_roles (module='tour') — ver @/lib/tour/seen.
      tourSeen={profile?.tour_seen ?? false}
    >
      {children}
    </AppShell>
  );
}
