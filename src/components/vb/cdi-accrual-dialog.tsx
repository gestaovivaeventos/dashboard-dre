"use client";

// "Calcular rendimento": mostra o que SERÁ lançado antes de gravar. A gravação
// recalcula tudo no servidor — o que está aqui é só para conferência, nunca
// entra como dado.

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, TrendingUp } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import { postCdiAccrual, previewCdiAccrual, type CdiAccrualItem } from "@/lib/vb/actions/cdi";

function formatRate(rate: number): string {
  return `${(rate * 100).toLocaleString("pt-BR", { minimumFractionDigits: 4, maximumFractionDigits: 4 })}%`;
}

/** `cdiUntil`: última data com taxa gravada, para a legenda ao lado do botão. */
export function VbCdiAccrualDialog({ cdiUntil = null }: { cdiUntil?: string | null }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const [items, setItems] = useState<CdiAccrualItem[]>([]);
  const [total, setTotal] = useState(0);
  const [lastRateDate, setLastRateDate] = useState<string | null>(null);

  function openDialog() {
    setOpen(true);
    startLoading(async () => {
      try {
        const result = await previewCdiAccrual();
        if ("error" in result) {
          showToast({ title: "Não foi possível calcular", description: result.error, variant: "destructive" });
          setOpen(false);
          return;
        }
        setItems(result.items);
        setTotal(result.total);
        setLastRateDate(result.lastRateDate);
      } catch (error) {
        showToast({
          title: "Não foi possível calcular",
          description: error instanceof Error ? error.message : "Erro inesperado.",
          variant: "destructive",
        });
        setOpen(false);
      }
    });
  }

  function post() {
    startSaving(async () => {
      try {
        const result = await postCdiAccrual();
        if ("error" in result) {
          showToast({ title: "Não gravado", description: result.error, variant: "destructive" });
          return;
        }
        showToast({
          title: result.created === 0 ? "Nada a lançar" : `${result.created} rendimento(s): ${formatBRL(result.total)}`,
          variant: "success",
        });
        setOpen(false);
        router.refresh();
      } catch (error) {
        showToast({
          title: "Não gravado",
          description: error instanceof Error ? error.message : "Erro inesperado.",
          variant: "destructive",
        });
      }
    });
  }

  return (
    <>
      <span className="inline-flex items-center gap-2">
        <Button type="button" variant="outline" onClick={openDialog}>
          <TrendingUp className="mr-2 h-4 w-4" /> Calcular rendimento
        </Button>
        {cdiUntil && <span className="text-[11px] text-ink-muted">CDI até {formatDayBR(cdiUntil)}</span>}
      </span>
      <Dialog open={open} onOpenChange={(v) => !saving && setOpen(v)}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Rendimento por CDI</DialogTitle>
            <DialogDescription>
              {lastRateDate
                ? `Calculado com o CDI do Banco Central até ${formatDayBR(lastRateDate)}. Confira antes de lançar.`
                : "Calculado com o CDI do Banco Central."}
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              <Loader2 className="mr-2 inline h-4 w-4 animate-spin" /> Calculando…
            </p>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-ink-muted">
              Nenhum rendimento a lançar{lastRateDate ? ` até ${formatDayBR(lastRateDate)}` : ""}.
            </p>
          ) : (
            <div className="max-h-[50vh] overflow-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
                    <th className="py-1.5 pr-3 font-medium">Credor</th>
                    <th className="py-1.5 pr-3 font-medium">Período</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Dias</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Saldo base</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Taxa</th>
                    <th className="py-1.5 text-right font-medium">Rendimento</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={`${item.creditor_id}-${item.period_start}-${item.period_end}`} className="border-b border-border/60">
                      <td className="py-1.5 pr-3 font-medium text-ink-primary">{item.creditor_name}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-ink-secondary">
                        {formatDayBR(item.period_start)} a {formatDayBR(item.period_end)}
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{item.days}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{formatBRL(item.balance)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-ink-muted">{formatRate(item.rate)}</td>
                      <td className="py-1.5 text-right font-medium tabular-nums text-sky-700">{formatBRL(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <DialogFooter className="items-center">
            {items.length > 0 && (
              <span className="mr-auto text-[13px] tabular-nums text-ink-primary">
                Total: <span className="font-medium text-sky-700">{formatBRL(total)}</span>
              </span>
            )}
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>
              Cancelar
            </Button>
            <Button type="button" onClick={post} disabled={saving || loading || items.length === 0}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lançar rendimento
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
