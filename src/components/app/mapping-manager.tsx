"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCcw, Save, Search, Undo2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

type Tab = "omie" | "budget";

interface CompanyOption {
  id: string;
  name: string;
}

interface DreAccountOption {
  id: string;
  code: string;
  name: string;
}

interface MappingRow {
  code: string;
  description: string;
  mappingId: string | null;
  dreAccountId: string | null;
  dreAccountCode: string | null;
  dreAccountName: string | null;
  mappingScope: "company" | "global" | "none";
}

interface BudgetMappingRow {
  id: string;
  label: string;
  dreAccountId: string | null;
  dreAccountCode: string | null;
  dreAccountName: string | null;
  rowsCount: number;
}

interface MappingManagerProps {
  companies: CompanyOption[];
  dreAccounts: DreAccountOption[];
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

export function MappingManager({ companies, dreAccounts }: MappingManagerProps) {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>("omie");
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");

  // Estado atual dos selects (draft) e estado original (salvo no banco)
  const [draftByCode, setDraftByCode] = useState<Record<string, string>>({});
  const [originalByCode, setOriginalByCode] = useState<Record<string, string>>({});

  // Budget tab state
  const [budgetRows, setBudgetRows] = useState<BudgetMappingRow[]>([]);
  const [budgetLoading, setBudgetLoading] = useState(false);
  const [budgetSaving, setBudgetSaving] = useState(false);
  const [budgetDraftByLabel, setBudgetDraftByLabel] = useState<Record<string, string>>({});
  const [budgetOriginalByLabel, setBudgetOriginalByLabel] = useState<Record<string, string>>({});

  const loadRows = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId });
    const response = await fetch(`/api/category-mapping?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await safeJson<{ rows?: MappingRow[]; error?: string }>(response);
    if (!response.ok || !payload?.rows) {
      showToast({
        title: "Falha ao carregar mapeamentos",
        description: payload?.error ?? "Nao foi possivel listar categorias Omie.",
        variant: "destructive",
      });
      setRows([]);
      setLoading(false);
      return;
    }

    setRows(payload.rows);
    const snapshot: Record<string, string> = {};
    payload.rows.forEach((row) => {
      snapshot[row.code] = row.dreAccountId ?? "";
    });
    setDraftByCode({ ...snapshot });
    setOriginalByCode(snapshot);
    setLoading(false);
  }, [companyId, showToast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const loadBudgetRows = useCallback(async () => {
    if (!companyId) return;
    setBudgetLoading(true);
    const params = new URLSearchParams({ companyId });
    const response = await fetch(`/api/budget-mapping?${params.toString()}`, { cache: "no-store" });
    const payload = await safeJson<{ rows?: BudgetMappingRow[]; error?: string }>(response);
    if (!response.ok || !payload?.rows) {
      showToast({
        title: "Falha ao carregar mapeamentos de orcamento",
        description: payload?.error ?? "Nao foi possivel listar linhas do orcamento.",
        variant: "destructive",
      });
      setBudgetRows([]);
      setBudgetLoading(false);
      return;
    }
    setBudgetRows(payload.rows);
    const snapshot: Record<string, string> = {};
    payload.rows.forEach((row) => {
      snapshot[row.label] = row.dreAccountId ?? "";
    });
    setBudgetDraftByLabel({ ...snapshot });
    setBudgetOriginalByLabel(snapshot);
    setBudgetLoading(false);
  }, [companyId, showToast]);

  useEffect(() => {
    if (tab === "budget") void loadBudgetRows();
  }, [tab, loadBudgetRows]);

  const budgetChangedLabels = useMemo(() => {
    const labels: string[] = [];
    for (const label of Object.keys(budgetDraftByLabel)) {
      if (budgetDraftByLabel[label] !== budgetOriginalByLabel[label]) {
        labels.push(label);
      }
    }
    return labels;
  }, [budgetDraftByLabel, budgetOriginalByLabel]);

  const budgetHasChanges = budgetChangedLabels.length > 0;

  const visibleBudgetRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return budgetRows;
    return budgetRows.filter(
      (row) =>
        row.label.toLowerCase().includes(term) ||
        `${row.dreAccountCode ?? ""} ${row.dreAccountName ?? ""}`.toLowerCase().includes(term),
    );
  }, [budgetRows, search]);

  const budgetMappedCount = useMemo(() => {
    return budgetRows.filter((row) => {
      const draft = budgetDraftByLabel[row.label];
      return draft !== undefined && draft !== "";
    }).length;
  }, [budgetRows, budgetDraftByLabel]);

  const discardBudgetChanges = () => {
    setBudgetDraftByLabel({ ...budgetOriginalByLabel });
  };

  const saveAllBudgetChanges = async () => {
    if (!budgetHasChanges) return;
    const mappings = budgetChangedLabels.map((label) => ({
      label,
      dreAccountId: budgetDraftByLabel[label] || null,
    }));
    setBudgetSaving(true);
    const response = await fetch("/api/budget-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, mappings }),
    });
    const payload = await safeJson<{
      ok?: boolean;
      saved?: number;
      cleared?: number;
      imported?: number;
      error?: string;
    }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar mapeamentos",
        description: payload?.error ?? "Nao foi possivel salvar.",
        variant: "destructive",
      });
      setBudgetSaving(false);
      return;
    }
    await loadBudgetRows();
    setBudgetSaving(false);
    showToast({
      title: "Mapeamentos salvos",
      description: `${payload.saved ?? 0} vinculado(s), ${payload.cleared ?? 0} removido(s), ${payload.imported ?? 0} celula(s) gravadas em budget_entries.`,
      variant: "success",
    });
  };

  // Calcular quais linhas foram modificadas
  const changedCodes = useMemo(() => {
    const codes: string[] = [];
    for (const code of Object.keys(draftByCode)) {
      if (draftByCode[code] !== originalByCode[code]) {
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
        `${row.dreAccountCode ?? ""} ${row.dreAccountName ?? ""}`.toLowerCase().includes(term),
    );
  }, [rows, search]);

  const mappedCount = useMemo(() => {
    return rows.filter((row) => {
      const draft = draftByCode[row.code];
      return draft !== undefined && draft !== "";
    }).length;
  }, [rows, draftByCode]);

  // Descarta todas as alterações pendentes
  const discardChanges = () => {
    setDraftByCode({ ...originalByCode });
  };

  // Salvar todas as alterações em lote
  const saveAllChanges = async () => {
    if (!hasChanges) return;

    const rowsByCode = new Map(rows.map((r) => [r.code, r]));
    const mappings = changedCodes.map((code) => ({
      omieCategoryCode: code,
      omieCategoryName: rowsByCode.get(code)?.description ?? code,
      dreAccountId: draftByCode[code] || null,
    }));

    setSaving(true);
    const response = await fetch("/api/category-mapping/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, mappings }),
    });
    const payload = await safeJson<{
      ok?: boolean;
      saved?: number;
      cleared?: number;
      error?: string;
    }>(response);

    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar mapeamentos",
        description: payload?.error ?? "Nao foi possivel salvar os vinculos.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }

    await loadRows();
    setSaving(false);
    showToast({
      title: "Mapeamentos salvos",
      description: `${payload.saved ?? 0} vinculado(s), ${payload.cleared ?? 0} removido(s).`,
      variant: "success",
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Mapeamento</h2>
        <p className="text-sm text-muted-foreground">
          Vincule cada origem (categoria Omie ou linha do orcamento) a uma conta do DRE.
        </p>
      </div>

      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant={tab === "omie" ? "default" : "outline"}
          onClick={() => setTab("omie")}
        >
          Categorias Omie
        </Button>
        <Button
          type="button"
          size="sm"
          variant={tab === "budget" ? "default" : "outline"}
          onClick={() => setTab("budget")}
        >
          Linhas do Orcamento
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
                disabled={saving || budgetSaving}
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
                onClick={() => (tab === "omie" ? void loadRows() : void loadBudgetRows())}
                disabled={loading || saving || budgetLoading || budgetSaving}
              >
                {(tab === "omie" ? loading : budgetLoading) ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCcw className="mr-2 h-4 w-4" />
                )}
                Atualizar
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 w-64"
                  placeholder={tab === "omie" ? "Buscar categoria ou conta DRE" : "Buscar linha ou conta DRE"}
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {tab === "omie"
                  ? `${mappedCount}/${rows.length} mapeadas`
                  : `${budgetMappedCount}/${budgetRows.length} mapeadas`}
              </span>
            </div>
          </div>
        </CardHeader>
      </Card>

      {tab === "omie" ? (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
                  <th className="whitespace-nowrap px-4 py-3 text-left">Codigo</th>
                  <th className="px-4 py-3 text-left">Descricao</th>
                  <th className="px-4 py-3 text-left">Conta DRE</th>
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
                          isModified
                            ? "bg-blue-50/60"
                            : isMapped
                              ? ""
                              : "bg-amber-50/40"
                        }`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium">
                          {row.code}
                        </td>
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
                            onChange={(event) =>
                              setDraftByCode((previous) => ({
                                ...previous,
                                [row.code]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Selecione uma conta DRE</option>
                            {dreAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.code} - {account.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {isModified && (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              Alterado
                            </span>
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

      ) : (
      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
                  <th className="px-4 py-3 text-left">Linha do Orcamento</th>
                  <th className="px-4 py-3 text-center w-24">Linhas</th>
                  <th className="px-4 py-3 text-left">Conta DRE</th>
                  <th className="px-4 py-3 text-center w-20">Status</th>
                </tr>
              </thead>
              <tbody>
                {budgetLoading ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Carregando linhas do orcamento...
                    </td>
                  </tr>
                ) : visibleBudgetRows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-muted-foreground">
                      Nenhuma linha encontrada. Faca upload de uma planilha de orcamento em Configuracoes.
                    </td>
                  </tr>
                ) : (
                  visibleBudgetRows.map((row) => {
                    const draftValue = budgetDraftByLabel[row.label] ?? "";
                    const originalValue = budgetOriginalByLabel[row.label] ?? "";
                    const isModified = draftValue !== originalValue;
                    const isMapped = draftValue !== "";
                    return (
                      <tr
                        key={row.label}
                        className={`border-b transition-colors hover:bg-muted/30 ${
                          isModified ? "bg-blue-50/60" : isMapped ? "" : "bg-amber-50/40"
                        }`}
                      >
                        <td className="px-4 py-2.5">
                          <span className="line-clamp-1">{row.label}</span>
                        </td>
                        <td className="px-4 py-2.5 text-center text-xs text-muted-foreground">
                          {row.rowsCount}
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            className={`h-9 w-full min-w-[220px] rounded-md border px-2 text-sm ${
                              isModified
                                ? "border-blue-400 bg-blue-50/30 ring-1 ring-blue-200"
                                : "border-input bg-background"
                            }`}
                            value={draftValue}
                            disabled={budgetSaving}
                            onChange={(event) =>
                              setBudgetDraftByLabel((previous) => ({
                                ...previous,
                                [row.label]: event.target.value,
                              }))
                            }
                          >
                            <option value="">Selecione uma conta DRE</option>
                            {dreAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.code} - {account.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5 text-center">
                          {isModified && (
                            <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                              Alterado
                            </span>
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
      )}

      {/* Barra fixa de ações quando há alterações pendentes (Omie) */}
      {tab === "omie" && hasChanges && (
        <div className="sticky bottom-4 z-10">
          <div className="mx-auto flex items-center justify-between gap-4 rounded-lg border bg-background p-4 shadow-lg">
            <span className="text-sm font-medium">
              {changedCodes.length} {changedCodes.length === 1 ? "alteracao pendente" : "alteracoes pendentes"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={discardChanges}
                disabled={saving}
              >
                <Undo2 className="mr-1.5 h-4 w-4" />
                Descartar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveAllChanges()}
                disabled={saving}
              >
                {saving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                Salvar Modificacoes
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Barra fixa de acoes (Orcamento) */}
      {tab === "budget" && budgetHasChanges && (
        <div className="sticky bottom-4 z-10">
          <div className="mx-auto flex items-center justify-between gap-4 rounded-lg border bg-background p-4 shadow-lg">
            <span className="text-sm font-medium">
              {budgetChangedLabels.length} {budgetChangedLabels.length === 1 ? "alteracao pendente" : "alteracoes pendentes"}
            </span>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={discardBudgetChanges}
                disabled={budgetSaving}
              >
                <Undo2 className="mr-1.5 h-4 w-4" />
                Descartar
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => void saveAllBudgetChanges()}
                disabled={budgetSaving}
              >
                {budgetSaving ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-1.5 h-4 w-4" />
                )}
                Salvar Modificacoes
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
