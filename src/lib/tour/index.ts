// Registro dos módulos com tour guiado.
//
// A ORDEM importa: é a ordem do menu, e é ela que decide qual tour dispara
// sozinho no primeiro acesso de quem tem os dois módulos (e qual é oferecido
// como continuação no fim).

import { COMPRAS_TOUR } from "@/lib/tour/compras";
import { FINANCEIRO_TOUR } from "@/lib/tour/financeiro";
import type { TourAudience, TourModule, TourModuleId, TourScreen } from "@/lib/tour/types";

export * from "@/lib/tour/types";

export const TOUR_MODULES: readonly TourModule[] = [FINANCEIRO_TOUR, COMPRAS_TOUR];

export function tourModuleById(id: TourModuleId): TourModule | null {
  return TOUR_MODULES.find((m) => m.id === id) ?? null;
}

/** Módulo cujo tour é ancorado neste grupo do menu (ver NAV_GROUPS). */
export function tourModuleForNavGroup(navGroupId: string): TourModule | null {
  return TOUR_MODULES.find((m) => m.navGroupId === navGroupId) ?? null;
}

/**
 * Perfil do usuário traduzido para o público-alvo dos passos.
 *
 * Perfil sem tour (validador de contratos, franqueado, CSC) devolve null: eles
 * não têm o módulo Compras, e no Financeiro nenhum passo usa `audiences`.
 * `franqueado`/`csc` cairiam em nenhuma variante se um passo passasse a usar —
 * por isso o filtro trata "sem audiência" como "vê só os passos sem variante".
 */
export function tourAudienceForProfile(profile: string | null | undefined): TourAudience | null {
  switch (profile) {
    case "admin":
      return "admin";
    case "contas_a_pagar":
      return "contas_a_pagar";
    case "diretor":
      return "diretor";
    case "gerente":
      return "gerente";
    case "gerente_setor":
      return "gerente_setor";
    case "solicitante":
      return "solicitante";
    default:
      return null;
  }
}

/**
 * Telas do módulo que ESTE usuário pode percorrer.
 *
 * O gate é o menu real (`navKeys` = as chaves que `buildNavGroups` montou para
 * ele), não uma lista de perfis mantida à mão no conteúdo do tour. Tela sem
 * `navKey` (a /home) é de todos.
 */
export function visibleTourScreens(
  tourModule: TourModule,
  navKeys: ReadonlySet<string>,
): TourScreen[] {
  return tourModule.screens.filter((screen) => !screen.navKey || navKeys.has(screen.navKey));
}

/** Passos da tela que fazem sentido para este perfil. */
export function stepsForAudience(screen: TourScreen, audience: TourAudience | null) {
  return screen.steps.filter((step) => {
    if (!step.audiences || step.audiences.length === 0) return true;
    return audience !== null && step.audiences.includes(audience);
  });
}
