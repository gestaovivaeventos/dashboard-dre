"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  CSC_NAV_KEYS,
  CTRL_FULL_VIEW_NAV_KEYS,
  FRANQUEADO_NAV_KEYS,
  NAV_GROUPS,
  type NavGroup,
  type NavGroupId,
  type NavItem,
} from "@/components/app/navigation";
import { ModuleTourButton } from "@/components/app/tour/module-tour-button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  dreRole: DreRole | null;
  ctrlRoles?: CtrlRole[];
  canCase?: boolean;
  canViagens?: boolean;
  canViagensAprovar?: boolean;
  /** Módulo Validação de Contratos (grupo CONTRATOS). */
  canContratos?: boolean;
  segments: Segment[];
  activeSegmentSlug: string | null;
  collapsed?: boolean;
  onNavigate?: () => void;
  contractsOnly?: boolean;
  /**
   * Perfil 'franqueado': cai no dreRole 'gestor_unidade', que esconderia o
   * Business Intelligence. Quando true, a visibilidade do menu segue
   * FRANQUEADO_NAV_KEYS em vez do dreRole.
   */
  isFranqueado?: boolean;
  /**
   * Perfil 'csc': mesma mecânica do franqueado (cai em 'gestor_unidade'), mas
   * a whitelist inclui a tela "Validação Relatório".
   */
  isCsc?: boolean;
  /**
   * Libera o item "Validação Relatório" para quem NÃO é franqueado/CSC — ou
   * seja, admin e os e-mails nominais. Ver canAccessBiValidation.
   */
  canBiValidation?: boolean;
  /**
   * Visão completa do módulo Compras (override nominal — ver
   * @/lib/ctrl/full-view): mostra todo o grupo COMPRAS menos Configurações,
   * independentemente dos ctrlRoles do usuário.
   */
  ctrlFullView?: boolean;
}

interface RenderItem {
  key: string;
  title: string;
  href: string;
  icon: NavItem["icon"];
  badge?: number;
}

interface RenderGroup {
  id: NavGroupId;
  label: string;
  items: RenderItem[];
}

