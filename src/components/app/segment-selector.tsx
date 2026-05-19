"use client";

import { Check, ChevronsUpDown, Search } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Segment } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

interface SegmentSelectorProps {
  segments: Segment[];
  activeSlug: string | null;
}

const SEARCH_THRESHOLD = 6;

export function SegmentSelector({ segments, activeSlug }: SegmentSelectorProps) {
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

  if (segments.length === 0) {
    return (
      <span className="text-xs text-ink-muted">
        Sem segmentos disponiveis — fale com um admin
      </span>
    );
  }

  const activeSegment =
    segments.find((s) => s.slug === activeSlug) ?? segments[0];

  if (segments.length === 1) {
    return <span className="t-label text-ink-secondary">{activeSegment.name}</span>;
  }

  const filtered =
    segments.length >= SEARCH_THRESHOLD && query.trim().length > 0
      ? segments.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase()))
      : segments;

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

  return (
    <div ref={containerRef} className="relative">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="h-9 min-w-[180px] justify-between gap-2"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate text-sm">{activeSegment.name}</span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-60" />
      </Button>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-40 mt-1 w-[260px] rounded-lg border border-border bg-surface-1 shadow-lg"
        >
          {segments.length >= SEARCH_THRESHOLD && (
            <div className="flex items-center gap-2 border-b border-border px-3 py-2">
              <Search className="h-4 w-4 text-ink-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar segmento…"
                className="h-7 border-0 px-0 focus-visible:ring-0"
                autoFocus
              />
            </div>
          )}
          <ul className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-muted">Nenhum segmento encontrado.</li>
            ) : (
              filtered.map((s) => {
                const isActive = s.slug === activeSegment.slug;
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => onPick(s.slug)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors",
                        isActive
                          ? "bg-surface-2 text-ink-primary"
                          : "text-ink-secondary hover:bg-surface-2 hover:text-ink-primary",
                      )}
                      role="option"
                      aria-selected={isActive}
                    >
                      <span className="truncate">{s.name}</span>
                      {isActive && <Check className="h-4 w-4 text-viva-500" />}
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
