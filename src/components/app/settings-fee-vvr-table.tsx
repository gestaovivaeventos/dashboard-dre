"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

const MONTH_NAMES_PT = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
];

interface ServerRow {
  id: string;
  year: number;
  month: number;
  vvr_meta: number | null;
  vvr: number | null;
}

interface ServerBalance {
  fee_disponivel: number | null;
  fee_a_receber: number | null;
}

interface ClientRow {
  // Linha "default" (jan a dez/2026 ou adicionada via +) que ainda nao foi
  // persistida no banco tem id=null. Apos primeiro upsert vira string.
  id: string | null;
  year: number;
  month: number;
  vvrMetaText: string;
  vvrText: string;
  // Snapshot do ultimo valor persistido, para evitar requests redundantes
  // quando o usuario foca/desfoca sem mudar nada.
  vvrMetaPersistedText: string;
  vvrPersistedText: string;
}

interface SettingsFeeVvrTableProps {
  companyId: string;
}

function rowKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function formatNumberPtBr(n: number): string {
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseNumberPtBr(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // Aceita "1.234,56" (pt-BR) e "1234.56" (programador).
  const normalized = trimmed.includes(",")
    ? trimmed.replace(/\./g, "").replace(",", ".")
    : trimmed;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

function nextMonth(year: number, month: number): { year: number; month: number } {
  if (month === 12) return { year: year + 1, month: 1 };
  return { year, month: month + 1 };
}

function buildDefaultRows(): ClientRow[] {
  return Array.from({ length: 12 }, (_, i) => ({
    id: null,
    year: 2026,
    month: i + 1,
    vvrMetaText: "",
    vvrText: "",
    vvrMetaPersistedText: "",
    vvrPersistedText: "",
  }));
}

function mergeServerWithDefaults(server: ServerRow[]): ClientRow[] {
  const defaults = buildDefaultRows();
  const byKey = new Map<string, ClientRow>();
  defaults.forEach((row) => byKey.set(rowKey(row.year, row.month), row));

  server.forEach((s) => {
    const key = rowKey(s.year, s.month);
    const vvrMetaText = s.vvr_meta !== null ? formatNumberPtBr(s.vvr_meta) : "";
    const vvrText = s.vvr !== null ? formatNumberPtBr(s.vvr) : "";
    byKey.set(key, {
      id: s.id,
      year: s.year,
      month: s.month,
      vvrMetaText,
      vvrText,
      vvrMetaPersistedText: vvrMetaText,
      vvrPersistedText: vvrText,
    });
  });

  return Array.from(byKey.values()).sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
}

export function SettingsFeeVvrTable({ companyId }: SettingsFeeVvrTableProps) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ClientRow[]>(() => buildDefaultRows());
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Campos de balanco da empresa (FEE Disponivel / FEE A Receber) — nao sao
  // por mes; um unico valor por empresa.
  const [feeDisponivelText, setFeeDisponivelText] = useState("");
  const [feeAReceberText, setFeeAReceberText] = useState("");
  const [feeDisponivelPersisted, setFeeDisponivelPersisted] = useState("");
  const [feeAReceberPersisted, setFeeAReceberPersisted] = useState("");
  const [savingBalance, setSavingBalance] = useState<
    "fee_disponivel" | "fee_a_receber" | null
  >(null);

  // Carrega valores persistidos e mescla com os defaults.
  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/companies/${companyId}/fee-vvr`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const payload = (await r.json()) as {
          rows?: ServerRow[];
          balance?: ServerBalance;
        };
        if (!active) return;
        setRows(mergeServerWithDefaults(payload.rows ?? []));
        const balance = payload.balance ?? { fee_disponivel: null, fee_a_receber: null };
        const fdText = balance.fee_disponivel !== null ? formatNumberPtBr(balance.fee_disponivel) : "";
        const farText = balance.fee_a_receber !== null ? formatNumberPtBr(balance.fee_a_receber) : "";
        setFeeDisponivelText(fdText);
        setFeeDisponivelPersisted(fdText);
        setFeeAReceberText(farText);
        setFeeAReceberPersisted(farText);
      } catch (err) {
        if (!active) return;
        showToast({
          title: "Falha ao carregar dados",
          description: err instanceof Error ? err.message : "Erro inesperado.",
          variant: "destructive",
        });
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [companyId, showToast]);

  const handleAddNextRow = () => {
    setRows((prev) => {
      if (prev.length === 0) {
        return [
          {
            id: null,
            year: 2026,
            month: 1,
            vvrMetaText: "",
            vvrText: "",
            vvrMetaPersistedText: "",
            vvrPersistedText: "",
          },
        ];
      }
      const last = prev[prev.length - 1];
      const { year, month } = nextMonth(last.year, last.month);
      return [
        ...prev,
        {
          id: null,
          year,
          month,
          vvrMetaText: "",
          vvrText: "",
          vvrMetaPersistedText: "",
          vvrPersistedText: "",
        },
      ];
    });
  };

  const updateCell = (
    year: number,
    month: number,
    field: "vvrMetaText" | "vvrText",
    value: string,
  ) => {
    setRows((prev) =>
      prev.map((row) =>
        row.year === year && row.month === month
          ? { ...row, [field]: value }
          : row,
      ),
    );
  };

  // Persiste a linha quando o usuario desfoca uma celula (se houver mudanca).
  const persistRow = async (year: number, month: number) => {
    const row = rows.find((r) => r.year === year && r.month === month);
    if (!row) return;

    const vvrMetaChanged = row.vvrMetaText !== row.vvrMetaPersistedText;
    const vvrChanged = row.vvrText !== row.vvrPersistedText;
    if (!vvrMetaChanged && !vvrChanged) return;

    const vvrMeta = parseNumberPtBr(row.vvrMetaText);
    const vvr = parseNumberPtBr(row.vvrText);

    const key = rowKey(year, month);
    setSavingKey(key);
    try {
      const r = await fetch(`/api/companies/${companyId}/fee-vvr`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, month, vvr_meta: vvrMeta, vvr }),
      });
      if (!r.ok) {
        const payload = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? `HTTP ${r.status}`);
      }
      const payload = (await r.json()) as { row?: ServerRow };
      const saved = payload.row;
      setRows((prev) =>
        prev.map((existing) =>
          existing.year === year && existing.month === month
            ? {
                ...existing,
                id: saved?.id ?? existing.id,
                vvrMetaText:
                  saved?.vvr_meta !== null && saved?.vvr_meta !== undefined
                    ? formatNumberPtBr(saved.vvr_meta)
                    : "",
                vvrText:
                  saved?.vvr !== null && saved?.vvr !== undefined
                    ? formatNumberPtBr(saved.vvr)
                    : "",
                vvrMetaPersistedText:
                  saved?.vvr_meta !== null && saved?.vvr_meta !== undefined
                    ? formatNumberPtBr(saved.vvr_meta)
                    : "",
                vvrPersistedText:
                  saved?.vvr !== null && saved?.vvr !== undefined
                    ? formatNumberPtBr(saved.vvr)
                    : "",
              }
            : existing,
        ),
      );
    } catch (err) {
      showToast({
        title: "Falha ao salvar",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setSavingKey((current) => (current === key ? null : current));
    }
  };

  // Persiste um campo de balanco (FEE Disponivel ou FEE A Receber) no blur.
  const persistBalance = async (field: "fee_disponivel" | "fee_a_receber") => {
    const currentText =
      field === "fee_disponivel" ? feeDisponivelText : feeAReceberText;
    const persistedText =
      field === "fee_disponivel" ? feeDisponivelPersisted : feeAReceberPersisted;
    if (currentText === persistedText) return;

    const value = parseNumberPtBr(currentText);
    setSavingBalance(field);
    try {
      const r = await fetch(`/api/companies/${companyId}/fee-vvr`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!r.ok) {
        const payload = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? `HTTP ${r.status}`);
      }
      const payload = (await r.json()) as { balance?: ServerBalance };
      const saved = payload.balance;
      if (saved) {
        const fdText =
          saved.fee_disponivel !== null
            ? formatNumberPtBr(saved.fee_disponivel)
            : "";
        const farText =
          saved.fee_a_receber !== null
            ? formatNumberPtBr(saved.fee_a_receber)
            : "";
        if (field === "fee_disponivel") {
          setFeeDisponivelText(fdText);
          setFeeDisponivelPersisted(fdText);
        } else {
          setFeeAReceberText(farText);
          setFeeAReceberPersisted(farText);
        }
      }
    } catch (err) {
      showToast({
        title: "Falha ao salvar",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setSavingBalance((current) => (current === field ? null : current));
    }
  };

  const totalsLabel = useMemo(() => {
    const total = rows.reduce(
      (acc, row) => {
        const vvrMeta = parseNumberPtBr(row.vvrMetaText) ?? 0;
        const vvr = parseNumberPtBr(row.vvrText) ?? 0;
        return { vvrMeta: acc.vvrMeta + vvrMeta, vvr: acc.vvr + vvr };
      },
      { vvrMeta: 0, vvr: 0 },
    );
    return {
      vvrMeta: formatNumberPtBr(total.vvrMeta),
      vvr: formatNumberPtBr(total.vvr),
    };
  }, [rows]);

  return (
    <div className="space-y-4">
      {/* Campos de balanco por empresa (nao sao mensais) */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            FEE Disponível
            {savingBalance === "fee_disponivel" ? (
              <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />
            ) : null}
          </label>
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={feeDisponivelText}
            onChange={(e) => setFeeDisponivelText(e.target.value)}
            onBlur={() => void persistBalance("fee_disponivel")}
            disabled={loading}
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground">
            FEE A Receber
            {savingBalance === "fee_a_receber" ? (
              <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />
            ) : null}
          </label>
          <Input
            inputMode="decimal"
            placeholder="0,00"
            value={feeAReceberText}
            onChange={(e) => setFeeAReceberText(e.target.value)}
            onBlur={() => void persistBalance("fee_a_receber")}
            disabled={loading}
          />
        </div>
      </div>

      {/* Tabela mensal VVR META x VVR */}
      <div className="rounded-md border bg-background">
        <div className="grid grid-cols-[120px_1fr_1fr] border-b bg-muted px-3 py-2 text-xs font-semibold uppercase text-muted-foreground">
          <span>Mes/Ano</span>
          <span className="text-right">VVR META</span>
          <span className="text-right">VVR</span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Carregando...
          </div>
        ) : rows.length === 0 ? (
          <div className="px-3 py-6 text-sm text-muted-foreground">
            Nenhuma linha. Clique em + para adicionar.
          </div>
        ) : (
          rows.map((row) => {
            const key = rowKey(row.year, row.month);
            const isSaving = savingKey === key;
            return (
              <div
                key={key}
                className="grid grid-cols-[120px_1fr_1fr] items-center border-b px-3 py-1.5 text-sm last:border-b-0"
              >
                <span className="font-mono text-xs">
                  {MONTH_NAMES_PT[row.month - 1]}/{String(row.year).slice(-2)}
                  {isSaving ? (
                    <Loader2 className="ml-1 inline h-3 w-3 animate-spin text-muted-foreground" />
                  ) : null}
                </span>
                <Input
                  className="h-8 text-right"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={row.vvrMetaText}
                  onChange={(e) =>
                    updateCell(row.year, row.month, "vvrMetaText", e.target.value)
                  }
                  onBlur={() => void persistRow(row.year, row.month)}
                />
                <Input
                  className="h-8 text-right"
                  inputMode="decimal"
                  placeholder="0,00"
                  value={row.vvrText}
                  onChange={(e) =>
                    updateCell(row.year, row.month, "vvrText", e.target.value)
                  }
                  onBlur={() => void persistRow(row.year, row.month)}
                />
              </div>
            );
          })
        )}

        {!loading && rows.length > 0 ? (
          <div className="grid grid-cols-[120px_1fr_1fr] items-center border-t bg-muted/50 px-3 py-2 text-xs font-semibold">
            <span>Total</span>
            <span className="pr-3 text-right">{totalsLabel.vvrMeta}</span>
            <span className="pr-3 text-right">{totalsLabel.vvr}</span>
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground">
          Valores apenas para registro. Nao afetam DRE, KPIs nem Fluxo de Caixa.
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={handleAddNextRow}
          disabled={loading}
        >
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Adicionar mes
        </Button>
      </div>
    </div>
  );
}
