// src/components/vb/omie-triage.tsx
"use client";

// Triagem dos pagamentos da Omie: abas, filtros, ações e o diálogo de vínculo.
// Os dados chegam prontos do server component; toda ação chama uma server
// action e dá router.refresh(). Sugestões são calculadas aqui (lógica pura).

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { VbEntryDialog } from "@/components/vb/new-entry-dialog";
import { OmiePendingTable, type OmieSuggestion } from "@/components/vb/omie-pending-table";
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
import { useToast } from "@/components/ui/toaster";
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";
import { formatBRL } from "@/lib/orcamento/format";
import {
  discardOmieMovement,
  restoreOmieMovement,
  syncOmieNow,
  unlinkOmieMovement,
} from "@/lib/vb/actions/omie";
import { prefillFromMovement, suggestCreditor, suggestKind } from "@/lib/vb/omie/suggest";
import {
  VB_KIND_LABELS,
  type VbActionResult,
  type VbCreditorOption,
  type VbEntryKind,
  type VbEntryPrefill,
  type VbOmieMovement,
  type VbOmieSyncStatus,
  type VbOmieTriageRow,
} from "@/lib/vb/types";

export type OmieTab = "pendentes" | "vinculados" | "descartados";

const TABS: Array<{ id: OmieTab; label: string }> = [
  { id: "pendentes", label: "Pendentes" },
  { id: "vinculados", label: "Vinculados" },
  { id: "descartados", label: "Descartados" },
];

const ALL = "todas";
const NO_CATEGORY = "Sem categoria";

const KIND_TONE: Record<VbEntryKind, string> = {
  entrada: "text-emerald-700",
  saida: "text-red-600",
  rendimento: "text-sky-700",
};

const ACTION_CLS = "rounded px-2 py-0.5 text-[12px] font-medium hover:bg-surface-2 disabled:opacity-50";

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function categoryOf(row: { category_name: string | null; category_code: string | null }): string {
  return row.category_name ?? row.category_code ?? NO_CATEGORY;
}

interface Props {
  tab: OmieTab;
  pending: VbOmieMovement[];
  linked: VbOmieTriageRow[];
  discarded: VbOmieTriageRow[];
  creditors: VbCreditorOption[];
  /** Fornecedor → credor (último vínculo). */
  memory: Readonly<Record<string, string>>;
  sync: VbOmieSyncStatus;
}

