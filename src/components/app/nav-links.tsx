"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
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
  compras: {
    text: "text-violet-600 dark:text-violet-400",
    bg: "bg-violet-600/[0.06] dark:bg-violet-400/[0.08]",
    rail: "bg-violet-600 dark:bg-violet-400",
    dot: "bg-violet-600 dark:bg-violet-400",
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
  segments,
  activeSegmentSlug,
  collapsed,
  onNavigate,
}: NavLinksProps) {
  const pathname = usePathname();

  const groups = buildGroups({ dreRole, ctrlRoles, segments, activeSegmentSlug });

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
  segments: Segment[];
  activeSegmentSlug: string | null;
}

function buildGroups({
  dreRole,
  ctrlRoles,
  segments,
  activeSegmentSlug,
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
      if (!isItemVisible(item, dreRole, ctrlSet)) continue;

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
): boolean {
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
