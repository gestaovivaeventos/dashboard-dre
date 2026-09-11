"use client";

// Diálogo de lançamento do VB: uma operação com uma ou mais linhas (credor ·
// tipo · valor) que entram juntas no extrato. Data e descrição valem para
// todas as linhas; período e taxa só para as de rendimento. Dois usos:
// - VbNewEntryDialog: botão "Novo lançamento" (Visão geral e tela do credor);
// - VbEntryDialog controlado com `omie`: a triagem abre já preenchido e grava
//   via linkOmieMovement, comparando o total com o valor do pagamento.

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { Loader2, Plus, X } from "lucide-react";

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
import { formatBRL, parseBrNumber } from "@/lib/orcamento/format";
import { createVbEntries } from "@/lib/vb/actions/entries";
import { linkOmieMovement } from "@/lib/vb/actions/omie";
import {
  addAllActiveLines,
  replicatedFrom,
  sumTypedLines,
  toggleCreditorLines,
  VB_MAX_ENTRY_LINES,
  type EntryLineDraft,
  type NewEntriesInput,
  type NewEntryLine,
} from "@/lib/vb/new-entries";
import { VB_KIND_LABELS, type VbCreditorOption, type VbEntryKind, type VbEntryPrefill } from "@/lib/vb/types";

export type { VbCreditorOption } from "@/lib/vb/types";

const SELECT_CLS =
  "h-8 w-full rounded-md border border-border bg-surface-1 px-2 text-[13px] text-ink-primary outline-none focus:ring-2 focus:ring-teal-500/40";
const INPUT_CLS = "h-8 text-[13px]";
const LINE_GRID = "grid grid-cols-[minmax(0,1fr)_128px_136px_28px] items-center gap-2";
const KINDS = Object.keys(VB_KIND_LABELS) as VbEntryKind[];

/** A cor do valor acompanha o tipo, como no extrato. */
const AMOUNT_TONE: Record<VbEntryKind, string> = {
  entrada: "text-emerald-700",
  saida: "text-red-600",
  rendimento: "text-sky-700",
};

interface Line {
  key: number;
  creditorId: string;
  kind: VbEntryKind;
  amount: string;
}

export interface VbEntryDialogOmie {
  omieId: string;
  /** Valor do pagamento na Omie, para o aviso de total diferente. */
  value: number;
}

export interface VbEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creditors: VbCreditorOption[];
  /** Valores iniciais; sem isso: hoje, descrição vazia, uma linha com o primeiro credor ativo. */
  initial?: VbEntryPrefill;
  /** Modo vínculo com um pagamento da Omie. */
  omie?: VbEntryDialogOmie;
  onSaved?: (result: { ids: string[]; group_id: string }) => void;
}

/** Diálogo controlado. O formulário desmonta ao fechar, então o estado zera sozinho. */
export function VbEntryDialog({ open, onOpenChange, creditors, initial, omie, onSaved }: VbEntryDialogProps) {
  const [pending, setPending] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(v) => !pending && onOpenChange(v)}>
      <DialogContent className="sm:max-w-2xl">
        <EntryForm
          creditors={creditors}
          initial={initial}
          omie={omie}
          onSaved={onSaved}
          onClose={() => onOpenChange(false)}
          onPendingChange={setPending}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Botão "Novo lançamento" (Visão geral e tela do credor). */
export function VbNewEntryDialog({ creditors, defaultCreditorId }: { creditors: VbCreditorOption[]; defaultCreditorId?: string }) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<VbEntryPrefill | undefined>(undefined);
  function openDialog() {
    setInitial(
      defaultCreditorId
        ? { date: todayBR(), description: "", lines: [{ creditorId: defaultCreditorId, kind: "entrada", amount: "" }] }
        : undefined,
    );
    setOpen(true);
  }
  return (
    <>
      <Button type="button" onClick={openDialog}>
        <Plus className="mr-2 h-4 w-4" /> Novo lançamento
      </Button>
      <VbEntryDialog open={open} onOpenChange={setOpen} creditors={creditors} initial={initial} />
    </>
  );
}

