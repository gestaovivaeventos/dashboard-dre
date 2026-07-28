"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

// Painel "Mutuos" — exclusivo do segmento Franquias Viva (Configuracoes >
// Empresas). Cada unidade tem UMA situacao de mutuo, preenchida manualmente:
// principal, amortizado e saldo devedor. Persistencia no blur de cada campo,
// mesmo padrao do painel FEE / VVR.
//
// Saldo devedor vazio ou zero = unidade sem mutuo em aberto — nesse caso o
// quadro de mutuos nao aparece no relatorio de Business Intelligence.

type MutuoField =
  | "mutuo_principal"
  | "mutuo_amortizado"
  | "mutuo_saldo_devedor";

interface ServerMutuo {
  mutuo_principal: number | null;
  mutuo_amortizado: number | null;
  mutuo_saldo_devedor: number | null;
}

interface SettingsMutuosPanelProps {
  companyId: string;
}

const FIELDS: Array<{ field: MutuoField; label: string }> = [
  { field: "mutuo_principal", label: "Valor do principal" },
  { field: "mutuo_amortizado", label: "Valor amortizado" },
  { field: "mutuo_saldo_devedor", label: "Saldo devedor" },
];

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

function toText(value: number | null): string {
  return value !== null ? formatNumberPtBr(value) : "";
}

type TextByField = Record<MutuoField, string>;

const EMPTY_TEXT: TextByField = {
  mutuo_principal: "",
  mutuo_amortizado: "",
  mutuo_saldo_devedor: "",
};

export function SettingsMutuosPanel({ companyId }: SettingsMutuosPanelProps) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<MutuoField | null>(null);
  const [text, setText] = useState<TextByField>(EMPTY_TEXT);
  // Snapshot do ultimo valor persistido — evita request quando o usuario
  // foca/desfoca sem alterar nada.
  const [persisted, setPersisted] = useState<TextByField>(EMPTY_TEXT);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const r = await fetch(`/api/companies/${companyId}/mutuos`, {
          cache: "no-store",
        });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const payload = (await r.json()) as { mutuo?: ServerMutuo };
        if (!active) return;
        const next: TextByField = {
          mutuo_principal: toText(payload.mutuo?.mutuo_principal ?? null),
          mutuo_amortizado: toText(payload.mutuo?.mutuo_amortizado ?? null),
          mutuo_saldo_devedor: toText(payload.mutuo?.mutuo_saldo_devedor ?? null),
        };
        setText(next);
        setPersisted(next);
      } catch (err) {
        if (!active) return;
        showToast({
          title: "Falha ao carregar mútuo",
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

  const persist = async (field: MutuoField) => {
    if (text[field] === persisted[field]) return;

    setSaving(field);
    try {
      const r = await fetch(`/api/companies/${companyId}/mutuos`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: parseNumberPtBr(text[field]) }),
      });
      if (!r.ok) {
        const payload = (await r.json().catch(() => null)) as
          | { error?: string }
          | null;
        throw new Error(payload?.error ?? `HTTP ${r.status}`);
      }
      const payload = (await r.json()) as { mutuo?: ServerMutuo };
      const savedText = toText(payload.mutuo?.[field] ?? null);
      setText((prev) => ({ ...prev, [field]: savedText }));
      setPersisted((prev) => ({ ...prev, [field]: savedText }));
    } catch (err) {
      showToast({
        title: "Falha ao salvar",
        description: err instanceof Error ? err.message : "Erro inesperado.",
        variant: "destructive",
      });
    } finally {
      setSaving((current) => (current === field ? null : current));
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {FIELDS.map(({ field, label }) => (
          <div key={field} className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              {label}
              {saving === field ? (
                <Loader2 className="ml-1 inline h-3 w-3 animate-spin" />
              ) : null}
            </label>
            <Input
              inputMode="decimal"
              placeholder="0,00"
              value={text[field]}
              onChange={(e) =>
                setText((prev) => ({ ...prev, [field]: e.target.value }))
              }
              onBlur={() => void persist(field)}
              disabled={loading}
            />
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Valores manuais, apenas para registro — nao afetam DRE, KPIs nem Fluxo de
        Caixa. Saldo devedor vazio ou zero significa <strong>sem mutuo em
        aberto</strong>: o quadro de mutuos deixa de aparecer no relatorio de
        Business Intelligence.
      </p>
    </div>
  );
}
