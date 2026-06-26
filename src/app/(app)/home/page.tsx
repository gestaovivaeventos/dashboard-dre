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
  const canFinanceiro = Boolean(modules?.dre);
  // Solicitante também vê Indicadores + Notícias econômicas na home (abaixo de
  // "Minhas Requisições"), embora não tenha acesso ao módulo financeiro.
  const showEconomic = canFinanceiro || profile?.profile === "solicitante";

  const caps = deriveCtrlCaps(ctrlRoles, sectorIds);

  let ctrlData: HomeCtrlData = {
    approvals: null,
    payments: null,
    myRequests: null,
    budget: null,
  };
  if (profile && (caps.canApprove || caps.canPay || caps.canRequest || caps.canBudget)) {
    ctrlData = await loadHomeCtrlData({
      userId: profile.id,
      roles: ctrlRoles,
      sectorIds,
      caps,
    });
  }

  return (
    <HomeView
      userName={userName}
      caps={caps}
      ctrlData={ctrlData}
      canFinanceiro={canFinanceiro}
      showEconomic={showEconomic}
    />
  );
}
