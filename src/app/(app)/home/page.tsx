import { redirect } from "next/navigation";

import { HomeView } from "@/components/app/home-view";
import { getCurrentSessionContext } from "@/lib/auth/session";
import {
  deriveCtrlCaps,
  loadHomeCtrlData,
  type HomeCtrlData,
} from "@/lib/home/ctrl-widgets";
import {
  deriveFinanceiroCaps,
  loadCaixaMes,
  loadKpisGrupo,
  loadMiniDreFranqueado,
  type FinProfile,
  type HomeCaixa,
  type HomeKpis,
  type HomeMiniDre,
} from "@/lib/home/financeiro-widgets";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { supabase, user, profile, modules } = await getCurrentSessionContext();
  if (!user) redirect("/login");

  const userName = profile?.name || user.email || "Usuário";
  const ctrlRoles = modules?.ctrl?.roles ?? [];
  const sectorIds = profile?.sector_ids ?? [];
  const canFinanceiro = Boolean(modules?.dre);

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

  const finProfile: FinProfile | null = profile
    ? {
        id: profile.id,
        role: profile.role,
        profile: profile.profile,
        company_ids: profile.company_ids ?? [],
      }
    : null;
  const finCaps = deriveFinanceiroCaps(finProfile, canFinanceiro);

  let kpis: HomeKpis | null = null;
  let caixa: HomeCaixa | null = null;
  let miniDre: HomeMiniDre | null = null;
  if (finProfile && finCaps.showGrupo) {
    [kpis, caixa] = await Promise.all([
      loadKpisGrupo(supabase, finProfile),
      loadCaixaMes(supabase, finProfile),
    ]);
  } else if (finProfile && finCaps.showMiniDre) {
    miniDre = await loadMiniDreFranqueado(supabase, finProfile);
  }

  return (
    <HomeView
      userName={userName}
      caps={caps}
      ctrlData={ctrlData}
      canFinanceiro={canFinanceiro}
      kpis={kpis}
      caixa={caixa}
      miniDre={miniDre}
    />
  );
}
