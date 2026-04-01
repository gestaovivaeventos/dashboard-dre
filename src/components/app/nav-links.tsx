"use client";

import { ChevronDown } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { GLOBAL_NAV_ITEMS, SEGMENT_SUB_ITEMS } from "@/components/app/navigation";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { Segment, UserRole } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface NavLinksProps {
  role: UserRole;
  segments: Segment[];
  collapsed?: boolean;
  onNavigate?: () => void;
}

export function NavLinks({ role, segments, collapsed, onNavigate }: NavLinksProps) {
  const pathname = usePathname();

  // Auto-expand the segment whose route is currently active
  const activeSegmentSlug = segments.find((s) =>
    pathname.startsWith(`/s/${s.slug}`),
  )?.slug ?? null;

  const [expanded, setExpanded] = useState<Record<string, boolean>>(
    activeSegmentSlug ? { [activeSegmentSlug]: true } : {},
  );

  const toggleSegment = (slug: string) => {
    setExpanded((prev) => ({ ...prev, [slug]: !prev[slug] }));
  };

  const subItems = SEGMENT_SUB_ITEMS.filter((item) => item.roles.includes(role));
  const globalItems = GLOBAL_NAV_ITEMS.filter((item) => item.roles.includes(role));

  // Collapsed: show first sub-item icon per segment as entry point
  if (collapsed) {
    return (
      <nav className="space-y-1">
        {segments.map((segment) => {
          const isSegmentActive = pathname.startsWith(`/s/${segment.slug}`);
          // Link to the first available sub-item for this segment
          const firstItem = subItems[0];
          if (!firstItem) return null;
          const href = `/s/${segment.slug}${firstItem.suffix}`;

          return (
            <Tooltip key={segment.id}>
              <TooltipTrigger asChild>
                <Link
                  href={href}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-10 w-full items-center justify-center rounded-lg text-sm transition-colors",
                    isSegmentActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <span className="text-xs font-bold uppercase">
                    {segment.name.slice(0, 2)}
                  </span>
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                {segment.name}
              </TooltipContent>
            </Tooltip>
          );
        })}

        {globalItems.length > 0 && <div className="my-3 border-t" />}

        {globalItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <Tooltip key={item.href}>
              <TooltipTrigger asChild>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-10 w-full items-center justify-center rounded-lg transition-colors",
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              </TooltipTrigger>
              <TooltipContent side="right">
                {item.title}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </nav>
    );
  }

  // Expanded (default)
  return (
    <nav className="space-y-1">
      {/* Segment groups */}
      {segments.map((segment) => {
        const isOpen = expanded[segment.slug] ?? false;

        return (
          <div key={segment.id}>
            <button
              type="button"
              onClick={() => toggleSegment(segment.slug)}
              className={cn(
                "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                pathname.startsWith(`/s/${segment.slug}`)
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              )}
            >
              <span className="truncate">{segment.name}</span>
              <ChevronDown
                className={cn(
                  "h-4 w-4 shrink-0 transition-transform",
                  isOpen && "rotate-180",
                )}
              />
            </button>

            {isOpen ? (
              <div className="ml-3 mt-0.5 space-y-0.5 border-l pl-3">
                {subItems.map((item) => {
                  const href = `/s/${segment.slug}${item.suffix}`;
                  const Icon = item.icon;
                  const isActive = pathname === href;

                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={onNavigate}
                      className={cn(
                        "flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm transition-colors",
                        isActive
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{item.title}</span>
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}

      {/* Separator */}
      {globalItems.length > 0 ? (
        <div className="my-3 border-t" />
      ) : null}

      {/* Global items */}
      {globalItems.map((item) => {
        const Icon = item.icon;
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors",
              isActive
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
            <span>{item.title}</span>
          </Link>
        );
      })}
    </nav>
  );
}
