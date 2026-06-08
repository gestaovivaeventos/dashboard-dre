"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, RefreshCcw, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import { SegmentSelector } from "@/components/app/segment-selector";
import type { Segment } from "@/lib/supabase/types";

interface CompanyOption {
  id: string;
  name: string;
}

interface ManualEntriesManagerProps {
  companies: CompanyOption[];
  segments?: Segment[];
  currentSegmentSlug?: string;
}

interface EntryRow {
  key: string;
  categoryName: string;
  entryDate: string;
  value: string;
}

async function safeJson<T>(response: Response): Promise<T | null> {
  const raw = await response.text();
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export function ManualEntriesManager({
  companies,
  segments,
  currentSegmentSlug,
}: ManualEntriesManagerProps) {
  const { showToast } = useToast();
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [rows, setRows] = useState<EntryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const keyCounter = useRef(0);

  const nextKey = useCallback(() => {
    keyCounter.current += 1;
    return `row-${keyCounter.current}`;
  }, []);

  const loadRows = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId });
    const response = await fetch(`/api/manual-entries?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await safeJson<{
      entries?: Array<{ id: string; categoryName: string; entryDate: string; value: number }>;
      error?: string;
    }>(response);
    if (!response.ok || !payload?.entries) {
      showToast({
        title: "Falha ao carregar lancamentos",
        description: payload?.error ?? "Nao foi possivel listar os lancamentos manuais.",
        variant: "destructive",
      });
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(
      payload.entries.map((e) => ({
        key: nextKey(),
        categoryName: e.categoryName,
        entryDate: e.entryDate,
        value: String(e.value),
      })),
    );
    setLoading(false);
  }, [companyId, nextKey, showToast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const updateRow = (key: string, field: keyof Omit<EntryRow, "key">, value: string) => {
    setRows((previous) =>
      previous.map((row) => (row.key === key ? { ...row, [field]: value } : row)),
    );
  };

  const addRow = () => {
    setRows((previous) => [
      ...previous,
      { key: nextKey(), categoryName: "", entryDate: "", value: "" },
    ]);
  };

  const removeRow = (key: string) => {
    setRows((previous) => previous.filter((row) => row.key !== key));
  };

  const total = useMemo(
    () =>
      rows.reduce((sum, row) => {
        const v = Number(row.value.replace(",", "."));
        return Number.isFinite(v) ? sum + v : sum;
      }, 0),
    [rows],
  );

  const saveAll = async () => {
    const entries = rows
      .map((row) => ({
        categoryName: row.categoryName.trim(),
        entryDate: row.entryDate.trim(),
        value: Number(row.value.replace(",", ".")),
      }))
      .filter(
        (e) =>
          e.categoryName !== "" &&
          /^\d{4}-\d{2}-\d{2}$/.test(e.entryDate) &&
          Number.isFinite(e.value),
      );

    setSaving(true);
    const response = await fetch("/api/manual-entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, entries }),
    });
    const payload = await safeJson<{ ok?: boolean; saved?: number; error?: string }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar",
        description: payload?.error ?? "Nao foi possivel salvar os lancamentos.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }
    await loadRows();
    setSaving(false);
    showToast({
      title: "Lancamentos salvos",
      description: `${payload.saved ?? 0} linha(s) gravada(s).`,
      variant: "success",
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Lancamentos manuais</h2>
        <p className="text-sm text-muted-foreground">
          Insira valores que nao vem da Omie (Categoria, Data, Valor). As categorias
          digitadas aparecem na tela de Mapeamento para voce vincular a uma conta DRE,
          e os valores entram no DRE seguindo as datas.
        </p>
      </div>

      {segments && segments.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-ink-secondary">Segmento:</span>
          <SegmentSelector segments={segments} activeSlug={currentSegmentSlug ?? null} />
        </div>
      )}

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                disabled={saving}
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void loadRows()}
                disabled={loading || saving}
              >
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Atualizar
              </Button>
            </div>
            <span className="whitespace-nowrap text-xs text-muted-foreground">
              {rows.length} linha(s) · Total {currencyFormatter.format(total)}
            </span>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
                  <th className="px-4 py-3 text-left">Categoria DRE</th>
                  <th className="px-4 py-3 text-left w-44">Data</th>
                  <th className="px-4 py-3 text-left w-44">Valor</th>
                  <th className="px-4 py-3 text-center w-16"></th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Carregando lancamentos...
                    </td>
                  </tr>
                ) : rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                      Nenhum lancamento. Clique em &quot;Adicionar linha&quot; para comecar.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.key} className="border-b transition-colors hover:bg-muted/30">
                      <td className="px-4 py-2">
                        <Input
                          placeholder="Ex.: Salarios"
                          value={row.categoryName}
                          disabled={saving}
                          onChange={(event) =>
                            updateRow(row.key, "categoryName", event.target.value)
                          }
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="date"
                          value={row.entryDate}
                          disabled={saving}
                          onChange={(event) =>
                            updateRow(row.key, "entryDate", event.target.value)
                          }
                        />
                      </td>
                      <td className="px-4 py-2">
                        <Input
                          type="number"
                          step="0.01"
                          placeholder="0,00"
                          value={row.value}
                          disabled={saving}
                          onChange={(event) => updateRow(row.key, "value", event.target.value)}
                        />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => removeRow(row.key)}
                          disabled={saving}
                          aria-label="Remover linha"
                        >
                          <Trash2 className="h-4 w-4 text-muted-foreground" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="border-t p-3">
            <Button type="button" variant="outline" size="sm" onClick={addRow} disabled={saving}>
              <Plus className="mr-1.5 h-4 w-4" />
              Adicionar linha
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10">
        <div className="mx-auto flex items-center justify-between gap-4 rounded-lg border bg-background p-4 shadow-lg">
          <span className="text-sm font-medium">
            Salvar substitui todos os lancamentos manuais desta empresa.
          </span>
          <Button type="button" size="sm" onClick={() => void saveAll()} disabled={saving}>
            {saving ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-1.5 h-4 w-4" />
            )}
            Salvar
          </Button>
        </div>
      </div>
    </div>
  );
}
