"use client";

import { useMemo, useState } from "react";
import { Loader2, Save, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { saveOpeningBalances } from "@/lib/settings/opening-balances";

interface CompanyRow {
  id: string;
  name: string;
  active: boolean;
}

// Aceita "12.980,37", "12980,37", "12980.37", negativo. Vazio => null (sem override).
function parseBRL(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const cleaned = t.replace(/[^\d.,-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function formatBRL(n: number): string {
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function SettingsPreOmieBalances({
  companies,
  initial,
}: {
  companies: CompanyRow[];
  initial: Record<string, number>;
}) {
  const { showToast } = useToast();

  const initialText = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of companies) {
      m[c.id] = initial[c.id] !== undefined ? formatBRL(initial[c.id]) : "";
    }
    return m;
  }, [companies, initial]);

  const [values, setValues] = useState<Record<string, string>>(initialText);
  // Último estado efetivamente salvo (para destacar e enviar só o que mudou).
  const [saved, setSaved] = useState<Record<string, string>>(initialText);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const changed = useMemo(
    () => companies.filter((c) => (values[c.id] ?? "") !== (saved[c.id] ?? "")).map((c) => c.id),
    [companies, values, saved],
  );

  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return term ? companies.filter((c) => c.name.toLowerCase().includes(term)) : companies;
  }, [companies, q]);

  async function handleSave() {
    if (changed.length === 0) return;
    setSaving(true);
    const entries = changed.map((id) => ({ companyId: id, amount: parseBRL(values[id] ?? "") }));
    const res = await saveOpeningBalances(entries);
    setSaving(false);
    if ("error" in res) {
      showToast({ title: "Falha ao salvar", description: res.error, variant: "destructive" });
      return;
    }
    // Reformata as células salvas e fixa o novo baseline "salvo".
    const next = { ...values };
    for (const id of changed) {
      const n = parseBRL(next[id] ?? "");
      next[id] = n === null ? "" : formatBRL(n);
    }
    setValues(next);
    setSaved(next);
    showToast({
      title: "Saldos salvos",
      description: `${res.saved} definido(s), ${res.cleared} limpo(s).`,
      variant: "success",
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-64 pl-9"
            placeholder="Buscar empresa…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <Button type="button" onClick={() => void handleSave()} disabled={saving || changed.length === 0}>
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
          {changed.length > 0 ? `Salvar (${changed.length})` : "Salvar"}
        </Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left text-xs font-semibold text-muted-foreground">
                  <th className="px-4 py-3">Empresa</th>
                  <th className="px-4 py-3 text-right">Saldo inicial (jan/2022)</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {visible.map((c) => {
                  const isChanged = (values[c.id] ?? "") !== (saved[c.id] ?? "");
                  return (
                    <tr key={c.id} className={isChanged ? "bg-blue-50/40 dark:bg-blue-950/10" : ""}>
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{c.name}</span>
                        {!c.active && (
                          <span className="ml-2 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            inativa
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="ml-auto flex w-48 items-center gap-1">
                          <span className="text-xs text-muted-foreground">R$</span>
                          <Input
                            value={values[c.id] ?? ""}
                            onChange={(e) => setValues((prev) => ({ ...prev, [c.id]: e.target.value }))}
                            inputMode="decimal"
                            placeholder="0,00"
                            className="text-right"
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {visible.length === 0 && (
                  <tr>
                    <td colSpan={2} className="px-4 py-8 text-center text-muted-foreground">
                      Nenhuma empresa para esse filtro.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground">
        Deixe em branco para a empresa começar em zero. O valor vale como saldo inicial de caixa em
        <strong> janeiro/2022</strong> (corte do Mundo Viva → Omie) e é somado no consolidado quando
        várias empresas são selecionadas no Fluxo de Caixa.
      </p>
    </div>
  );
}
