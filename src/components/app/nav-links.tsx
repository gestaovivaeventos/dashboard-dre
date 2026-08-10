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

const MODULE_COLOR: Record<
  NavGroupId,
  { text: string; bg: string; rail: string; dot: string }
> = {
  financeiro: {
    text: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-600/[0.06] dark:bg-blue-400/[0.08]",
    rail: "bg-blue-600 dark:bg-blue-400",
    dot: "bg-blue-600 dark:bg-blue-400",
  },
  orcamento: {
    text: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-600/[0.06] dark:bg-emerald-400/[0.08]",
    rail: "bg-emerald-600 dark:bg-emerald-400",
    dot: "bg-emerald-600 dark:bg-emerald-400",
  },
  compras: {
    text: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-600/[0.06] dark:bg-violet-400/[0.08]",
    rail: "bg-violet-600 dark:bg-violet-400",
    dot: "bg-violet-600 dark:bg-violet-400",
  },
  case: {
    text: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-600/[0.06] dark:bg-amber-400/[0.08]",
    rail: "bg-amber-600 dark:bg-amber-400",
    dot: "bg-amber-600 dark:bg-amber-400",
  },
  viagens: {
    text: "text-teal-600 dark:text-teal-400",
    bg: "bg-teal-600/[0.06] dark:bg-teal-400/[0.08]",
    rail: "bg-teal-600 dark:bg-teal-400",
    dot: "bg-teal-600 dark:bg-teal-400",
  },
  contratos: {
    text: "text-orange-600 dark:text-orange-400",
    bg: "bg-orange-600/[0.06] dark:bg-orange-400/[0.08]",
    rail: "bg-orange-600 dark:bg-orange-400",
    dot: "bg-orange-600 dark:bg-orange-400",
  },
  plataforma: {
    text: "text-slate-600 dark:text-slate-300",
    bg: "bg-slate-600/[0.06] dark:bg-slate-400/[0.08]",
    rail: "bg-slate-600 dark:bg-slate-400",
    dot: "bg-slate-600 dark:bg-slate-400",
  },
};

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
      <p className="px-3 py-4 text-sm text-ink-muted">
        Sem acesso a nenhuma area — fale com um admin.
      </p>
    );
  }

  const renderItem = (item: RenderItem, groupId: NavGroupId) => {
    const Icon = item.icon;
    const isActive = item.href === activeHref;
    const color = MODULE_COLOR[groupId];

    if (collapsed) {
      const collapsedLink = (
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={isActive ? "page" : undefined}
          className={cn(
            "relative flex h-9 w-full items-center justify-center rounded-md transition-colors",
            isActive
              ? cn(color.bg, color.text)
              : "text-ink-secondary hover:bg-surface-2 hover:text-ink-primary",
          )}
        >
          {isActive && (
            <span
              aria-hidden
              className={cn(
                "absolute left-0 top-[6px] bottom-[6px] w-[2px] rounded-sm",
                color.rail,
              )}
            />
          )}
          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
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
        className={cn(
          "relative flex h-[30px] items-center gap-2.5 rounded-md px-3 text-[12.5px] transition-colors",
          isActive
            ? cn(color.text, color.bg, "font-semibold")
            : "text-ink-secondary hover:bg-surface-2 hover:text-ink-primary",
        )}
      >
        {isActive && (
          <span
            aria-hidden
            className={cn(
              "absolute left-0 top-[6px] bottom-[6px] w-[2px] rounded-sm",
              color.rail,
            )}
          />
        )}
        <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} />
        <span className="flex-1 truncate">{item.title}</span>
        {item.badge != null && (
          <span
            className={cn(
              "text-[10px] font-semibold tabular-nums",
              color.text,
              !isActive && "opacity-80",
            )}
          >
            {item.badge}
          </span>
        )}
      </Link>
    );
  };

  return (
    <nav className={collapsed ? "space-y-1" : "space-y-0.5"}>
      {groups.map((group, idx) => {
        const color = MODULE_COLOR[group.id];
        return (
          <div key={group.id} className={idx === 0 ? undefined : "mt-2"}>
            {!collapsed && (
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
                <span
                  aria-hidden
                  className={cn("h-[5px] w-[5px] rounded-full", color.dot)}
                />
                <span
                  className={cn(
                    "text-[10px] font-semibold uppercase tracking-[0.12em]",
                    color.text,
                  )}
                >
                  {group.label}
                </span>
              </div>
            )}
            {collapsed && idx > 0 && (
              <div className="my-2 border-t border-border" />
            )}
            <div className={collapsed ? "space-y-1" : "space-y-px"}>
              {group.items.map((item) => renderItem(item, group.id))}
            </div>
          </div>
        );
      })}
    </nav>
  );
}

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
  // CSC: cópia do franqueado + a tela "Validação Relatório".
  if (isCsc) return CSC_NAV_KEYS.has(item.key);
  // Franqueado: a visibilidade não segue o dreRole (cai em 'gestor_unidade',
  // que esconderia o Business Intelligence). Mostra exatamente as telas da
  // whitelist, espelhando FRANQUEADO_BASE_PATHS em access.ts.
  if (isFranqueado) return FRANQUEADO_NAV_KEYS.has(item.key);

  // "Validação Relatório" não passa por dreRole/ctrlRole: whitelist própria.
  if (item.biValidationAccess) return Boolean(canBiValidation);

  // Validação de Contratos: módulo próprio, concedido por usuário. Também não
  // passa por dreRole/ctrlRole.
  if (item.contratosAccess) return canContratos;

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
