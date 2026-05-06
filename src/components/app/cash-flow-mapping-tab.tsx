"use client";

import { Loader2, RefreshCcw, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

interface CashFlowAccountOption {
  id: string;
  code: string;
  name: string;
}

interface CashFlowMappingRow {
  code: string;
  description: string;
  mappingId: string | null;
  cashFlowAccountId: string | null;
  cashFlowAccountCode: string | null;
  cashFlowAccountName: string | null;
  mappingScope: "company" | "global" | "none";
}

interface CashFlowMappingTabProps {
  companyId: string;
  search: string;
  cashFlowAccounts: CashFlowAccountOption[];
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

export function CashFlowMappingTab({ companyId, search, cashFlowAccounts }: CashFlowMappingTabProps) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<CashFlowMappingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftByCode, setDraftByCode] = useState<Record<string, string>>({});
  const [originalByCode, setOriginalByCode] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId });
    const response = await fetch(`/api/cash-flow-category-mapping?${params.toString()}`, { cache: "no-store" });
    const payload = await safeJson<{ rows?: CashFlowMappingRow[]; error?: string }>(response);
    if (!response.ok || !payload?.rows) {
      showToast({
        title: "Falha ao carregar mapeamentos",
        description: payload?.error ?? "Nao foi possivel listar categorias.",
        variant: "destructive",
      });
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(payload.rows);
    const snapshot: Record<string, string> = {};
    payload.rows.forEach((row) => {
      snapshot[row.code] = row.cashFlowAccountId ?? "";
    });
    setDraftByCode({ ...snapshot });
    setOriginalByCode(snapshot);
    setLoading(false);
  }, [companyId, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const changedCodes = useMemo(() => {
    const codes: string[] = [];
    for (const code of Object.keys(draftByCode)) {
      if (draftByCode[code] !== (originalByCode[code] ?? "")) {
        codes.push(code);
      }
    }
    return codes;
  }, [draftByCode, originalByCode]);

  const hasChanges = changedCodes.length > 0;

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter(
      (row) =>
        row.code.toLowerCase().includes(term) ||
        row.description.toLowerCase().includes(term) ||
        `${row.cashFlowAccountCode ?? ""} ${row.cashFlowAccountName ?? ""}`.toLowerCase().includes(term),
    );
  }, [rows, search]);

  const mappedCount = useMemo(
    () => rows.filter((row) => (draftByCode[row.code] ?? "") !== "").length,
    [rows, draftByCode],
  );

  const discardChanges = () => setDraftByCode({ ...originalByCode });

  const saveAll = async () => {
    if (!hasChanges) return;
    const rowsByCode = new Map(rows.map((r) => [r.code, r]));
    const mappings = changedCodes.map((code) => ({
      omieCategoryCode: code,
      omieCategoryName: rowsByCode.get(code)?.description ?? code,
      cashFlowAccountId: draftByCode[code] || null,
    }));

    setSaving(true);
    const response = await fetch("/api/cash-flow-category-mapping/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, mappings }),
    });
    const payload = await safeJson<{ ok?: boolean; saved?: number; cleared?: number; error?: string }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar mapeamentos",
        description: payload?.error ?? "Nao foi possivel salvar os vinculos.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }
    await load();
    setSaving(false);
    showToast({
      title: "Mapeamentos salvos",
      description: `${payload.saved ?? 0} vinculado(s), ${payload.cleared ?? 0} removido(s).`,
      variant: "success",
    });
  };

  // Apenas contas analiticas (com codigo hierarquico, ex.: 2.1) podem ser
  // mapeadas — totalizadoras e linhas com origem especial sao filtradas no
  // server.
  const mappableAccounts = useMemo(
    () => cashFlowAccounts.filter((a) => a.code && a.code.includes(".")),
    [cashFlowAccounts],
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{mappedCount}/{rows.length} mapeadas</span>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading || saving}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
            Atualizar
          </Button>
          {hasChanges && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={discardChanges} disabled={saving}>
                <Undo2 className="mr-2 h-4 w-4" />
                Descartar ({changedCodes.length})
              </Button>
              <Button type="button" size="sm" onClick={() => void saveAll()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar ({changedCodes.length})
              </Button>
            </>
          )}
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        O filtro por departamento da empresa e configurado em <strong>Configuracoes &gt; Departamentos</strong> e
        ja e aplicado automaticamente ao Fluxo de Caixa, igual ao Dashboard DRE.
      </p>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
                  <th className="whitespace-nowrap px-4 py-3 text-left">Codigo</th>
                  <th className="px-4 py-3 text-left">Descricao</th>
                  <th className="px-4 py-3 text-left">Conta de Fluxo de Caixa</th>
                  <th className="px-4 py-3 text-center w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Carregando categorias...
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                      Nenhuma categoria encontrada.
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => {
                    const draftValue = draftByCode[row.code] ?? "";
                    const originalValue = originalByCode[row.code] ?? "";
                    const isModified = draftValue !== originalValue;
                    const isMapped = draftValue !== "";

                    return (
                      <tr
                        key={row.code}
                        className={`border-b transition-colors hover:bg-muted/30 ${
                          isModified ? "bg-blue-50/60" : isMapped ? "" : "bg-amber-50/40"
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium">{row.code}</td>
                        <td className="px-4 py-2.5">
                          <span className="line-clamp-1">{row.description}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            className={`h-9 w-full min-w-[220px] rounded-md border px-2 text-sm ${
                              isModified
                                ? "border-blue-400 bg-blue-50/30 ring-1 ring-blue-200"
                                : "border-input bg-background"
                            }`}
                            value={draftValue}
                            disabled={saving}
                            onChange={(e) =>
                              setDraftByCode((prev) => ({ ...prev, [row.code]: e.target.value }))
                            }
                          >
                            <option value="">Selecione uma conta de Fluxo de Caixa</option>
                            {mappableAccounts.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} - {a.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {isModified ? (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              Alterado
                            </span>
                          ) : isMapped ? (
                            <span className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                              ok
                            </span>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
