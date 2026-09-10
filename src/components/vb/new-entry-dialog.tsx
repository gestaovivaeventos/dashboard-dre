"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import { todayBR } from "@/lib/ctrl/datetime";
import { parseBrNumber } from "@/lib/orcamento/format";
import { createVbEntry } from "@/lib/vb/actions/entries";
import { VB_KIND_LABELS, type VbEntryKind } from "@/lib/vb/types";

const SELECT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";

export function VbNewEntryDialog({ creditorId, creditorName }: { creditorId: string; creditorName: string }) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(() => todayBR());
  const [kind, setKind] = useState<VbEntryKind>("entrada");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [basis, setBasis] = useState<"periodo" | "ajuste">("periodo");

  function reset() {
    setDate(todayBR());
    setKind("entrada");
    setAmount("");
    setDescription("");
    setPeriodStart("");
    setPeriodEnd("");
    setRatePct("");
    setBasis("periodo");
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const raw = parseBrNumber(amount);
    if (raw == null || Number.isNaN(raw)) {
      showToast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    const rate = ratePct.trim() ? parseBrNumber(ratePct) : null;
    if (rate != null && Number.isNaN(rate)) {
      showToast({ title: "Taxa inválida", variant: "destructive" });
      return;
    }
    const signed = kind === "entrada" ? Math.abs(raw) : kind === "saida" ? -Math.abs(raw) : raw;
    startTransition(async () => {
      const result = await createVbEntry({
        creditor_id: creditorId,
        entry_date: date,
        kind,
        amount: signed,
        description: description.trim() || null,
        period_start: kind === "rendimento" && periodStart ? periodStart : null,
        period_end: kind === "rendimento" ? periodEnd || date : null,
        rate: kind === "rendimento" && rate != null ? rate / 100 : null,
        rate_basis: kind === "rendimento" ? (rate != null ? basis : "ajuste") : null,
      });
      if ("error" in result) {
        showToast({ title: "Não gravado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Lançamento gravado", variant: "success" });
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}>
        <Plus className="mr-2 h-4 w-4" /> Novo lançamento
      </Button>
      <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
        <DialogContent>
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Novo lançamento — {creditorName}</DialogTitle>
              <DialogDescription>
                Entra direto no extrato. Rendimento negativo é aceito (ajuste), mas confira o sinal.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="vb-new-date">Data</Label>
                <Input id="vb-new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
              </div>
              <div>
                <Label htmlFor="vb-new-kind">Tipo</Label>
                <select id="vb-new-kind" className={SELECT_CLS} value={kind} onChange={(e) => setKind(e.target.value as VbEntryKind)}>
                  {(Object.keys(VB_KIND_LABELS) as VbEntryKind[]).map((k) => (
                    <option key={k} value={k}>{VB_KIND_LABELS[k]}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="vb-new-amount">Valor (R$)</Label>
                <Input id="vb-new-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.000,00" required />
              </div>
              <div>
                <Label htmlFor="vb-new-desc">Descrição</Label>
                <Input id="vb-new-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
              </div>
              {kind === "rendimento" && (
                <>
                  <div>
                    <Label htmlFor="vb-new-ps">Início do período</Label>
                    <Input id="vb-new-ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="vb-new-pe">Fim do período</Label>
                    <Input id="vb-new-pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder={date} />
                  </div>
                  <div>
                    <Label htmlFor="vb-new-rate">Taxa no período (%)</Label>
                    <Input id="vb-new-rate" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="3,35" />
                  </div>
                  <div>
                    <Label htmlFor="vb-new-basis">Método</Label>
                    <select
                      id="vb-new-basis"
                      className={SELECT_CLS}
                      value={ratePct.trim() ? basis : "ajuste"}
                      onChange={(e) => setBasis(e.target.value as "periodo" | "ajuste")}
                      disabled={!ratePct.trim()}
                    >
                      <option value="periodo">Saldo × taxa do período</option>
                      <option value="ajuste">Ajuste manual</option>
                    </select>
                  </div>
                </>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Gravar
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
