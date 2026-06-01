"use client";

import { Building2, Check, ChevronDown } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import type { Segment } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

export interface CompanyOption {
  id: string;
  name: string;
}

interface SegmentCompanyPickerProps {
  segments: Segment[];
  activeSegmentSlug: string | null;
  companies: CompanyOption[];
  selected: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}

export function SegmentCompanyPicker({
  segments,
  activeSegmentSlug,
  companies,
  selected,
  onChange,
  disabled,
}: SegmentCompanyPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pendingSegment, setPendingSegment] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
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
    () => segments.find((s) => s.slug === activeSegmentSlug) ?? segments[0] ?? null,
    [segments, activeSegmentSlug],
  );

  const allSelected = selected.length === companies.length && companies.length > 0;

  const triggerLabel = useMemo(() => {
    // Acesso a uma unica empresa: fixa o nome dela no filtro. O picker ja vem
    // desabilitado nesse caso (disabled={companies.length <= 1} nas views),
    // entao mostrar o nome — em vez de "Sem segmento · todas" — deixa claro
    // para o usuario de qual empresa sao os dados exibidos.
    if (companies.length === 1) return companies[0].name;

    const segName = activeSegment?.name ?? "Sem segmento";
    if (companies.length === 0) return `${segName} · sem empresas`;
    if (selected.length === 0) return `${segName} · nenhuma empresa`;
    if (allSelected) return `${segName} · todas`;
    if (selected.length === 1) {
      const c = companies.find((x) => x.id === selected[0]);
      return `${segName} · ${c?.name ?? "1 empresa"}`;
    }
    return `${segName} · ${selected.length} empresas`;
  }, [activeSegment, companies, selected, allSelected]);

  const onPickSegment = async (slug: string) => {
    if (!activeSegment || slug === activeSegment.slug) return;
    if (pendingSegment) return;
    setPendingSegment(true);
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
        router.push(`/s/${slug}/dashboard`);
      }
      setOpen(false);
    } finally {
      setPendingSegment(false);
    }
  };

  const toggleCompany = (id: string, checked: boolean) => {
    if (checked) onChange([...selected, id]);
    else onChange(selected.filter((x) => x !== id));
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-10 w-full min-w-[260px] items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-accent disabled:opacity-50"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
          <span className="truncate">{triggerLabel}</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-[300px] rounded-md border border-border bg-background shadow-lg">
          {/* Segmento */}
          <div className="border-b border-border px-3 py-2">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Segmento
            </span>
            {segments.length <= 1 ? (
              <p className="mt-1 text-sm text-foreground">
                {activeSegment?.name ?? "—"}
              </p>
            ) : (
              <ul className="mt-1 space-y-0.5">
                {segments.map((s) => {
                  const isActive = s.slug === activeSegment?.slug;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => onPickSegment(s.slug)}
                        disabled={pendingSegment}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors",
                          isActive
                            ? "bg-accent font-medium text-foreground"
                            : "text-muted-foreground hover:bg-accent hover:text-foreground",
                        )}
                      >
                        <span className="truncate">{s.name}</span>
                        {isActive && <Check className="h-3.5 w-3.5 text-viva-500" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Empresas */}
          <div className="px-3 py-2">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Empresas
            </span>
          </div>

          {companies.length === 0 ? (
            <p className="px-3 pb-3 text-sm text-muted-foreground">
              Sem empresas no segmento atual.
            </p>
          ) : (
            <div className="max-h-60 overflow-y-auto pb-1">
              <label className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm font-medium hover:bg-accent">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) =>
                    onChange(e.target.checked ? companies.map((c) => c.id) : [])
                  }
                />
                Todas (Consolidado)
              </label>
              {companies.map((company) => {
                const isSelected = selected.includes(company.id);
                return (
                  <label
                    key={company.id}
                    className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent"
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleCompany(company.id, e.target.checked)}
                    />
                    <span className="flex-1 truncate">{company.name}</span>
                    {isSelected && <Check className="h-3.5 w-3.5 text-primary" />}
                  </label>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