export function NavLinks({
  dreRole,
  ctrlRoles,
  canCase,
  canViagens,
  canViagensAprovar,
  canContratos,
  segments,
  activeSegmentSlug,
  collapsed,
  onNavigate,
  contractsOnly,
  isFranqueado,
  isCsc,
  canBiValidation,
  ctrlFullView,
}: NavLinksProps) {
  const pathname = usePathname();

  // contracts_only users see ONLY the Validacao de Contratos entry. We bypass
  // buildGroups (which filters by dreRoles) so the item still appears even
  // when the user's underlying role would normally hide it.
  const groups: RenderGroup[] = contractsOnly
    ? buildContractsOnlyGroups()
    : buildGroups({ dreRole, ctrlRoles, canCase, canViagens, canViagensAprovar, canContratos, segments, activeSegmentSlug, isFranqueado, isCsc, canBiValidation, ctrlFullView });

  const allHrefs = groups.flatMap((g) => g.items.map((i) => i.href));
  const activeHref =
    allHrefs
      .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null;

  if (groups.length === 0) {
    return (
      <p className="px-4 py-4 text-[12.5px] text-ink-muted">
        Sem acesso a nenhuma area — fale com um admin.
      </p>
    );
  }

  const renderItem = (item: RenderItem) => {
    const Icon = item.icon;
    // A home nao tem item correspondente no menu, entao nenhum item fica
    // destacado nela — o destaque so aparece dentro de um modulo.
    const isActive = item.href === activeHref;

    if (collapsed) {
      const collapsedLink = (
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={isActive ? "page" : undefined}
          className="ch-navitem ch-navitem--rail"
        >
          <Icon className="h-4 w-4 shrink-0" strokeWidth={2} />
        </Link>
      );
      return (
        <Tooltip key={item.key}>
          <TooltipTrigger asChild>{collapsedLink}</TooltipTrigger>
          <TooltipContent side="right">{item.title}</TooltipContent>
        </Tooltip>
      );
    }

    return (
      <Link
        key={item.key}
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className="ch-navitem"
      >
        <span className="truncate">{item.title}</span>
        {item.badge != null && <span className="ch-navitem__badge">{item.badge}</span>}
      </Link>
    );
  };

  return (
    <nav>
      {groups.map((group, idx) => (
        <div key={group.id}>
          {/* Modulo: sem numeracao, sem caixa — barra vermelha + regua. */}
          {!collapsed && (
            <div className="ch-module">
              <span>{group.label}</span>
              {/* Só rende algo nos grupos que têm tour (ver @/lib/tour) e para
                  quem tem aquele módulo — nos demais o componente devolve null. */}
              <ModuleTourButton navGroupId={group.id} />
            </div>
          )}
          {collapsed && idx > 0 && <div className="ch-rail-sep" aria-hidden />}
          <div className={cn("ch-nav", collapsed && "ch-nav--rail")}>
            {group.items.map((item) => renderItem(item))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/**
 * Chaves dos itens de menu que ESTE usuário enxerga.
 *
 * Existe para o tour guiado: é o gate de quais telas entram no roteiro. Derivar
 * do mesmo `buildGroups` que desenha o menu é o ponto — uma lista de perfis
 * paralela no conteúdo do tour sairia de sincronia na primeira mudança de
 * permissão, e em silêncio.
 */
export function visibleNavKeys(input: NavVisibilityInput): string[] {
  const groups = input.contractsOnly ? buildContractsOnlyGroups() : buildGroups(input);
  return groups.flatMap((group) => group.items.map((item) => item.key));
}

export type NavVisibilityInput = BuildInput & { contractsOnly?: boolean };

interface BuildInput {
  dreRole: DreRole | null;
  ctrlRoles?: CtrlRole[];
  canCase?: boolean;
  canViagens?: boolean;
  canViagensAprovar?: boolean;
  canContratos?: boolean;
  segments: Segment[];
  activeSegmentSlug: string | null;
  isFranqueado?: boolean;
  isCsc?: boolean;
  canBiValidation?: boolean;
  ctrlFullView?: boolean;
}

function buildContractsOnlyGroups(): RenderGroup[] {
  // Pull the canonical Validacao de Contratos item out of NAV_GROUPS so the
  // title/icon/href stay in sync with the rest of the nav config.
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (item.scope === "global" && item.href === "/contratos") {
        return [
          {
            id: group.id,
            label: group.label,
            items: [{ key: item.key, title: item.title, href: item.href!, icon: item.icon }],
          },
        ];
      }
    }
  }
  return [];
}

function buildGroups({
  dreRole,
  ctrlRoles,
  canCase,
  canViagens,
  canViagensAprovar,
  canContratos,
  segments,
  activeSegmentSlug,
  isFranqueado,
  isCsc,
  canBiValidation,
  ctrlFullView,
}: BuildInput): RenderGroup[] {
  const ctrlSet = new Set(ctrlRoles ?? []);
  const slug =
    activeSegmentSlug && segments.some((s) => s.slug === activeSegmentSlug)
      ? activeSegmentSlug
      : segments[0]?.slug ?? null;

  const result: RenderGroup[] = [];

  for (const group of NAV_GROUPS) {
    const items: RenderItem[] = [];

    for (const item of group.items) {
      if (!isItemVisible(item, dreRole, ctrlSet, Boolean(canCase), Boolean(canViagens), Boolean(canViagensAprovar), Boolean(canContratos), isFranqueado, isCsc, canBiValidation, ctrlFullView)) continue;

      const href = resolveHref(item, slug);
      if (!href) continue;

      items.push({ key: item.key, title: item.title, href, icon: item.icon });
    }

    if (items.length > 0) {
      result.push({ id: group.id, label: group.label, items });
    }
  }

  return result;
}

function isItemVisible(
  item: NavItem,
  dreRole: DreRole | null,
  ctrlSet: Set<CtrlRole>,
  canCase: boolean,
  canViagens: boolean,
  canViagensAprovar: boolean,
  canContratos: boolean,
  isFranqueado?: boolean,
  isCsc?: boolean,
  canBiValidation?: boolean,
  ctrlFullView?: boolean,
): boolean {
  // Validação de Contratos: módulo próprio, concedido por usuário. Não passa
  // por dreRole/ctrlRole nem pelas whitelists de franqueado/CSC — qualquer
  // perfil com o módulo enxerga o item.
  if (item.contratosAccess) return canContratos;

  // CSC: cópia do franqueado + a tela "Validação Relatório".
  if (isCsc) return CSC_NAV_KEYS.has(item.key);
  // Franqueado: a visibilidade não segue o dreRole (cai em 'gestor_unidade',
  // que esconderia o Business Intelligence). Mostra exatamente as telas da
  // whitelist, espelhando FRANQUEADO_BASE_PATHS em access.ts.
  if (isFranqueado) return FRANQUEADO_NAV_KEYS.has(item.key);

  // "Validação Relatório" não passa por dreRole/ctrlRole: whitelist própria.
  if (item.biValidationAccess) return Boolean(canBiValidation);

  // Visão completa do módulo Compras (override nominal): mostra o grupo inteiro
  // menos Configurações, mesmo que os ctrlRoles do usuário não bastassem. Só
  // ADICIONA itens — quem não tem o override segue nas regras abaixo.
  if (ctrlFullView && CTRL_FULL_VIEW_NAV_KEYS.has(item.key)) return true;

  const dreOk =
    item.dreRoles && dreRole !== null
      ? item.dreRoles.includes(dreRole)
      : false;
  const ctrlOk = item.ctrlRoles
    ? item.ctrlRoles.some((r) => ctrlSet.has(r))
    : false;
  const caseOk = item.caseAccess ? canCase : false;
  const viagensOk = item.viagensAccess
    ? canViagens && (!item.viagensAprovarOnly || canViagensAprovar)
    : false;

  if (
    !item.dreRoles &&
    !item.ctrlRoles &&
    !item.caseAccess &&
    !item.viagensAccess &&
    !item.contratosAccess
  )
    return false;
  return dreOk || ctrlOk || caseOk || viagensOk;
}

function resolveHref(item: NavItem, activeSlug: string | null): string | null {
  if (item.scope === "global") return item.href ?? null;
  if (!activeSlug || !item.suffix) return null;
  return `/s/${activeSlug}${item.suffix}`;
}

// Re-export for callers that want the type alongside this component.
export type { NavGroup };
