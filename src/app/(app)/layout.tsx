import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";
import { ORCAMENTO_NAV_KEY_PAINEL } from "@/lib/auth/orcamento";

export default async function ProtectedLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const { supabase, user, profile, modules } = await getCurrentSessionContext();

  if (!user) {
    redirect("/login");
  }

  const userName = profile?.name || user.email || "Usuario";
  const userEmail = profile?.email || user.email || "";
  const userRole = modules?.dre?.role ?? profile?.role ?? "gestor_unidade";
  // Papel DRE para o MENU: só quem realmente tem o módulo Financeiro. Sem isso,
  // perfis só-Compras (ex.: solicitante) herdariam o dreRole de compatibilidade
  // 'gestor_unidade' e veriam telas financeiras globais (ex.: "Documentos
  // anexos") no menu lateral. O `userRole` acima continua servindo o restante
  // do layout (resolveLayoutContext, query de segmentos).
  const navDreRole = modules?.dre?.role ?? null;
  const ctrlRoles = modules?.ctrl?.roles ?? [];
  const canCase = Boolean(modules?.case);
  const canViagens = Boolean(modules?.viagens);
  const canViagensAprovar = Boolean(modules?.viagens?.aprovador);
  const canContratos = Boolean(modules?.contratos);
  const vbRole = modules?.vb?.role ?? null;
  const canCaixa = Boolean(modules?.caixa);
  const orcamentoPapel = modules?.orcamento?.papel ?? null;
  const contractsOnly = profile?.contracts_only === true;
  const isFranqueado = profile?.profile === "franqueado";
  const isCsc = profile?.profile === "csc";
  const canBiValidation = canAccessBiValidation(profile);

  // Fetch segments the user has access to. Fonte única compartilhada com as
  // páginas DRE (resolveUserSegments): admin vê todos; os demais recebem a
  // UNIÃO de user_segment_access com os segmentos derivados das empresas em
  // user_company_access. A união (não fallback) é o que evita o seletor ficar
  // preso num único segmento quando o usuário tem 1 acesso explícito + várias
  // empresas em outros segmentos.
  const segments = await resolveUserSegments(supabase, {
    isAdmin: userRole === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  // Resolve module/segment context.
  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    userRole,
    ctrlRoles,
    segments,
    "dre",
    canCase,
    canViagens,
    vbRole !== null,
    canCaixa,
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;

  // O contador do Orçamento no menu contava pendências da VALIDAÇÃO (solicitação
  // da diretoria para o construtor; pedido de liberação para a diretoria). A
  // validação saiu do sistema em 24/09/2026 e será redesenhada — enquanto isso
  // não há pendência a contar, e o badge fica zerado em vez de sumir: a fiação
  // (`navBadges`) continua pronta para o contador novo.
  const pendenciasOrcamento = 0;

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={navDreRole}
      ctrlRoles={ctrlRoles}
      canCase={canCase}
      canViagens={canViagens}
      canViagensAprovar={canViagensAprovar}
      canContratos={canContratos}
      vbRole={vbRole}
      canCaixa={canCaixa}
      orcamentoPapel={orcamentoPapel}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      contractsOnly={contractsOnly}
      isFranqueado={isFranqueado}
      isCsc={isCsc}
      canBiValidation={canBiValidation}
      // Visão completa do módulo Compras (override nominal): só faz sentido
      // para quem já tem o módulo — não concede o módulo a ninguém.
      ctrlFullView={ctrlRoles.length > 0 && hasCtrlFullView(userEmail)}
      unreadNotifications={unreadNotifications}
      navBadges={{ [ORCAMENTO_NAV_KEY_PAINEL]: pendenciasOrcamento }}
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
