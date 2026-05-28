"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  Pencil,
  Plus,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Unlink2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

type CashFlowType = "receita" | "despesa" | "calculado" | "misto";

export interface CashFlowAccountItem {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: CashFlowType;
  is_summary: boolean;
  formula: string | null;
  source: string | null;
  is_highlight_block: boolean;
  sort_order: number;
  active: boolean;
  company_id?: string | null;
  mappings: Array<{
    id: string;
    code: string;
    name: string;
    company_id: string | null;
  }>;
}

interface CompanyOption {
  id: string;
  name: string;
}

interface CashFlowStructureManagerProps {
  initialAccounts: CashFlowAccountItem[];
  companies?: CompanyOption[];
}

const GLOBAL_VALUE = "__global__";

export function CashFlowStructureManager({
  initialAccounts,
  companies = [],
}: CashFlowStructureManagerProps) {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [scopeCompanyId, setScopeCompanyId] = useState<string | null>(null);
  const [usingCustomPlan, setUsingCustomPlan] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    type: CashFlowType;
    is_summary: boolean;
    formula: string;
    sort_order: number;
    active: boolean;
  } | null>(null);

  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<{
    code: string;
    name: string;
    type: CashFlowType;
    parent_id: string;
    sort_order: number;
  }>({ code: "", name: "", type: "despesa", parent_id: "", sort_order: 0 });
  const [createSaving, setCreateSaving] = useState(false);

  const byParent = useMemo(() => {
    const map = new Map<string | null, CashFlowAccountItem[]>();
    accounts.forEach((account) => {
      const siblings = map.get(account.parent_id) ?? [];
      siblings.push(account);
      map.set(account.parent_id, siblings);
    });
    map.forEach((items) => {
      items.sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
    });
    return map;
  }, [accounts]);

  const visibleRows = useMemo(() => {
    const rows: CashFlowAccountItem[] = [];
    const walk = (parentId: string | null) => {
      const children = byParent.get(parentId) ?? [];
      children.forEach((child) => {
        rows.push(child);
        if (expandedIds[child.id]) walk(child.id);
      });
    };
    walk(null);
    return rows;
  }, [byParent, expandedIds]);

  const isLeaf = (accountId: string) => (byParent.get(accountId) ?? []).length === 0;

  const loadForCompany = async (companyId: string | null) => {
    setLoading(true);
    const url = companyId
      ? `/api/cash-flow-accounts?companyId=${encodeURIComponent(companyId)}`
      : "/api/cash-flow-accounts";
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as {
      accounts?: CashFlowAccountItem[];
      scope?: { companyId: string | null; usingCustomPlan: boolean };
      error?: string;
    };
    if (!response.ok || !payload.accounts) {
      showToast({
        title: "Falha ao atualizar estrutura",
        description: payload.error ?? "Erro ao carregar contas de Fluxo de Caixa.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    setAccounts(payload.accounts);
    setScopeCompanyId(payload.scope?.companyId ?? null);
    setUsingCustomPlan(Boolean(payload.scope?.usingCustomPlan));
    setLoading(false);
  };

  useEffect(() => {
    void loadForCompany(selectedCompanyId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCompanyId]);

  const refresh = () => loadForCompany(selectedCompanyId);

  // Lazy-forks the global plan into a per-company plan if the admin starts
  // customizing a company that has no custom plan yet. Returns the up-to-date
  // accounts list for the active scope so callers can resolve cloned ids
  // without waiting for React state to settle.
  const ensureCustomizedIfNeeded = async (): Promise<{
    ok: boolean;
    accounts: CashFlowAccountItem[];
    forked: boolean;
  }> => {
    if (selectedCompanyId === null || (usingCustomPlan && scopeCompanyId === selectedCompanyId)) {
      return { ok: true, accounts, forked: false };
    }

    const response = await fetch("/api/cash-flow-accounts/ensure-customized", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: selectedCompanyId }),
    });
    const payload = (await response.json()) as { error?: string; forked?: boolean };
    if (!response.ok) {
      showToast({
        title: "Falha ao iniciar plano da empresa",
        description: payload.error ?? "Nao foi possivel criar um plano customizado para a empresa.",
        variant: "destructive",
      });
      return { ok: false, accounts, forked: false };
    }

    // Pull the freshly-forked rows so callers can map by code → new id.
    const refreshed = await fetch(
      `/api/cash-flow-accounts?companyId=${encodeURIComponent(selectedCompanyId)}`,
      { cache: "no-store" },
    );
    const refreshedPayload = (await refreshed.json()) as {
      accounts?: CashFlowAccountItem[];
      scope?: { companyId: string | null; usingCustomPlan: boolean };
    };
    const freshAccounts = refreshedPayload.accounts ?? [];
    setAccounts(freshAccounts);
    setScopeCompanyId(refreshedPayload.scope?.companyId ?? selectedCompanyId);
    setUsingCustomPlan(Boolean(refreshedPayload.scope?.usingCustomPlan));
    return { ok: true, accounts: freshAccounts, forked: Boolean(payload.forked) };
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const startEdit = (account: CashFlowAccountItem) => {
    setEditingId(account.id);
    setDraft({
      name: account.name,
      type: account.type,
      is_summary: account.is_summary,
      formula: account.formula ?? "",
      sort_order: account.sort_order,
      active: account.active,
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft(null);
  };

  const saveEdit = async (accountId: string) => {
    if (!draft) return;
    setSavingId(accountId);

    const original = accounts.find((a) => a.id === accountId);
    const ensured = await ensureCustomizedIfNeeded();
    if (!ensured.ok) {
      setSavingId(null);
      return;
    }

    // After lazy-fork, the original (global) account id is no longer valid
    // for this scope. Re-resolve by code against the freshly-forked rows.
    const targetId = ensured.forked && original
      ? ensured.accounts.find((a) => a.code === original.code)?.id ?? null
      : accountId;
    if (!targetId) {
      showToast({
        title: "Conta nao encontrada",
        description: "Nao foi possivel localizar a conta apos preparar o plano da empresa.",
        variant: "destructive",
      });
      setSavingId(null);
      return;
    }

    const payload = {
      ...draft,
      formula: draft.formula.trim() || null,
      is_summary: draft.type === "calculado" ? true : draft.is_summary,
    };
    const response = await fetch(`/api/cash-flow-accounts/${targetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      showToast({
        title: "Falha ao salvar conta",
        description: result.error ?? "Nao foi possivel atualizar a conta.",
        variant: "destructive",
      });
      setSavingId(null);
      return;
    }

    setEditingId(null);
    setDraft(null);
    setSavingId(null);
    await refresh();
    showToast({ title: "Conta atualizada", description: "As alteracoes foram salvas.", variant: "success" });
  };

  const moveSibling = async (account: CashFlowAccountItem, direction: "up" | "down") => {
    const ensured = await ensureCustomizedIfNeeded();
    if (!ensured.ok) return;

    // Re-resolve the row in the active scope (it may be a freshly-cloned row).
    const scoped = ensured.forked
      ? ensured.accounts.find((a) => a.code === account.code)
      : account;
    if (!scoped) return;

    const scopedSiblings = ensured.accounts
      .filter((a) => a.parent_id === scoped.parent_id)
      .sort((a, b) => a.sort_order - b.sort_order || a.code.localeCompare(b.code));
    const currentIndex = scopedSiblings.findIndex((item) => item.id === scoped.id);
    if (currentIndex < 0) return;
    const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= scopedSiblings.length) return;

    const current = scopedSiblings[currentIndex];
    const target = scopedSiblings[swapIndex];
    const updates = [
      { id: current.id, sort_order: target.sort_order },
      { id: target.id, sort_order: current.sort_order },
    ];

    const response = await fetch("/api/cash-flow-accounts/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      showToast({
        title: "Falha ao reordenar",
        description: payload.error ?? "Nao foi possivel alterar a ordenacao.",
        variant: "destructive",
      });
      return;
    }
    await refresh();
  };

  const removeAccount = async (account: CashFlowAccountItem) => {
    if (!isLeaf(account.id)) {
      showToast({
        title: "Conta nao excluivel",
        description: "Contas que possuem subcontas nao podem ser excluidas.",
        variant: "destructive",
      });
      return;
    }
    if (!window.confirm(`Excluir a conta ${account.code} - ${account.name}?`)) return;

    const ensured = await ensureCustomizedIfNeeded();
    if (!ensured.ok) return;

    const targetId = ensured.forked
      ? ensured.accounts.find((a) => a.code === account.code)?.id ?? null
      : account.id;
    if (!targetId) return;

    setSavingId(account.id);
    const response = await fetch(`/api/cash-flow-accounts/${targetId}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      showToast({
        title: "Falha ao excluir conta",
        description: payload.error ?? "Nao foi possivel excluir a conta.",
        variant: "destructive",
      });
      setSavingId(null);
      return;
    }
    await refresh();
    setSavingId(null);
    showToast({ title: "Conta excluida", description: `${account.code} removida.`, variant: "success" });
  };

  const removeMapping = async (mappingId: string, mappingLabel: string) => {
    if (!window.confirm(`Remover o mapeamento ${mappingLabel}?`)) return;
    setSavingId(mappingId);
    const response = await fetch(`/api/cash-flow-category-mapping/${mappingId}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      showToast({
        title: "Falha ao remover mapeamento",
        description: payload.error ?? "Nao foi possivel remover o vinculo.",
        variant: "destructive",
      });
      setSavingId(null);
      return;
    }
    await refresh();
    setSavingId(null);
    showToast({ title: "Mapeamento removido", description: "Vinculo removido.", variant: "success" });
  };

  const startCreate = () => {
    setCreateDraft({ code: "", name: "", type: "despesa", parent_id: "", sort_order: 0 });
    setCreating(true);
  };

  const cancelCreate = () => {
    setCreating(false);
    setCreateDraft({ code: "", name: "", type: "despesa", parent_id: "", sort_order: 0 });
  };

  const submitCreate = async () => {
    const code = createDraft.code.trim();
    const name = createDraft.name.trim();
    if (!code) {
      showToast({ title: "Codigo obrigatorio", variant: "destructive" });
      return;
    }
    if (!/^\d+(\.\d+)*$/.test(code)) {
      showToast({
        title: "Codigo invalido",
        description: "Use o formato '1', '1.1', '1.1.1' etc.",
        variant: "destructive",
      });
      return;
    }
    if (!name) {
      showToast({ title: "Nome obrigatorio", variant: "destructive" });
      return;
    }
    if (!createDraft.parent_id) {
      showToast({
        title: "Selecione uma conta pai",
        description: "Novas contas devem ser adicionadas no ultimo nivel de uma conta agrupadora.",
        variant: "destructive",
      });
      return;
    }

    setCreateSaving(true);
    const parentInDraft = accounts.find((a) => a.id === createDraft.parent_id);
    const ensured = await ensureCustomizedIfNeeded();
    if (!ensured.ok) {
      setCreateSaving(false);
      return;
    }

    // The parent id from the dropdown may have been cloned by the fork — find
    // the equivalent row in the active scope by code.
    let parentId = createDraft.parent_id;
    if (parentInDraft && ensured.forked) {
      const resolved = ensured.accounts.find((a) => a.code === parentInDraft.code)?.id;
      if (resolved) parentId = resolved;
    }

    const response = await fetch("/api/cash-flow-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: selectedCompanyId,
        code,
        name,
        type: createDraft.type,
        parent_id: parentId,
        is_summary: false,
        formula: null,
        sort_order: createDraft.sort_order,
        active: true,
      }),
    });
    const payload = (await response.json()) as { error?: string };
    setCreateSaving(false);

    if (!response.ok) {
      showToast({
        title: "Falha ao criar conta",
        description: payload.error ?? "Nao foi possivel criar a conta.",
        variant: "destructive",
      });
      return;
    }

    cancelCreate();
    await refresh();
    showToast({
      title: "Conta criada",
      description: `${code} - ${name} adicionada.`,
      variant: "success",
    });
  };

  // Eligible parents = aggregator accounts that already have children. We
  // intentionally exclude leaves (adding under a leaf would silently turn it
  // into a parent and block editing of the former leaf), special-source rows
  // (Saldo Inicial/Final, Resultado do Exercicio) and the calculated
  // highlight block (Caixa Gerado/Consumido, Caixa Final).
  const parentOptions = useMemo(
    () =>
      accounts
        .filter((a) => !isLeaf(a.id))
        .filter((a) => !a.source && !a.is_highlight_block && a.type !== "calculado")
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, byParent],
  );

  const selectedCompanyName = companies.find((c) => c.id === selectedCompanyId)?.name;
  const isGlobalView = selectedCompanyId === null;
  const isCustomView = usingCustomPlan && scopeCompanyId === selectedCompanyId;
  const isFallbackToGlobal = selectedCompanyId !== null && !usingCustomPlan;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Estrutura Fluxo de Caixa</CardTitle>
        <p className="text-xs text-muted-foreground">
          Linhas com origem especial (Resultado do Exercicio, Saldo Inicial/Final) nao recebem mapeamento — seu valor vem do DRE ou do calculo de caixa.
          Apenas contas finais (que nao possuem subcontas) podem ser editadas, excluidas ou ter novas contas adicionadas abaixo delas.
        </p>

        {companies.length > 0 && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium text-ink-secondary">Empresa:</label>
            <select
              value={selectedCompanyId ?? GLOBAL_VALUE}
              onChange={(event) =>
                setSelectedCompanyId(
                  event.target.value === GLOBAL_VALUE ? null : event.target.value,
                )
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              disabled={loading}
            >
              <option value={GLOBAL_VALUE}>Plano global (padrao)</option>
              {companies.map((company) => (
                <option key={company.id} value={company.id}>
                  {company.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {isGlobalView && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs text-amber-900 dark:text-amber-200">
            Voce esta editando o <strong>plano global</strong>. Alteracoes aqui afetam todas as
            empresas que ainda nao tem plano customizado.
          </div>
        )}
        {isFallbackToGlobal && selectedCompanyName && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
            <strong>{selectedCompanyName}</strong> ainda usa a estrutura base. Ao salvar a primeira
            alteracao ou adicionar uma nova conta, um plano dedicado para essa empresa sera criado
            automaticamente — o plano global e as demais empresas nao serao afetados.
          </div>
        )}
        {isCustomView && selectedCompanyName && (
          <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
            Editando o <strong>plano customizado</strong> de {selectedCompanyName}. Alteracoes ficam
            isoladas a essa empresa.
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Atualizar estrutura
          </Button>
          <Button type="button" onClick={startCreate} disabled={loading || creating}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar nova conta
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {creating && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Nova conta (ultimo nivel)</h4>
              <button
                type="button"
                onClick={cancelCreate}
                className="rounded p-1 hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Conta pai</label>
                <select
                  value={createDraft.parent_id}
                  onChange={(e) => setCreateDraft({ ...createDraft, parent_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">(selecione uma conta agrupadora)</option>
                  {parentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  A nova conta sera criada como conta final desta conta agrupadora.
                </p>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Codigo</label>
                <Input
                  value={createDraft.code}
                  onChange={(e) => setCreateDraft({ ...createDraft, code: e.target.value })}
                  placeholder="Ex: 3.7"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Nome</label>
                <Input
                  value={createDraft.name}
                  onChange={(e) => setCreateDraft({ ...createDraft, name: e.target.value })}
                  placeholder="Nome descritivo"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Tipo</label>
                <select
                  value={createDraft.type}
                  onChange={(e) =>
                    setCreateDraft({ ...createDraft, type: e.target.value as CashFlowType })
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="receita">receita</option>
                  <option value="despesa">despesa</option>
                  <option value="misto">misto</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Ordem</label>
                <Input
                  type="number"
                  value={createDraft.sort_order}
                  onChange={(e) =>
                    setCreateDraft({ ...createDraft, sort_order: Number(e.target.value || 0) })
                  }
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button type="button" onClick={() => void submitCreate()} disabled={createSaving}>
                {createSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                Salvar conta
              </Button>
              <Button type="button" variant="outline" onClick={cancelCreate}>
                Cancelar
              </Button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-[80px_1.8fr_130px_70px_1fr_120px_80px_90px_220px_220px] gap-2 rounded-md border bg-muted p-2 text-xs font-semibold uppercase text-muted-foreground">
          <span>Codigo</span>
          <span>Nome</span>
          <span>Tipo</span>
          <span>Nivel</span>
          <span>Formula</span>
          <span>Origem</span>
          <span>Ativo</span>
          <span>Ordem</span>
          <span>Mapeamento Omie</span>
          <span>Acoes</span>
        </div>

        <div className="space-y-1">
          {visibleRows.map((account) => {
            const hasChildren = (byParent.get(account.id) ?? []).length > 0;
            const isEditing = editingId === account.id && draft !== null;
            const isHighlight = account.is_highlight_block;
            const isSourced = !!account.source;
            const leaf = !hasChildren;
            const rowClass = isHighlight
              ? "border-viva-500/40 bg-viva-500/5"
              : account.type === "calculado"
                ? "border-blue-500/30 bg-blue-500/10"
                : "border-border bg-background";

            return (
              <div
                key={account.id}
                className={`grid grid-cols-[80px_1.8fr_130px_70px_1fr_120px_80px_90px_220px_220px] items-center gap-2 rounded-md border p-2 text-sm ${rowClass}`}
              >
                <div className="font-medium">{account.code}</div>
                <div className="flex items-center gap-2" style={{ paddingLeft: `${(account.level - 1) * 14}px` }}>
                  {hasChildren ? (
                    <button type="button" onClick={() => toggleExpanded(account.id)} className="rounded p-0.5 hover:bg-muted">
                      {expandedIds[account.id] ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                  ) : (
                    <span className="h-4 w-4" />
                  )}
                  {isEditing ? (
                    <Input
                      value={draft.name}
                      onChange={(e) => setDraft((p) => p ? { ...p, name: e.target.value } : p)}
                    />
                  ) : (
                    <span className="truncate">{account.name}</span>
                  )}
                </div>
                <div>
                  {isEditing ? (
                    <select
                      value={draft.type}
                      onChange={(e) => setDraft((p) => p ? {
                        ...p,
                        type: e.target.value as CashFlowType,
                        is_summary: e.target.value === "calculado" ? true : p.is_summary,
                      } : p)}
                      className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="receita">receita</option>
                      <option value="despesa">despesa</option>
                      <option value="calculado">calculado</option>
                      <option value="misto">misto</option>
                    </select>
                  ) : (
                    <span>{account.type}</span>
                  )}
                </div>
                <div>{account.level}</div>
                <div>
                  {isEditing ? (
                    <Input
                      value={draft.formula}
                      onChange={(e) => setDraft((p) => p ? { ...p, formula: e.target.value } : p)}
                      disabled={draft.type !== "calculado"}
                      placeholder={draft.type === "calculado" ? "Ex: 1+2+3" : ""}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{account.formula ?? "-"}</span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground truncate" title={account.source ?? ""}>
                  {account.source ?? "-"}
                </div>
                <div>
                  {isEditing ? (
                    <button type="button" onClick={() => setDraft((p) => p ? { ...p, active: !p.active } : p)} className="inline-flex items-center">
                      {draft.active ? <ToggleRight className="h-6 w-6 text-emerald-600" /> : <ToggleLeft className="h-6 w-6 text-muted-foreground" />}
                    </button>
                  ) : account.active ? "Sim" : "Nao"}
                </div>
                <div>
                  {isEditing ? (
                    <Input
                      type="number"
                      value={draft.sort_order}
                      onChange={(e) => setDraft((p) => p ? { ...p, sort_order: Number(e.target.value || p.sort_order) } : p)}
                    />
                  ) : (
                    account.sort_order
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {isSourced ? (
                    <span className="italic">N/A (origem especial)</span>
                  ) : account.mappings.length === 0 ? (
                    "-"
                  ) : (
                    account.mappings.map((mapping) => {
                      const mappingLabel = `${mapping.code} - ${mapping.name}`;
                      const isRemoving = savingId === mapping.id;
                      return (
                        <div key={mapping.id} className="flex items-center justify-between gap-2 rounded border bg-background px-1 py-0.5">
                          <span className="truncate">{mappingLabel}</span>
                          <button
                            type="button"
                            className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-50"
                            onClick={() => void removeMapping(mapping.id, mappingLabel)}
                            disabled={isRemoving}
                          >
                            {isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink2 className="h-3 w-3" />}
                          </button>
                        </div>
                      );
                    })
                  )}
                </div>
                <div className="flex flex-wrap gap-1">
                  {isEditing ? (
                    <>
                      <Button type="button" size="sm" onClick={() => void saveEdit(account.id)} disabled={savingId === account.id}>
                        {savingId === account.id ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Save className="mr-2 h-3 w-3" />}
                        Salvar
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={cancelEdit}>
                        Cancelar
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(account)}>
                      <Pencil className="mr-2 h-3 w-3" />
                      Editar
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="outline" onClick={() => void moveSibling(account, "up")}>
                    <ChevronsUpDown className="mr-2 h-3 w-3 rotate-180" />
                    Subir
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => void moveSibling(account, "down")}>
                    <ChevronsUpDown className="mr-2 h-3 w-3" />
                    Descer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void removeAccount(account)}
                    disabled={savingId === account.id || !leaf}
                    title={!leaf ? "Conta agrupadora — possui subcontas." : undefined}
                  >
                    {savingId === account.id ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Trash2 className="mr-2 h-3 w-3" />}
                    Excluir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
