import { redirect } from "next/navigation";

import { HomeView } from "@/components/app/home-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  deriveCtrlCaps,
  loadHomeCtrlData,
  type HomeCtrlData,
} from "@/lib/home/ctrl-widgets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { user, profile, modules } = await getCurrentSessionContext();
  if (!user) redirect("/login");

  const userName = profile?.name || user.email || "Usuário";
  const ctrlRoles = modules?.ctrl?.roles ?? [];
  const sectorIds = profile?.sector_ids ?? [];
  // Alertas do Sistema (sync, mapeamento, integração) são administração da
  // plataforma — só o perfil Admin. Indicadores e Notícias econômicas, ao
  // contrário, valem para todos os perfis e não dependem de módulo.
  const isAdmin = profile?.profile === "admin";

  const caps = deriveCtrlCaps(ctrlRoles, sectorIds);

  let ctrlData: HomeCtrlData = {
    approvals: null,
    payments: null,
    myRequests: null,
    budget: null,
    suppliers: null,
  };
  if (
    profile &&
    (caps.canApprove || caps.canPay || caps.canRequest || caps.canBudget || caps.canHomologate)
  ) {
    ctrlData = await loadHomeCtrlData({
      userId: profile.id,
      sectorIds,
      caps,
    });
  }

  return (
    <HomeView
      userName={userName}
      caps={caps}
      ctrlData={ctrlData}
      isAdmin={Boolean(isAdmin)}
    />
  );
}
