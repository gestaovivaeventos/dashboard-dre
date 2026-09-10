"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";

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
import { numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { updatePendingEntry } from "@/lib/vb/actions/import";
import { VB_KIND_LABELS, type VbEntry, type VbEntryKind } from "@/lib/vb/types";

interface Props {
  entry: VbEntry | null;
  onClose: () => void;
}

const SELECT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";

/** Edita um lançamento PENDENTE da revisão. Valor sempre positivo no formulário; o sinal vem do tipo. */
export function VbEntryEditDialog({ entry, onClose }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState("");
  const [kind, setKind] = useState<VbEntryKind>("entrada");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ratePct, setRatePct] = useState("");

  useEffect(() => {
    if (!entry) return;
    setDate(entry.entry_date);
    setKind(entry.kind);
    setAmount(numberToInput(entry.kind === "rendimento" ? entry.amount : Math.abs(entry.amount)));
    setDescription(entry.description ?? "");
    setPeriodStart(entry.period_start ?? "");
    setPeriodEnd(entry.period_end ?? entry.entry_date);
    setRatePct(entry.rate == null ? "" : numberToInput(entry.rate * 100));
  }, [entry]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!entry) return;
    const raw = parseBrNumber(amount);
    if (raw == null || Number.isNaN(raw)) {
      showToast({ title: "Valor inválido", variant: "destructive" });
      return;
    }
    const signed = kind === "entrada" ? Math.abs(raw) : kind === "saida" ? -Math.abs(raw) : raw;
    const rate = ratePct.trim() ? parseBrNumber(ratePct) : null;
    if (rate != null && Number.isNaN(rate)) {
      showToast({ title: "Taxa inválida", variant: "destructive" });
      return;
    }
    startTransition(async () => {
      const result = await updatePendingEntry(entry.id, {
        entry_date: date,
        kind,
        amount: signed,
        description: description.trim() || null,
        period_start: kind === "rendimento" && periodStart ? periodStart : null,
        period_end: kind === "rendimento" && periodEnd ? periodEnd : null,
        rate: kind === "rendimento" && rate != null ? rate / 100 : null,
      });
      if ("error" in result) {
        showToast({ title: "Não salvo", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: "Lançamento atualizado", variant: "success" });
      router.refresh();
      onClose();
    });
  }

  return (
    <Dialog open={entry !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Editar lançamento</DialogTitle>
            <DialogDescription>
              Corrigir aqui remove os alertas bloqueantes deste lançamento.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="vb-edit-date">Data</Label>
              <Input id="vb-edit-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="vb-edit-kind">Tipo</Label>
              <select id="vb-edit-kind" className={SELECT_CLS} value={kind} onChange={(e) => setKind(e.target.value as VbEntryKind)}>
                {(Object.keys(VB_KIND_LABELS) as VbEntryKind[]).map((k) => (
                  <option key={k} value={k}>{VB_KIND_LABELS[k]}</option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="vb-edit-amount">Valor (R$)</Label>
              <Input id="vb-edit-amount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="vb-edit-desc">Descrição</Label>
              <Input id="vb-edit-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} />
            </div>
            {kind === "rendimento" && (
              <>
                <div>
                  <Label htmlFor="vb-edit-ps">Início do período</Label>
                  <Input id="vb-edit-ps" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="vb-edit-pe">Fim do período</Label>
                  <Input id="vb-edit-pe" type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="vb-edit-rate">Taxa (%)</Label>
                  <Input id="vb-edit-rate" inputMode="decimal" value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="3,35" />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
              Cancelar
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Salvar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
