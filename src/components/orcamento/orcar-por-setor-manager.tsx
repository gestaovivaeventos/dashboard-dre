"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

import {
  setOrcarPorSetor,
  type CompanyBudgetConfig,
} from "@/lib/orcamento/actions/config";
import { cn } from "@/lib/utils";

interface Props {
  companies: CompanyBudgetConfig[];
}

export function OrcarPorSetorManager({ companies }: Props) {
  const [rows, setRows] = useState(companies);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; msg: string } | null>(null);

  function handleToggle(company: CompanyBudgetConfig) {
    const next = !company.orcarPorSetor;
    setPendingId(company.companyId);
    setFeedback(null);
    // Otimista: reflete o novo estado já; reverte no erro.
    setRows((prev) =>
      prev.map((r) =>
        r.companyId === company.companyId ? { ...r, orcarPorSetor: next } : r,
      ),
    );
    startTransition(async () => {
      const res = await setOrcarPorSetor(company.companyId, next);
      setPendingId(null);
      if (res?.error) {
        setRows((prev) =>
          prev.map((r) =>
            r.companyId === company.companyId
              ? { ...r, orcarPorSetor: company.orcarPorSetor }
              : r,
          ),
        );
        setFeedback({ ok: false, msg: res.error });
        return;
      }
      setFeedback({
        ok: true,
        msg: `${company.companyName}: orçamento ${next ? "por setor" : "só por categoria"}.`,
      });
    });
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
        Nenhuma empresa ativa encontrada.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {feedback && (
        <div
          className={cn(
            "rounded-md px-4 py-2 text-sm",
            feedback.ok
              ? "bg-green-500/10 text-green-700"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {feedback.msg}
        </div>
      )}

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
                  {company.orcarPorSetor
                    ? "Orça por setor"
                    : "Orça só por categoria"}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isPending && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={company.orcarPorSetor}
                  aria-label={`Orçar por setor — ${company.companyName}`}
                  disabled={isPending}
                  onClick={() => handleToggle(company)}
                  className={cn(
                    "relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50",
                    company.orcarPorSetor ? "bg-emerald-600" : "bg-muted-foreground/30",
                  )}
                >
                  <span
                    className={cn(
                      "inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform",
                      company.orcarPorSetor ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
