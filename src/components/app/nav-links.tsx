"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  CTRL_ADMIN_ITEMS,
  CTRL_DAILY_ITEMS,
  DRE_GLOBAL_ADMIN_ITEMS,
  DRE_SEGMENT_ADMIN_ITEMS,
  DRE_SEGMENT_DAILY_ITEMS,
} from "@/components/app/navigation";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ActiveModule } from "@/lib/context/active-context";
import type { CtrlRole, DreRole, Segment } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  activeModule: ActiveModule;
  role: DreRole;
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
  icon: React.ComponentType<{ className?: string }>;
}

export function NavLinks({
  activeModule,
  role,
  ctrlRoles,
  segments,
  activeSegmentSlug,
  collapsed,
  onNavigate,
}: NavLinksProps) {
  const pathname = usePathname();

  const { daily, admin } = buildItems({
    activeModule,
    role,
    ctrlRoles,
    segments,
    activeSegmentSlug,
  });

  // Compute the single best-matching href (longest prefix that the path is at or under)
  const allItems = [...daily, ...admin];
  const activeHref =
    allItems
      .map((i) => i.href)
      .filter((h) => pathname === h || pathname.startsWith(`${h}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null;

  const renderItem = (item: RenderItem) => {
    const Icon = item.icon;
    const isActive = item.href === activeHref;

    const baseLink = (
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={isActive ? "page" : undefined}
        className={cn(
          collapsed
            ? "flex h-10 w-full items-center justify-center rounded-lg transition-colors"
            : "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-viva-500 text-white"
            : "text-ink-secondary hover:bg-surface-2 hover:text-ink-primary",
        )}
      >
        <Icon className="h-4 w-4" />
        {!collapsed && <span>{item.title}</span>}
      </Link>
    );

    if (!collapsed) return <div key={item.key}>{baseLink}</div>;

    return (
      <Tooltip key={item.key}>
        <TooltipTrigger asChild>{baseLink}</TooltipTrigger>
        <TooltipContent side="right">{item.title}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <nav className="space-y-1">
      {daily.map(renderItem)}

      {admin.length > 0 && (
        <>
          <div className="my-3 border-t border-border" />
          {!collapsed && (
            <div className="t-label mb-1 px-3 py-1 text-ink-muted/80">ADMINISTRAÇÃO</div>
          )}
          {admin.map(renderItem)}
        </>
      )}
    </nav>
  );
}

interface BuildItemsInput {
  activeModule: ActiveModule;
  role: DreRole;
  ctrlRoles?: CtrlRole[];
  segments: Segment[];
  activeSegmentSlug: string | null;
}

function buildItems({
  activeModule,
  role,
  ctrlRoles,
  segments,
  activeSegmentSlug,
}: BuildItemsInput): { daily: RenderItem[]; admin: RenderItem[] } {
  if (activeModule === "dre") {
    const slug =
      activeSegmentSlug && segments.some((s) => s.slug === activeSegmentSlug)
        ? activeSegmentSlug
        : segments[0]?.slug ?? null;

    const daily: RenderItem[] = slug
      ? DRE_SEGMENT_DAILY_ITEMS.filter((i) => i.roles.includes(role)).map((i) => ({
          key: `dre-seg-daily-${i.suffix}`,
          title: i.title,
          href: `/s/${slug}${i.suffix}`,
          icon: i.icon,
        }))
      : [];

    const segmentAdmin: RenderItem[] = slug
      ? DRE_SEGMENT_ADMIN_ITEMS.filter((i) => i.roles.includes(role)).map((i) => ({
          key: `dre-seg-admin-${i.suffix}`,
          title: i.title,
          href: `/s/${slug}${i.suffix}`,
          icon: i.icon,
        }))
      : [];

    const globalAdmin: RenderItem[] = DRE_GLOBAL_ADMIN_ITEMS.filter((i) => i.roles.includes(role)).map(
      (i) => ({
        key: `dre-global-${i.href}`,
        title: i.title,
        href: i.href,
        icon: i.icon,
      }),
    );

    return { daily, admin: [...segmentAdmin, ...globalAdmin] };
  }

  // Controladoria
  const ctrlSet = new Set(ctrlRoles ?? []);
  const matches = <T extends { roles: readonly CtrlRole[] }>(item: T) =>
    item.roles.some((r) => ctrlSet.has(r));

  const daily: RenderItem[] = CTRL_DAILY_ITEMS.filter(matches).map((i) => ({
    key: `ctrl-daily-${i.href}`,
    title: i.title,
    href: i.href,
    icon: i.icon,
  }));

  const admin: RenderItem[] = CTRL_ADMIN_ITEMS.filter(matches).map((i) => ({
    key: `ctrl-admin-${i.href}`,
    title: i.title,
    href: i.href,
    icon: i.icon,
  }));

  return { daily, admin };
}
