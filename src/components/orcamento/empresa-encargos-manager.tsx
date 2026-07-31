"use client";

import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import {
  getCompaniesBudgetConfig,
  setUsarEmpresaEncargos,
  type CompanyBudgetConfig,
} from "@/lib/orcamento/actions/config";
import { defaultBudgetYear } from "@/lib/orcamento/years";
import { YearSelect } from "@/components/orcamento/year-select";
import { cn } from "@/lib/utils";

interface Props {
  companies: CompanyBudgetConfig[];
  initialYear: number;
}

export function EmpresaEncargosManager({ companies, initialYear }: Props) {
  const [year, setYear] = useState<number>(initialYear || defaultBudgetYear());
  const [rows, setRows] = useState(companies);
  const [loading, setLoading] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  async function reload(y: number) {
    setLoading(true);
    const res = await getCompaniesBudgetConfig(y);
    setLoading(false);
    if (res?.error) {
      setFeedback({ ok: false, msg: res.error });
      return;
    }
    setRows(res.items ?? []);
  }

  useEffect(() => {
    if (year === initialYear) return;
    setFeedback(null);
    void reload(year);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  function handleToggle(company: CompanyBudgetConfig) {
    const next = !company.usarEmpresaEncargos;
    setPendingId(company.companyId);
    setFeedback(null);
    setRows((prev) =>
      prev.map((r) =>
        r.companyId === company.companyId ? { ...r, usarEmpresaEncargos: next } : r,
      ),
    );
    startTransition(async () => {
      const res = await setUsarEmpresaEncargos(company.companyId, year, next);
      setPendingId(null);
      if (res?.error) {
        setRows((prev) =>
          prev.map((r) =>
            r.companyId === company.companyId
              ? { ...r, usarEmpresaEncargos: company.usarEmpresaEncargos }
              : r,
          ),
        );
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setFeedback({
        ok: true,
        msg: next
          ? `${company.companyName}: coluna Empresa habilitada em ${year}.`
          : `${company.companyName}: coluna Empresa desligada em ${year} — os encargos voltam a seguir o regime da própria empresa.`,
      });
    });
  }

  if (rows.length === 0 && !loading) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma empresa ativa encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <YearSelect value={year} onChange={setYear} disabled={loading} />

      {feedback && (
        <div
          className={cn(
            "rounded-md px-4 py-2 text-sm",
            feedback.ok ? "bg-green-500/10 text-green-700" : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Carregando…
        </div>
      ) : (
        <div className="rounded-lg border divide-y">
          {rows.map((company) => {
            const isPending = pendingId === company.companyId;
            return (
              <div
                key={company.companyId}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{company.companyName}</p>
                  <p className="text-xs text-muted-foreground">
                    {company.usarEmpresaEncargos
                      ? "Coluna Empresa visível — cada colaborador pode ter o regime de outra empresa"
                      : "Encargos de todo o quadro seguem o regime desta empresa"}
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {isPending && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={company.usarEmpresaEncargos}
                    aria-label={`Coluna Empresa — ${company.companyName}`}
                    disabled={isPending}
                    onClick={() => handleToggle(company)}
                    className={cn(
                      "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                      company.usarEmpresaEncargos ? "bg-emerald-600" : "bg-muted-foreground/30",
                    )}
                  >
                    <span
                      className={cn(
                        "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                        company.usarEmpresaEncargos ? "translate-x-5" : "translate-x-0.5",
                      )}
                    />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
