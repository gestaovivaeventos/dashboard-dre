import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";

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
  const contractsOnly = profile?.contracts_only === true;
  const isFranqueado = profile?.profile === "franqueado";

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
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;

  return (
    <AppShell
      userName={userName}
      userEmail={userEmail}
      userRole={navDreRole}
      ctrlRoles={ctrlRoles}
      canCase={canCase}
      canViagens={canViagens}
      canViagensAprovar={canViagensAprovar}
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      contractsOnly={contractsOnly}
      isFranqueado={isFranqueado}
      unreadNotifications={unreadNotifications}
    >
      {children}
    </AppShell>
  );
}
