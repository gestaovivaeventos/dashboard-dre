"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
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

// Tema Viva: o item ativo usa o laranja da marca de forma unificada em todos os
// modulos (fundo translucido --accent-soft + barra lateral laranja). Os rotulos
// de grupo ficam neutros — a cor de destaque sinaliza "onde estou", nao "qual
// modulo". (Antes havia cor por modulo: azul/violeta/cinza.)
const ACTIVE_COLOR = {
  text: "text-viva-500",
  bg: "bg-[var(--accent-soft)]",
  rail: "bg-viva-500",
};

export function NavLinks({
  dreRole,
  ctrlRoles,
  segments,
  activeSegmentSlug,
  collapsed,
  onNavigate,
  contractsOnly,
  isFranqueado,
}: NavLinksProps) {
  const pathname = usePathname();

  // contracts_only users see ONLY the Validacao de Contratos entry. We bypass
  // buildGroups (which filters by dreRoles) so the item still appears even
  // when the user's underlying role would normally hide it.
  const groups: RenderGroup[] = contractsOnly
    ? buildContractsOnlyGroups()
    : buildGroups({ dreRole, ctrlRoles, segments, activeSegmentSlug, isFranqueado });

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

  const renderItem = (item: RenderItem) => {
    const Icon = item.icon;
    const isActive = item.href === activeHref;
    const color = ACTIVE_COLOR;

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
        return (
          <div key={group.id} className={idx === 0 ? undefined : "mt-2"}>
            {!collapsed && (
              <div className="flex items-center gap-1.5 px-3 pt-3 pb-1.5">
                <span
                  aria-hidden
                  className="h-[5px] w-[5px] rounded-full bg-ink-disabled"
                />
                <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                  {group.label}
                </span>
              </div>
            )}
            {collapsed && idx > 0 && (
              <div className="my-2 border-t border-border" />
            )}
            <div className={collapsed ? "space-y-1" : "space-y-px"}>
              {group.items.map((item) => renderItem(item))}
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
  segments: Segment[];
  activeSegmentSlug: string | null;
  isFranqueado?: boolean;
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
  segments,
  activeSegmentSlug,
  isFranqueado,
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
      if (!isItemVisible(item, dreRole, ctrlSet, isFranqueado)) continue;

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
  isFranqueado?: boolean,
): boolean {
  // Franqueado: a visibilidade não segue o dreRole (cai em 'gestor_unidade',
  // que esconderia o Business Intelligence). Mostra exatamente as telas da
  // whitelist, espelhando FRANQUEADO_BASE_PATHS em access.ts.
  if (isFranqueado) return FRANQUEADO_NAV_KEYS.has(item.key);

  const dreOk =
    item.dreRoles && dreRole !== null
      ? item.dreRoles.includes(dreRole)
      : false;
  const ctrlOk = item.ctrlRoles
    ? item.ctrlRoles.some((r) => ctrlSet.has(r))
    : false;

  if (!item.dreRoles && !item.ctrlRoles) return false;
  return dreOk || ctrlOk;
}

function resolveHref(item: NavItem, activeSlug: string | null): string | null {
  if (item.scope === "global") return item.href ?? null;
  if (!activeSlug || !item.suffix) return null;
  return `/s/${activeSlug}${item.suffix}`;
}

// Re-export for callers that want the type alongside this component.
export type { NavGroup };
