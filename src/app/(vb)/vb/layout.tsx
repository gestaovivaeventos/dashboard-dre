import { redirect } from "next/navigation";

import { AppShell } from "@/components/app/app-shell";
import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getSessionContext } from "@/lib/auth/session";
import { VB_NAV_KEY_OMIE } from "@/lib/auth/vb";
import { resolveLayoutContext } from "@/lib/context/modules";
import { resolveUserSegments } from "@/lib/context/user-segments";
import { hasCtrlFullView } from "@/lib/ctrl/full-view";
import { getUnreadNotificationsCount } from "@/lib/ctrl/notifications";
import { countPendingMovements } from "@/lib/vb/omie/queries";

/**
 * Layout do módulo VB (Viva Bank). Espelha o do (case): monta o AppShell e
 * barra quem não tem a concessão do módulo — inclusive admin (ver
 * @/lib/auth/vb).
 */
export default async function VbLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getSessionContext();

  if (!ctx.user) redirect("/login");
  if (!ctx.modules?.vb) redirect("/");

  const { profile, supabase, modules } = ctx;
  const userName = profile?.name || ctx.user.email || "Usuario";
  const userEmail = profile?.email || ctx.user.email || "";
  const dreRole = modules.dre?.role ?? profile?.role ?? "gestor_unidade";
  const navDreRole = modules.dre?.role ?? null;
  const ctrlRoles = modules.ctrl?.roles ?? [];
  const canCase = Boolean(modules.case);
  const canViagens = Boolean(modules.viagens);
  const canViagensAprovar = Boolean(modules.viagens?.aprovador);
  const canContratos = Boolean(modules.contratos);
  const vbRole = modules.vb?.role ?? null;

  const segments = await resolveUserSegments(supabase, {
    isAdmin: dreRole === "admin",
    userId: profile?.id ?? null,
    companyIds: profile?.company_ids ?? [],
  });

  const { availableModules, activeModule, activeSegmentSlug } = await resolveLayoutContext(
    dreRole,
    ctrlRoles,
    segments,
    "vb",
    canCase,
    canViagens,
    vbRole !== null,
  );

  const unreadNotifications = profile?.id
    ? await getUnreadNotificationsCount(profile.id)
    : 0;
  // O menu nunca derruba o app: falha na contagem vira zero.
  const omiePending = vbRole === "gestor" ? await countPendingMovements().catch(() => 0) : 0;

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
      segments={segments}
      activeModule={activeModule}
      availableModules={availableModules}
      activeSegmentSlug={activeSegmentSlug}
      canBiValidation={canAccessBiValidation(profile)}
      ctrlFullView={ctrlRoles.length > 0 && hasCtrlFullView(userEmail)}
      unreadNotifications={unreadNotifications}
      navBadges={{ [VB_NAV_KEY_OMIE]: omiePending }}
      userProfile={profile?.profile ?? null}
      tourSeen={profile?.tour_seen ?? false}
    >
      {children}
    </AppShell>
  );
}