export function VbOmieTriage({ tab, pending, linked, discarded, creditors, memory, sync }: Props) {
  const router = useRouter();
  const { showToast } = useToast();
  const [busy, startTransition] = useTransition();
  const [syncing, startSync] = useTransition();
  const [category, setCategory] = useState(ALL);
  const [query, setQuery] = useState("");
  const [linking, setLinking] = useState<{ movement: VbOmieMovement; prefill: VbEntryPrefill } | null>(null);
  const [unlinking, setUnlinking] = useState<VbOmieTriageRow | null>(null);

  const creditorName = useMemo(() => new Map(creditors.map((c) => [c.id, c.name] as const)), [creditors]);

  const suggestions = useMemo(() => {
    const out: Record<string, OmieSuggestion | null> = {};
    for (const row of pending) {
      const id = suggestCreditor(row.supplier_customer, creditors, memory);
      out[row.omie_id] = id ? { creditorName: creditorName.get(id) ?? "—", kind: suggestKind(row.category_code) } : null;
    }
    return out;
  }, [pending, creditors, memory, creditorName]);

  /** Categorias presentes nos pendentes, mais frequentes primeiro. */
  const categories = useMemo(() => {
    const seen = new Map<string, number>();
    for (const row of pending) {
      const key = categoryOf(row);
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    return Array.from(seen.entries()).sort((a, b) => b[1] - a[1]);
  }, [pending]);

  const filtered = useMemo(() => {
    const term = normalize(query.trim());
    return pending.filter((row) => {
      if (category !== ALL && categoryOf(row) !== category) return false;
      if (term && !normalize(`${row.supplier_customer ?? ""} ${row.description ?? ""}`).includes(term)) return false;
      return true;
    });
  }, [pending, category, query]);

  function run(action: () => Promise<VbActionResult<object>>, success: string) {
    startTransition(async () => {
      const result = await action();
      if ("error" in result) {
        showToast({ title: "Não foi possível", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: success, variant: "success" });
      router.refresh();
    });
  }

  function runSync() {
    startSync(async () => {
      const result = await syncOmieNow();
      if ("error" in result) {
        showToast({ title: "Omie não respondeu", description: result.error, variant: "destructive" });
        return;
      }
      showToast({ title: `Omie consultada: ${result.recordsImported} movimento(s) na janela`, variant: "success" });
      router.refresh();
    });
  }

  const counts: Record<OmieTab, number> = {
    pendentes: pending.length,
    vinculados: linked.length,
    descartados: discarded.length,
  };

  const syncLabel = sync.running
    ? "Omie sincronizando…"
    : sync.finishedAt
      ? `Omie atualizada em ${formatDateTimeBR(sync.finishedAt)}`
      : "Omie ainda não sincronizada";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <nav aria-label="Abas da triagem" className="flex gap-1 rounded-md border border-border bg-surface-1 p-0.5">
          {TABS.map((t) => (
            <Link
              key={t.id}
              href={`/vb/omie?aba=${t.id}`}
              aria-current={tab === t.id ? "page" : undefined}
              className={`rounded px-3 py-1 text-[13px] ${
                tab === t.id ? "bg-surface-2 font-medium text-ink-primary" : "text-ink-muted hover:text-ink-primary"
              }`}
            >
              {t.label} <span className="tabular-nums text-ink-muted">{counts[t.id]}</span>
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2 text-[12px] text-ink-muted">
          <span>{syncLabel}</span>
          <Button type="button" variant="outline" onClick={runSync} disabled={syncing || sync.running}>
            {syncing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}
            Buscar na Omie
          </Button>
        </div>
      </div>

      {tab === "pendentes" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              aria-pressed={category === ALL}
              onClick={() => setCategory(ALL)}
              className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                category === ALL ? "border-teal-600 bg-surface-1 text-teal-700" : "border-border text-ink-muted"
              }`}
            >
              Todas
            </button>
            {categories.map(([name, n]) => (
              <button
                key={name}
                type="button"
                aria-pressed={category === name}
                onClick={() => setCategory(category === name ? ALL : name)}
                className={`rounded-full border px-2.5 py-0.5 text-[12px] ${
                  category === name ? "border-teal-600 bg-surface-1 text-teal-700" : "border-border text-ink-muted"
                }`}
              >
                {name} <span className="tabular-nums">{n}</span>
              </button>
            ))}
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar fornecedor ou descrição"
              aria-label="Buscar fornecedor ou descrição"
              className="h-8 w-[240px] text-[13px]"
            />
            <span className="ml-auto text-[12px] text-ink-muted">
              {filtered.length} pagamento{filtered.length === 1 ? "" : "s"}
            </span>
          </div>
          <OmiePendingTable
            rows={filtered}
            suggestions={suggestions}
            busy={busy}
            onLink={(row) => setLinking({ movement: row, prefill: prefillFromMovement(row, creditors, memory) })}
            onDiscard={(row) => run(() => discardOmieMovement(row.omie_id), "Descartado")}
            emptyText={
              pending.length === 0
                ? "Nenhum pagamento aguardando. O sync diário traz os novos; \"Buscar na Omie\" traz agora."
                : "Nenhum pagamento neste recorte."
            }
          />
        </>
      )}

      {tab === "vinculados" && (
        <DecisionTable rows={linked} kind="vinculado" busy={busy} onAction={(row) => setUnlinking(row)} />
      )}
      {tab === "descartados" && (
        <DecisionTable
          rows={discarded}
          kind="descartado"
          busy={busy}
          onAction={(row) => run(() => restoreOmieMovement(row.omie_id), "Restaurado")}
        />
      )}

      <VbEntryDialog
        open={linking !== null}
        onOpenChange={(open) => !open && setLinking(null)}
        creditors={creditors}
        initial={linking?.prefill}
        omie={linking ? { omieId: linking.movement.omie_id, value: linking.movement.value } : undefined}
      />

      <Dialog open={unlinking !== null} onOpenChange={(open) => !open && setUnlinking(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Desvincular do VB?</DialogTitle>
            <DialogDescription>
              Apaga {unlinking?.entries.length ?? 0} lançamento(s) do VB e devolve o pagamento de{" "}
              {formatBRL(unlinking?.value ?? null)} para pendentes.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setUnlinking(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() => {
                const row = unlinking;
                if (!row) return;
                setUnlinking(null);
                run(() => unlinkOmieMovement(row.omie_id), "Desvinculado");
              }}
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Desvincular
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DecisionTable({
  rows,
  kind,
  busy,
  onAction,
}: {
  rows: VbOmieTriageRow[];
  kind: "vinculado" | "descartado";
  busy: boolean;
  onAction: (row: VbOmieTriageRow) => void;
}) {
  if (rows.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-ink-muted">
        {kind === "vinculado" ? "Nenhum pagamento vinculado ainda." : "Nenhum pagamento descartado."}
      </p>
    );
  }
  const th = "py-1.5 pr-3 font-medium";
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-ink-muted">
            <th className={th}>Data</th>
            <th className={th}>Fornecedor</th>
            <th className={th}>Descrição</th>
            {kind === "descartado" && <th className={th}>Categoria</th>}
            <th className={`${th} text-right`}>{kind === "vinculado" ? "Valor Omie" : "Valor"}</th>
            {kind === "vinculado" && <th className={th}>Lançado no VB</th>}
            <th className={th}>Por</th>
            <th className="py-1.5 font-medium">
              <span className="sr-only">Ações</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const warnings: string[] = [];
            if (!row.live) warnings.push("não consta mais na Omie");
            else if (Math.abs(row.live.value - row.value) >= 0.01) warnings.push(`valor na Omie agora é ${formatBRL(row.live.value)}`);
            return (
              <tr key={row.id} className="border-b border-border/60 align-top hover:bg-surface-2/60">
                <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">{formatDayBR(row.payment_date)}</td>
                <td className="max-w-[220px] truncate py-1.5 pr-3 font-medium text-ink-primary" title={row.supplier_customer ?? undefined}>
                  {row.supplier_customer ?? "—"}
                </td>
                <td className="max-w-[300px] py-1.5 pr-3 text-ink-secondary">
                  <div className="truncate" title={row.description ?? undefined}>{row.description ?? "—"}</div>
                  {warnings.length > 0 && <div className="text-[11px] text-amber-700">{warnings.join(" · ")}</div>}
                </td>
                {kind === "descartado" && (
                  <td className="whitespace-nowrap py-1.5 pr-3 text-ink-muted">{categoryOf(row)}</td>
                )}
                <td className="whitespace-nowrap py-1.5 pr-3 text-right font-medium tabular-nums text-red-600">{formatBRL(row.value)}</td>
                {kind === "vinculado" && (
                  <td className="whitespace-nowrap py-1.5 pr-3">
                    {row.entries.length === 0 ? (
                      <span className="text-amber-700">sem lançamentos</span>
                    ) : (
                      row.entries.map((e) => (
                        <div key={e.id} className="tabular-nums">
                          <span className="text-ink-primary">{e.creditor_name}</span>{" "}
                          <span className={KIND_TONE[e.kind]}>
                            {VB_KIND_LABELS[e.kind]} {formatBRL(Math.abs(e.amount))}
                          </span>
                        </div>
                      ))
                    )}
                  </td>
                )}
                <td className="whitespace-nowrap py-1.5 pr-3 text-ink-muted">
                  {row.decided_by_name ?? "—"} · {formatDateTimeBR(row.decided_at)}
                </td>
                <td className="whitespace-nowrap py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => onAction(row)}
                    disabled={busy}
                    className={`${ACTION_CLS} ${kind === "vinculado" ? "text-ink-muted hover:text-red-600" : "text-teal-700"}`}
                  >
                    {kind === "vinculado" ? "Desvincular" : "Restaurar"}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