function EntryForm({
  creditors,
  initial,
  omie,
  onSaved,
  onClose,
  onPendingChange,
}: {
  creditors: VbCreditorOption[];
  initial?: VbEntryPrefill;
  omie?: VbEntryDialogOmie;
  onSaved?: (result: { ids: string[]; group_id: string }) => void;
  onClose: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    onPendingChange(pending);
    return () => onPendingChange(false);
  }, [pending, onPendingChange]);

  const options = useMemo(
    () => [...creditors].sort((a, b) => Number(b.active) - Number(a.active)),
    [creditors],
  );
  // Sem credor explícito (aberto pela Visão geral) a primeira linha nasce
  // vazia e obriga a escolha: preencher com o primeiro da lista já mandou
  // lançamento para o credor errado sem ninguém perceber.

  const [date, setDate] = useState(() => initial?.date ?? todayBR());
  const [description, setDescription] = useState(() => initial?.description ?? "");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [basis, setBasis] = useState<"periodo" | "ajuste">("periodo");
  const nextKey = useRef(0);
  const [lines, setLines] = useState<Line[]>(() => {
    const seed =
      initial && initial.lines.length > 0
        ? initial.lines
        : [{ creditorId: "", kind: "entrada" as VbEntryKind, amount: "" }];
    return seed.map((line) => ({ key: nextKey.current++, ...line }));
  });

  const hasYield = lines.some((line) => line.kind === "rendimento");
  const totals = useMemo(() => sumTypedLines(lines), [lines]);
  const chosen = useMemo(() => new Set(lines.map((line) => line.creditorId)), [lines]);
  const activeIds = useMemo(() => options.filter((c) => c.active).map((c) => c.id), [options]);
  const omieDiffers = omie ? Math.abs(totals.bruto - omie.value) >= 0.01 : false;

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: number) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  }

  /** Linha nova, com a chave que o React usa para não remontar as outras. */
  function make(draft: EntryLineDraft): Line {
    return { key: nextKey.current++, ...draft };
  }

  /** Linha extra sem credor — para repetir o mesmo credor ou completar à mão. */
  function addLine() {
    setLines((current) =>
      current.length >= VB_MAX_ENTRY_LINES
        ? current
        : [...current, make({ creditorId: "", ...replicatedFrom(current) })],
    );
  }

  /** Clique no nome: entra com o mesmo valor da linha preenchida, ou sai. */
  function toggleCreditor(creditorId: string) {
    setLines((current) => toggleCreditorLines(current, creditorId, make));
  }

  /** Um lançamento igual para cada credor ativo (ex.: PLR, juros do mês). */
  function addAllActive() {
    setLines((current) => addAllActiveLines(current, activeIds, make));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const parsedLines: NewEntryLine[] = [];
    for (let index = 0; index < lines.length; index++) {
      const line = lines[index];
      if (!line.creditorId) {
        showToast({ title: `Linha ${index + 1}: escolha o credor`, variant: "destructive" });
        return;
      }
      const raw = parseBrNumber(line.amount);
      if (raw == null || Number.isNaN(raw)) {
        showToast({ title: `Linha ${index + 1}: valor inválido`, variant: "destructive" });
        return;
      }
      parsedLines.push({ creditor_id: line.creditorId, kind: line.kind, amount: raw });
    }
    const rate = hasYield && ratePct.trim() ? parseBrNumber(ratePct) : null;
    if (rate != null && Number.isNaN(rate)) {
      showToast({ title: "Taxa inválida", variant: "destructive" });
      return;
    }
    const payload: NewEntriesInput = {
      entry_date: date,
      description: description.trim() || null,
      period_start: hasYield && periodStart ? periodStart : null,
      period_end: hasYield ? periodEnd || date : null,
      rate: hasYield && rate != null ? rate / 100 : null,
      rate_basis: hasYield ? (rate != null ? basis : "ajuste") : null,
      lines: parsedLines,
    };
    startTransition(async () => {
      const result = omie
        ? await linkOmieMovement({ ...payload, omie_id: omie.omieId })
        : await createVbEntries(payload);
      if ("error" in result) {
        showToast({ title: "Não gravado", description: result.error, variant: "destructive" });
        return;
      }
      const n = result.ids.length;
      let title: string;
      if (omie) {
        const names = Array.from(new Set(parsedLines.map((line) => line.creditor_id))).map(
          (id) => options.find((o) => o.id === id)?.name ?? "—",
        );
        title = names.length === 1 ? `Vinculado a ${names[0]}` : `Vinculado a ${names.length} credores`;
      } else {
        title = n === 1 ? "Lançamento gravado" : `${n} lançamentos gravados`;
      }
      showToast({ title, variant: "success" });
      // Só createVbEntries devolve accrued/retroativo; linkOmieMovement não.
      if (!omie && "accrued" in result && typeof result.accrued === "number" && result.accrued > 0) {
        showToast({ title: `Rendimento fechado antes: ${result.accrued} lançamento(s)`, variant: "default" });
      }
      if (!omie && "retroativo" in result && result.retroativo === true) {
        showToast({
          title: "Data retroativa",
          description: "O rendimento já lançado não foi recalculado.",
          variant: "default",
        });
      }
      onSaved?.(result);
      onClose();
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <DialogHeader>
        <DialogTitle>{omie ? "Vincular pagamento ao VB" : "Novo lançamento"}</DialogTitle>
        <DialogDescription>
          {omie
            ? "Uma linha por credor. Divida o pagamento entre credores se for o caso; o total pode ficar diferente do valor da Omie."
            : "Uma linha por credor. Tudo entra junto no extrato, na mesma data; transferência entre credores fecha o líquido em zero."}
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-3 sm:grid-cols-[168px_minmax(0,1fr)]">
        <div>
          <Label htmlFor="vb-new-date">Data</Label>
          <Input id="vb-new-date" type="date" className={INPUT_CLS} value={date} onChange={(e) => setDate(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="vb-new-desc">Descrição</Label>
          <Input
            id="vb-new-desc"
            className={INPUT_CLS}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={300}
            placeholder="Vale para todas as linhas"
          />
        </div>
      </div>

      {hasYield && (
        <div className="grid gap-3 rounded-md border border-sky-500/30 bg-sky-500/5 p-3 sm:grid-cols-4">
          <p className="text-[12px] text-sky-700 sm:col-span-4">
            Período e taxa valem para todas as linhas de rendimento. Sem taxa, o valor entra como ajuste.
          </p>
          <div>
            <Label htmlFor="vb-new-ps">Início do período</Label>
            <Input id="vb-new-ps" type="date" className={INPUT_CLS} value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="vb-new-pe">Fim do período</Label>
            <Input id="vb-new-pe" type="date" className={INPUT_CLS} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} placeholder={date} />
          </div>
          <div>
            <Label htmlFor="vb-new-rate">Taxa no período (%)</Label>
            <Input id="vb-new-rate" inputMode="decimal" className={INPUT_CLS} value={ratePct} onChange={(e) => setRatePct(e.target.value)} placeholder="3,35" />
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
        </div>
      )}

      <div className="overflow-x-auto">
        <div className="min-w-[520px] space-y-1.5">
          <div className={`${LINE_GRID} px-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted`}>
            <span>Credor</span>
            <span>Tipo</span>
            <span className="text-right">Valor (R$)</span>
            <span />
          </div>
          {lines.map((line, index) => (
            <div key={line.key} className={LINE_GRID}>
              <select
                aria-label={`Credor da linha ${index + 1}`}
                className={SELECT_CLS}
                value={line.creditorId}
                onChange={(e) => updateLine(line.key, { creditorId: e.target.value })}
                required
              >
                {!line.creditorId && <option value="">Escolha o credor</option>}
                {options.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.active ? c.name : `${c.name} (encerrado)`}
                  </option>
                ))}
              </select>
              <select
                aria-label={`Tipo da linha ${index + 1}`}
                className={SELECT_CLS}
                value={line.kind}
                onChange={(e) => updateLine(line.key, { kind: e.target.value as VbEntryKind })}
              >
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {VB_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <Input
                aria-label={`Valor da linha ${index + 1}`}
                inputMode="decimal"
                className={`${INPUT_CLS} text-right font-medium tabular-nums ${AMOUNT_TONE[line.kind]}`}
                value={line.amount}
                onChange={(e) => updateLine(line.key, { amount: e.target.value })}
                placeholder="1.000,00"
                required
              />
              <button
                type="button"
                aria-label={`Remover linha ${index + 1}`}
                onClick={() => removeLine(line.key)}
                disabled={lines.length === 1 || pending}
                className="inline-flex h-7 w-7 items-center justify-center rounded text-ink-muted hover:bg-surface-2 hover:text-red-600 disabled:opacity-30"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          {/*
            Clicar no nome lança o MESMO valor para outro credor — é o caso
            recorrente (PLR, juros do mês). O valor replicado é o da última
            linha preenchida, então digita-se uma vez só.
          */}
          <div className="flex flex-wrap items-center gap-1.5 pt-2">
            <span className="text-[11px] uppercase tracking-wide text-ink-muted">Lançar também para</span>
            {options
              .filter((c) => c.active)
              .map((c) => {
                const on = chosen.has(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleCreditor(c.id)}
                    disabled={pending || (!on && lines.length >= VB_MAX_ENTRY_LINES)}
                    className={`rounded-full border px-2.5 py-0.5 text-[12px] disabled:opacity-40 ${
                      on
                        ? "border-teal-600 bg-teal-500/10 font-medium text-teal-700"
                        : "border-border text-ink-muted hover:text-ink-primary"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            <button
              type="button"
              onClick={addAllActive}
              disabled={pending || lines.length >= VB_MAX_ENTRY_LINES}
              className="rounded-full border border-dashed border-border px-2.5 py-0.5 text-[12px] text-ink-muted hover:text-ink-primary disabled:opacity-40"
            >
              Todos
            </button>
            <button
              type="button"
              onClick={addLine}
              disabled={pending || lines.length >= VB_MAX_ENTRY_LINES}
              className="ml-auto inline-flex items-center gap-1 text-[12px] font-medium text-teal-700 hover:underline disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> Linha em branco
            </button>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-[12px] tabular-nums">
        <span className="text-emerald-700">Entradas {formatBRL(totals.entradas)}</span>
        <span className="text-red-600">Saídas {formatBRL(totals.saidas)}</span>
        <span className="text-sky-700">Rendimentos {formatBRL(totals.rendimentos)}</span>
        <span className={`ml-auto font-medium ${totals.liquido < 0 ? "text-red-600" : "text-ink-primary"}`}>
          Líquido {formatBRL(totals.liquido)}
        </span>
        {omie && (
          <span className={`basis-full ${omieDiffers ? "text-amber-700" : "text-ink-muted"}`}>
            Omie: {formatBRL(omie.value)}
            {omieDiffers && ` · o total das linhas (${formatBRL(totals.bruto)}) é diferente do pagamento`}
          </span>
        )}
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {omie ? "Vincular" : lines.length > 1 ? `Gravar ${lines.length} lançamentos` : "Gravar"}
        </Button>
      </DialogFooter>
    </form>
  );
}
