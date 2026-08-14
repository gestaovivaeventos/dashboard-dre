"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Search } from "lucide-react";

import { YearSelect } from "@/components/orcamento/year-select";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { workspaceHubHref } from "@/lib/orcamento/workspace-tabs";
import { getOrcamentoStatus } from "@/lib/orcamento/actions/status";
import { statusGeral, type OrcamentoStatusRaw } from "@/lib/orcamento/status";
import { StatusBadge } from "@/components/orcamento/status-badge";

interface Company {
  companyId: string;
  companyName: string;
}

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

/**
 * Painel de entrada do módulo Orçamento: o analista escolhe a EMPRESA (e o ano)
 * e cai no hub daquela empresa. É o "abrir o arquivo da empresa X" — o fluxo é
 * por empresa, uma de cada vez. Cada card mostra um selo ÚNICO de andamento
 * (Não iniciado / Em andamento / Concluído).
 */
export function OrcamentoPainel({ companies }: { companies: Company[] }) {
  const [year, setYear] = useState<number>(defaultBudgetYear());
  const [search, setSearch] = useState("");
  const [statuses, setStatuses] = useState<Record<string, OrcamentoStatusRaw>>({});

  // Recarrega o andamento sempre que o ano muda (status é acessório: erro → vazio).
  useEffect(() => {
    let cancelado = false;
    void getOrcamentoStatus(year).then((res) => {
      if (!cancelado) setStatuses(res.statuses);
    });
    return () => {
      cancelado = true;
    };
  }, [year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.companyName.toLowerCase().includes(q));
  }, [companies, search]);

  if (companies.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma empresa ativa encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <YearSelect value={year} onChange={setYear} />
        <div className="min-w-[220px] flex-1 space-y-1.5">
          <label className="text-sm font-medium">Buscar empresa</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Nome da empresa"
              className={INPUT_CLS + " pl-9"}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c) => {
          const raw = statuses[c.companyId];
          return (
            <Link
              key={c.companyId}
              href={workspaceHubHref(c.companyId, year)}
              className="group flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-emerald-500/40 hover:bg-muted/40"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
                  <Building2 className="h-5 w-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{c.companyName}</div>
                  <div className="text-xs text-muted-foreground">Orçamento {year}</div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              {raw && <StatusBadge selo={statusGeral(raw)} className="self-start" />}
            </Link>
          );
        })}
        {filtered.length === 0 && (
          <div className="col-span-full rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Nenhuma empresa encontrada para “{search}”.
          </div>
        )}
      </div>
    </div>
  );
}
