"use client";

// "Novo lançamento" do VB: uma operação com uma ou mais linhas (credor · tipo
// · valor) que entram juntas no extrato — transferência entre credores,
// pagamento a vários no mesmo dia, juros do mês para todos. Data e descrição
// valem para todas as linhas; período e taxa só para as de rendimento.

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, useTransition } from "react";
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
import { VB_MAX_ENTRY_LINES, type NewEntryLine } from "@/lib/vb/new-entries";
import { VB_KIND_LABELS, type VbCreditor, type VbEntryKind } from "@/lib/vb/types";

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

export type VbCreditorOption = Pick<VbCreditor, "id" | "name" | "active">;

interface Line {
  key: number;
  creditorId: string;
  kind: VbEntryKind;
  amount: string;
}

interface Props {
  /** Todos os credores; os encerrados aparecem marcados, no fim da lista. */
  creditors: VbCreditorOption[];
  /** Credor da tela: já vem na primeira linha. */
  defaultCreditorId?: string;
}

export function VbNewEntryDialog({ creditors, defaultCreditorId }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const options = useMemo(
    () => [...creditors].sort((a, b) => Number(b.active) - Number(a.active)),
    [creditors],
  );
  const firstCreditorId = defaultCreditorId ?? options[0]?.id ?? "";

  const [date, setDate] = useState(() => todayBR());
  const [description, setDescription] = useState("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [ratePct, setRatePct] = useState("");
  const [basis, setBasis] = useState<"periodo" | "ajuste">("periodo");
  const nextKey = useRef(1);
  const [lines, setLines] = useState<Line[]>(() => [{ key: 0, creditorId: firstCreditorId, kind: "entrada", amount: "" }]);

  const hasYield = lines.some((line) => line.kind === "rendimento");

  const totals = useMemo(() => {
    let entradas = 0;
    let saidas = 0;
    let rendimentos = 0;
    for (const line of lines) {
      const raw = parseBrNumber(line.amount);
      if (raw == null || Number.isNaN(raw)) continue;
      if (line.kind === "entrada") entradas += Math.abs(raw);
      else if (line.kind === "saida") saidas += Math.abs(raw);
      else rendimentos += raw;
    }
    return { entradas, saidas, rendimentos, liquido: entradas - saidas + rendimentos };
  }, [lines]);

  function reset() {
    setDate(todayBR());
    setDescription("");
    setPeriodStart("");
    setPeriodEnd("");
    setRatePct("");
    setBasis("periodo");
    setLines([{ key: nextKey.current++, creditorId: firstCreditorId, kind: "entrada", amount: "" }]);
  }

  function updateLine(key: number, patch: Partial<Line>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function removeLine(key: number) {
    setLines((current) => (current.length > 1 ? current.filter((line) => line.key !== key) : current));
  }

  /** Linha nova: mesmo tipo da última e o próximo credor ativo ainda não usado. */
  function addLine() {
    setLines((current) => {
      if (current.length >= VB_MAX_ENTRY_LINES) return current;
      const used = new Set(current.map((line) => line.creditorId));
      const next = options.find((c) => c.active && !used.has(c.id)) ?? options[0];
      const last = current[current.length - 1];
      return [...current, { key: nextKey.current++, creditorId: next?.id ?? "", kind: last?.kind ?? "entrada", amount: "" }];
    });
  }

  /** "Juros do mês para todos": uma linha para cada credor ativo que ainda não está na lista. */
  function addAllActive() {
    setLines((current) => {
      const used = new Set(current.map((line) => line.creditorId));
      const last = current[current.length - 1];
      const missing = options.filter((c) => c.active && !used.has(c.id));
      const room = VB_MAX_ENTRY_LINES - current.length;
      return [
        ...current,
        ...missing.slice(0, Math.max(room, 0)).map((c) => ({
          key: nextKey.current++,
          creditorId: c.id,
          kind: last?.kind ?? ("entrada" as VbEntryKind),
          amount: "",
        })),
      ];
    });
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
    startTransition(async () => {
      const result = await createVbEntries({
        entry_date: date,
        description: description.trim() || null,
        period_start: hasYield && periodStart ? periodStart : null,
        period_end: hasYield ? periodEnd || date : null,
        rate: hasYield && rate != null ? rate / 100 : null,
        rate_basis: hasYield ? (rate != null ? basis : "ajuste") : null,
        lines: parsedLines,
      });
      if ("error" in result) {
        showToast({ title: "Não gravado", description: result.error, variant: "destructive" });
        return;
      }
      showToast({
        title: result.ids.length === 1 ? "Lançamento gravado" : `${result.ids.length} lançamentos gravados`,
        variant: "success",
      });
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
        <DialogContent className="sm:max-w-2xl">
          <form onSubmit={submit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Novo lançamento</DialogTitle>
              <DialogDescription>
                Uma linha por credor. Tudo entra junto no extrato, na mesma data; transferência entre
                credores fecha o líquido em zero.
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
                <div className="flex items-center gap-4 pt-1">
                  <button
                    type="button"
                    onClick={addLine}
                    disabled={pending || lines.length >= VB_MAX_ENTRY_LINES}
                    className="inline-flex items-center gap-1 text-[12px] font-medium text-teal-700 hover:underline disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" /> Adicionar linha
                  </button>
                  <button
                    type="button"
                    onClick={addAllActive}
                    disabled={pending || lines.length >= VB_MAX_ENTRY_LINES}
                    className="text-[12px] text-ink-muted hover:underline disabled:opacity-50"
                  >
                    Todos os credores ativos
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
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {lines.length > 1 ? `Gravar ${lines.length} lançamentos` : "Gravar"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
