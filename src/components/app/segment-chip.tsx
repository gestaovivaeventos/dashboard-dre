"use client";

import { Building2, Check, ChevronDown, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import type { Segment } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface SegmentChipProps {
  segments: Segment[];
  activeSlug: string | null;
}

const SEARCH_THRESHOLD = 6;

// Deterministic color picker for the avatar tile, based on segment id/slug.
const AVATAR_PALETTE = [
  "bg-blue-600",
  "bg-violet-600",
  "bg-emerald-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-slate-600",
  "bg-cyan-600",
  "bg-fuchsia-600",
];

function avatarColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return AVATAR_PALETTE[Math.abs(hash) % AVATAR_PALETTE.length];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "·";
}

export function SegmentChip({ segments, activeSlug }: SegmentChipProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const activeSegment = useMemo(
    () => segments.find((s) => s.slug === activeSlug) ?? segments[0] ?? null,
    [segments, activeSlug],
  );

  const filtered = useMemo(() => {
    if (segments.length < SEARCH_THRESHOLD || query.trim().length === 0) {
      return segments;
    }
    const q = query.trim().toLowerCase();
    return segments.filter((s) => s.name.toLowerCase().includes(q));
  }, [segments, query]);

  if (segments.length === 0 || !activeSegment) return null;

  const onPick = async (slug: string) => {
    if (slug === activeSegment.slug) {
      setOpen(false);
      return;
    }
    if (pending) return;

    setPending(true);
    try {
      await fetch("/api/context", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ segmentSlug: slug }),
      });

      const match = pathname.match(/^\/s\/([^/]+)(\/.*)?$/);
      if (match) {
        const tail = match[2] ?? "";
        router.push(`/s/${slug}${tail}`);
      } else {
        router.refresh();
      }
      setOpen(false);
      setQuery("");
    } finally {
      setPending(false);
    }
  };

  const disabled = segments.length === 1;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled || pending}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-lg border border-border bg-surface-1 px-2.5 transition-colors",
          !disabled && "hover:bg-surface-2",
          disabled && "cursor-default opacity-90",
        )}
      >
        <Building2 className="h-3.5 w-3.5 text-ink-muted" strokeWidth={1.75} />
        <span className="flex flex-col items-start leading-none">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Segmento
          </span>
          <span className="mt-0.5 text-[12.5px] text-ink-primary">
            {activeSegment.name}
          </span>
        </span>
        {!disabled && (
          <ChevronDown className="h-3 w-3 text-ink-muted" strokeWidth={2} />
        )}
      </button>

      {open && (
        <div
          role="dialog"
          className="absolute left-0 top-full z-40 mt-1 w-[280px] rounded-lg border border-border bg-surface-1 shadow-lg"
        >
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-[11px] font-semibold text-ink-primary">
              Trocar segmento
            </span>
            <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">
              ⌘K
            </kbd>
          </div>

          {segments.length >= SEARCH_THRESHOLD && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-3.5 w-3.5 text-ink-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar segmento…"
                className="h-7 border-0 px-0 text-sm focus-visible:ring-0"
                autoFocus
              />
            </div>
          )}

          <ul role="listbox" className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-muted">
                Nenhum segmento encontrado.
              </li>
            ) : (
              filtered.map((s) => {
                const isActive = s.slug === activeSegment.slug;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onPick(s.slug)}
                      role="option"
                      aria-selected={isActive}
                      className={cn(
                        "flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors",
                        isActive
                          ? "bg-surface-2"
                          : "hover:bg-surface-2",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-semibold text-white",
                          avatarColor(s.slug),
                        )}
                      >
                        {initials(s.name)}
                      </span>
                      <span className="flex-1 truncate text-[12.5px] text-ink-primary">
                        {s.name}
                      </span>
                      {isActive && (
                        <Check className="h-3.5 w-3.5 text-viva-500" />
                      )}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
