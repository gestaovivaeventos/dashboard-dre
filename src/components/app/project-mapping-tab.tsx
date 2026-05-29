"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCcw, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

interface ProjectMappingRow {
  id: string;
  omieProjectCode: string;
  omieProjectName: string | null;
  dreAccountRevenueId: string | null;
  dreAccountExpenseId: string | null;
  dreAccountRevenueCode: string | null;
  dreAccountRevenueName: string | null;
  dreAccountExpenseCode: string | null;
  dreAccountExpenseName: string | null;
}

export interface ProjectMappingAccountOption {
  id: string;
  code: string;
  name: string;
  type: "receita" | "despesa" | "calculado" | "misto";
  is_summary: boolean;
  company_id: string | null;
}

interface ProjectMappingTabProps {
  companyId: string;
  search: string;
  /**
   * Plano DRE custom da empresa selecionada (a UI ja garante que so empresas
   * com plano custom chegam aqui — ver `currentCompanyHasCustomPlan` no parent).
   * As contas calculadas (subresultados) ficam fora dos dropdowns por nao
   * serem alvos validos de mapeamento.
   */
  dreAccounts: ProjectMappingAccountOption[];
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

export function ProjectMappingTab({ companyId, search, dreAccounts }: ProjectMappingTabProps) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<ProjectMappingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftCode, setDraftCode] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftRevenueId, setDraftRevenueId] = useState("");
  const [draftExpenseId, setDraftExpenseId] = useState("");

  // Contas elegiveis como destino:
  //   - revenue dropdown: type='receita' (analitica OU agrupadora)
  //   - expense dropdown: type='despesa' (analitica OU agrupadora)
  // Excluimos type='calculado' (subresultados nao recebem mapeamento direto)
  // e type='misto' (raro, nao usado pela SGX).
  const revenueAccounts = useMemo(
    () => dreAccounts.filter((a) => a.type === "receita"),
    [dreAccounts],
  );
  const expenseAccounts = useMemo(
    () => dreAccounts.filter((a) => a.type === "despesa"),
    [dreAccounts],
  );

  const loadRows = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId });
    const response = await fetch(`/api/project-mapping?${params.toString()}`, {
      cache: "no-store",
    });
    const payload = await safeJson<{ rows?: ProjectMappingRow[]; error?: string }>(response);
    if (!response.ok || !payload?.rows) {
      showToast({
        title: "Falha ao carregar mapeamentos de projeto",
        description: payload?.error ?? "Nao foi possivel listar mapeamentos.",
        variant: "destructive",
      });
      setRows([]);
      setLoading(false);
      return;
    }
    setRows(payload.rows);
    setLoading(false);
  }, [companyId, showToast]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return rows;
    return rows.filter((row) => {
      const haystack = [
        row.omieProjectCode,
        row.omieProjectName ?? "",
        row.dreAccountRevenueCode ?? "",
        row.dreAccountRevenueName ?? "",
        row.dreAccountExpenseCode ?? "",
        row.dreAccountExpenseName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [rows, search]);

  const resetDraft = () => {
    setDraftCode("");
    setDraftName("");
    setDraftRevenueId("");
    setDraftExpenseId("");
  };

  const addMapping = async () => {
    const code = draftCode.trim();
    if (!code) {
      showToast({
        title: "Codigo obrigatorio",
        description: "Informe o codigo do projeto no Omie (cCodProjeto).",
        variant: "destructive",
      });
      return;
    }
    if (!draftRevenueId && !draftExpenseId) {
      showToast({
        title: "Selecione ao menos uma conta",
        description:
          "Defina a conta de Receita, a conta de Despesa, ou ambas — pelo menos uma e obrigatoria.",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    const response = await fetch("/api/project-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        omieProjectCode: code,
        omieProjectName: draftName.trim() || null,
        dreAccountRevenueId: draftRevenueId || null,
        dreAccountExpenseId: draftExpenseId || null,
      }),
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar mapeamento",
        description: payload?.error ?? "Nao foi possivel salvar.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }
    resetDraft();
    await loadRows();
    setSaving(false);
    showToast({
      title: "Mapeamento salvo",
      description: `Projeto ${code} vinculado.`,
      variant: "success",
    });
  };

  const updateMappingField = async (
    row: ProjectMappingRow,
    field: "revenue" | "expense",
    nextAccountId: string | null,
  ) => {
    setSaving(true);
    const response = await fetch("/api/project-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        omieProjectCode: row.omieProjectCode,
        omieProjectName: row.omieProjectName ?? null,
        dreAccountRevenueId:
          field === "revenue" ? nextAccountId : row.dreAccountRevenueId,
        dreAccountExpenseId:
          field === "expense" ? nextAccountId : row.dreAccountExpenseId,
      }),
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao atualizar mapeamento",
        description: payload?.error ?? "Nao foi possivel atualizar.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }
    await loadRows();
    setSaving(false);
  };

  const removeMapping = async (row: ProjectMappingRow) => {
    if (
      !window.confirm(
        `Remover o mapeamento do projeto "${row.omieProjectCode}"? Lancamentos com esse projeto voltarao a usar o mapeamento por categoria.`,
      )
    ) {
      return;
    }
    setSaving(true);
    const response = await fetch(`/api/project-mapping/${row.id}`, {
      method: "DELETE",
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao remover mapeamento",
        description: payload?.error ?? "Nao foi possivel remover.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }
    await loadRows();
    setSaving(false);
    showToast({
      title: "Mapeamento removido",
      description: `Projeto ${row.omieProjectCode} desvinculado.`,
      variant: "success",
    });
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="space-y-1">
            <h3 className="text-base font-semibold">Adicionar novo mapeamento</h3>
            <p className="text-xs text-muted-foreground">
              Informe o codigo do projeto no Omie (cCodProjeto) e escolha as contas DRE
              de destino. Lancamentos com esse projeto serao roteados para a conta de
              Receita ou de Despesa conforme o tipo (cNatureza R/D).
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-muted-foreground">
                Codigo do projeto
              </label>
              <Input
                placeholder="ex.: 12345"
                value={draftCode}
                onChange={(event) => setDraftCode(event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">
                Nome (opcional)
              </label>
              <Input
                placeholder="ex.: TERRAZZO"
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                disabled={saving}
              />
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">
                Conta DRE (Receita)
              </label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={draftRevenueId}
                onChange={(event) => setDraftRevenueId(event.target.value)}
                disabled={saving}
              >
                <option value="">— Sem conta de receita —</option>
                {revenueAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-3">
              <label className="text-xs font-medium text-muted-foreground">
                Conta DRE (Despesa)
              </label>
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={draftExpenseId}
                onChange={(event) => setDraftExpenseId(event.target.value)}
                disabled={saving}
              >
                <option value="">— Sem conta de despesa —</option>
                {expenseAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} - {account.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end md:col-span-1">
              <Button
                type="button"
                onClick={addMapping}
                disabled={saving || loading}
                className="w-full"
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-base font-semibold">
                Mapeamentos cadastrados
              </h3>
              <p className="text-xs text-muted-foreground">
                {rows.length} projeto(s) mapeado(s).
              </p>
            </div>
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
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
                  <th className="whitespace-nowrap px-4 py-3 text-left">
                    Codigo Projeto
                  </th>
                  <th className="px-4 py-3 text-left">Nome</th>
                  <th className="px-4 py-3 text-left">Conta Receita</th>
                  <th className="px-4 py-3 text-left">Conta Despesa</th>
                  <th className="px-4 py-3 text-center w-20">Acoes</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted-foreground">
                      <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
                      Carregando mapeamentos...
                    </td>
                  </tr>
                ) : visibleRows.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-10 text-center text-muted-foreground">
                      {rows.length === 0
                        ? "Nenhum projeto mapeado ainda. Use o formulario acima para adicionar."
                        : "Nenhum mapeamento corresponde ao filtro."}
                    </td>
                  </tr>
                ) : (
                  visibleRows.map((row) => (
                    <tr
                      key={row.id}
                      className="border-b transition-colors hover:bg-muted/30"
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium">
                        {row.omieProjectCode}
                      </td>
                      <td className="px-4 py-2.5 text-muted-foreground">
                        {row.omieProjectName ?? <span className="italic">(sem nome)</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className="h-9 w-full min-w-[200px] rounded-md border border-input bg-background px-2 text-sm"
                          value={row.dreAccountRevenueId ?? ""}
                          disabled={saving}
                          onChange={(event) =>
                            void updateMappingField(
                              row,
                              "revenue",
                              event.target.value || null,
                            )
                          }
                        >
                          <option value="">— Sem conta —</option>
                          {revenueAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} - {account.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5">
                        <select
                          className="h-9 w-full min-w-[200px] rounded-md border border-input bg-background px-2 text-sm"
                          value={row.dreAccountExpenseId ?? ""}
                          disabled={saving}
                          onChange={(event) =>
                            void updateMappingField(
                              row,
                              "expense",
                              event.target.value || null,
                            )
                          }
                        >
                          <option value="">— Sem conta —</option>
                          {expenseAccounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.code} - {account.name}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-4 py-2.5 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => void removeMapping(row)}
                          disabled={saving}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
