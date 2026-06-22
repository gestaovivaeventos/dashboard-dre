"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Copy,
  Loader2,
  Pencil,
  Plus,
  Save,
  Trash2,
  ToggleLeft,
  ToggleRight,
  Unlink2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

type DreType = "receita" | "despesa" | "calculado" | "misto";

interface DreAccountItem {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  level: number;
  type: DreType;
  is_summary: boolean;
  formula: string | null;
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

interface DreStructureManagerProps {
  initialAccounts: DreAccountItem[];
  companies?: CompanyOption[];
  // Lista completa de empresas no sistema (cross-segment) usada pelo
  // "Copiar Plano de Contas" para permitir copiar plano de qualquer empresa.
  allCompanies?: CompanyOption[];
}

const GLOBAL_VALUE = "__global__";

export function DreStructureManager({
  initialAccounts,
  companies = [],
  allCompanies = [],
}: DreStructureManagerProps) {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState(initialAccounts);
  const [scopeCompanyId, setScopeCompanyId] = useState<string | null>(null);
  const [usingCustomPlan, setUsingCustomPlan] = useState(false);
  // selectedCompanyId === null means "Plano global"; otherwise an empresa is selected.
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<{
    name: string;
    type: DreType;
    is_summary: boolean;
    formula: string;
    sort_order: number;
    active: boolean;
  } | null>(null);

  // "Criar nova conta" form state.
  const [creating, setCreating] = useState(false);
  const [createDraft, setCreateDraft] = useState<{
    code: string;
    name: string;
    type: DreType;
    parent_id: string;
    formula: string;
    is_summary: boolean;
    sort_order: number;
  }>({
    code: "",
    name: "",
    type: "despesa",
    parent_id: "",
    formula: "",
    is_summary: false,
    sort_order: 0,
  });
  const [createSaving, setCreateSaving] = useState(false);

  // "Copiar Plano de Contas" modal state.
  const [copyOpen, setCopyOpen] = useState(false);
  // sourceCompanyId: "" = plano global; otherwise an empresa id.
  const [copySourceId, setCopySourceId] = useState<string>("");
  const [copySaving, setCopySaving] = useState(false);
  const [copyConfirmOverwrite, setCopyConfirmOverwrite] = useState(false);

  const byParent = useMemo(() => {
    const map = new Map<string | null, DreAccountItem[]>();
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
    const rows: DreAccountItem[] = [];
    const walk = (parentId: string | null) => {
      const children = byParent.get(parentId) ?? [];
      children.forEach((child) => {
        rows.push(child);
        if (expandedIds[child.id]) {
          walk(child.id);
        }
      });
    };
    walk(null);
    return rows;
  }, [byParent, expandedIds]);

  const isLeaf = (accountId: string) => (byParent.get(accountId) ?? []).length === 0;

  const loadForCompany = async (companyId: string | null) => {
    setLoading(true);
    setMessage(null);
    const url = companyId
      ? `/api/dre-accounts?companyId=${encodeURIComponent(companyId)}`
      : "/api/dre-accounts";
    const response = await fetch(url, { cache: "no-store" });
    const payload = (await response.json()) as {
      accounts?: DreAccountItem[];
      scope?: { companyId: string | null; usingCustomPlan: boolean };
      error?: string;
    };
    if (!response.ok || !payload.accounts) {
      setMessage(payload.error ?? "Falha ao carregar estrutura DRE.");
      showToast({
        title: "Falha ao atualizar estrutura",
        description: payload.error ?? "Erro ao carregar contas DRE.",
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

  // Reload accounts whenever the selected company changes.
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
    accounts: DreAccountItem[];
    forked: boolean;
  }> => {
    if (selectedCompanyId === null || (usingCustomPlan && scopeCompanyId === selectedCompanyId)) {
      return { ok: true, accounts, forked: false };
    }

    const response = await fetch("/api/dre-accounts/ensure-customized", {
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
      `/api/dre-accounts?companyId=${encodeURIComponent(selectedCompanyId)}`,
      { cache: "no-store" },
    );
    const refreshedPayload = (await refreshed.json()) as {
      accounts?: DreAccountItem[];
      scope?: { companyId: string | null; usingCustomPlan: boolean };
    };
    const freshAccounts = refreshedPayload.accounts ?? [];
    setAccounts(freshAccounts);
    setScopeCompanyId(refreshedPayload.scope?.companyId ?? selectedCompanyId);
    setUsingCustomPlan(Boolean(refreshedPayload.scope?.usingCustomPlan));
    return { ok: true, accounts: freshAccounts, forked: Boolean(payload.forked) };
  };

  const toggleExpanded = (id: string) => {
    setExpandedIds((previous) => ({ ...previous, [id]: !previous[id] }));
  };

  const startEdit = (account: DreAccountItem) => {
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

  const saveEdit = async (accountId: string) => {
    if (!draft) return;
    setSavingId(accountId);
    setMessage(null);

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
    const response = await fetch(`/api/dre-accounts/${targetId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? "Falha ao salvar conta.");
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
    setMessage("Conta atualizada com sucesso.");
    showToast({
      title: "Conta atualizada",
      description: "As alteracoes foram salvas.",
      variant: "success",
    });
  };

  const moveSibling = async (account: DreAccountItem, direction: "up" | "down") => {
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

    const response = await fetch("/api/dre-accounts/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao reordenar conta.");
      showToast({
        title: "Falha ao reordenar",
        description: payload.error ?? "Nao foi possivel alterar a ordenacao.",
        variant: "destructive",
      });
      return;
    }
    await refresh();
    showToast({
      title: "Ordenacao atualizada",
      description: "A conta foi movida com sucesso.",
      variant: "success",
    });
  };

  const removeAccount = async (account: DreAccountItem) => {
    if (!isLeaf(account.id)) {
      showToast({
        title: "Conta nao excluivel",
        description: "Contas que possuem subcontas nao podem ser excluidas.",
        variant: "destructive",
      });
      return;
    }
    if (
      !window.confirm(
        `Excluir a conta ${account.code} - ${account.name}? Essa acao nao pode ser desfeita.`,
      )
    ) {
      return;
    }

    const ensured = await ensureCustomizedIfNeeded();
    if (!ensured.ok) return;

    const targetId = ensured.forked
      ? ensured.accounts.find((a) => a.code === account.code)?.id ?? null
      : account.id;
    if (!targetId) {
      showToast({
        title: "Conta nao encontrada",
        description: "Nao foi possivel localizar a conta apos preparar o plano da empresa.",
        variant: "destructive",
      });
      return;
    }

    setSavingId(account.id);
    setMessage(null);
    const response = await fetch(`/api/dre-accounts/${targetId}`, {
      method: "DELETE",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao excluir conta.");
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
    showToast({
      title: "Conta excluida",
      description: `${account.code} removida com sucesso.`,
      variant: "success",
    });
  };

  const removeMapping = async (mappingId: string, mappingLabel: string) => {
    if (
      !window.confirm(
        `Remover o mapeamento ${mappingLabel}? Essa acao impacta a classificacao dos lancamentos.`,
      )
    ) {
      return;
    }

    setSavingId(mappingId);
    setMessage(null);
    const response = await fetch(`/api/category-mapping/${mappingId}`, {
      method: "DELETE",
    });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao remover mapeamento.");
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
    showToast({
      title: "Mapeamento removido",
      description: "Vinculo com categoria Omie removido.",
      variant: "success",
    });
  };

  const cancelCreate = () => {
    setCreating(false);
    setCreateDraft({
      code: "",
      name: "",
      type: "despesa",
      parent_id: "",
      formula: "",
      is_summary: false,
      sort_order: 0,
    });
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
    // No plano global a conta pai e obrigatoria (mantem a estrutura validada
    // intacta). Num plano customizado por empresa, deixar a conta pai vazia cria
    // uma conta de nivel 1 (top-level) — usado para particularidades como as
    // linhas extras da Viva Juiz de Fora.
    if (!createDraft.parent_id && selectedCompanyId === null) {
      showToast({
        title: "Selecione uma conta pai",
        description: "No plano global, novas contas devem ser adicionadas no ultimo nivel de uma conta agrupadora.",
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
    let parentId: string = createDraft.parent_id;
    if (parentInDraft && ensured.forked) {
      const resolved = ensured.accounts.find((a) => a.code === parentInDraft.code)?.id;
      if (resolved) parentId = resolved;
    }

    const response = await fetch("/api/dre-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        company_id: selectedCompanyId,
        code,
        name,
        type: createDraft.type,
        parent_id: parentId || null,
        is_summary: createDraft.type === "calculado" ? true : createDraft.is_summary,
        formula: createDraft.formula.trim() || null,
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
      description: `${code} - ${name} adicionada ao plano.`,
      variant: "success",
    });
  };

  const openCopyModal = () => {
    setCopySourceId("");
    setCopyConfirmOverwrite(false);
    setCopyOpen(true);
  };

  const cancelCopy = () => {
    setCopyOpen(false);
    setCopySourceId("");
    setCopyConfirmOverwrite(false);
  };

  const submitCopy = async (force: boolean) => {
    if (!selectedCompanyId) return;
    setCopySaving(true);

    const response = await fetch("/api/dre-accounts/copy-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceCompanyId: copySourceId || null,
        targetCompanyId: selectedCompanyId,
        force,
      }),
    });
    const payload = (await response.json()) as {
      ok?: boolean;
      copied?: number;
      error?: string;
      existingCount?: number;
    };
    setCopySaving(false);

    if (response.status === 409) {
      // Empresa destino ja possui plano customizado. Mostra opcao de
      // sobrescrever exigindo confirmacao explicita.
      setCopyConfirmOverwrite(true);
      showToast({
        title: "Empresa destino ja possui plano",
        description: `Encontradas ${payload.existingCount ?? 0} contas customizadas. Confirme a substituicao para prosseguir.`,
        variant: "destructive",
      });
      return;
    }

    if (!response.ok) {
      showToast({
        title: "Falha ao copiar plano",
        description: payload.error ?? "Nao foi possivel copiar o plano.",
        variant: "destructive",
      });
      return;
    }

    cancelCopy();
    await refresh();
    showToast({
      title: "Plano copiado",
      description: `${payload.copied ?? 0} contas copiadas.`,
      variant: "success",
    });
  };

  // Eligible parents = aggregator accounts. Includes rows that already have
  // children OR were explicitly flagged as `is_summary` (totalizadora) — the
  // latter covers freshly-created aggregators in a custom plan that don't have
  // children yet but were created precisely to host new subaccounts. We still
  // exclude pure leaves (turning a leaf into a parent would silently change
  // its role).
  //
  // Contas calculadas normalmente derivam de uma formula e nao hospedam
  // subcontas — por isso ficam de fora por padrao. Mas alguns planos usam uma
  // conta calculada como total E agrupadora ao mesmo tempo (ex.: "5 - Custos
  // com os Servicos Prestados" = 5.1+...+5.11, com as subcontas 5.1..5.x
  // penduradas nela). Quando a calculada JA tem filhos, ela claramente serve
  // de agrupadora, entao a liberamos como conta pai. Calculadas-folha (ex.:
  // "4 - Receita Liquida") seguem excluidas: vira-las em pai mudaria seu papel.
  const parentOptions = useMemo(
    () =>
      accounts
        .filter((a) => {
          const hasChildren = !isLeaf(a.id);
          if (a.type === "calculado") return hasChildren;
          return hasChildren || a.is_summary;
        })
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, byParent],
  );

  const selectedCompanyName = companies.find((c) => c.id === selectedCompanyId)?.name;

  // Banner visibility: explain which plan is currently shown.
  const isGlobalView = selectedCompanyId === null;
  const isCustomView = usingCustomPlan && scopeCompanyId === selectedCompanyId;
  const isFallbackToGlobal = selectedCompanyId !== null && !usingCustomPlan;

  return (
    <Card>
      <CardHeader className="space-y-3">
        <CardTitle>Estrutura DRE</CardTitle>

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
            empresas que ainda nao tem plano customizado (incluindo o segmento Franquias Viva).
          </div>
        )}
        {isFallbackToGlobal && selectedCompanyName && (
          <div className="rounded-md border border-blue-500/30 bg-blue-500/5 px-3 py-2 text-xs text-blue-900 dark:text-blue-200">
            <strong>{selectedCompanyName}</strong> ainda nao tem plano customizado e esta usando o
            plano global. Crie a primeira conta abaixo para iniciar um plano dedicado a essa empresa
            (o plano global nao sera afetado).
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
          <Button
            type="button"
            onClick={() => setCreating(true)}
            disabled={loading || creating}
          >
            <Plus className="mr-2 h-4 w-4" />
            Criar nova conta
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={openCopyModal}
            disabled={loading || !selectedCompanyId}
            title={
              !selectedCompanyId
                ? "Selecione uma empresa para copiar um plano para ela"
                : undefined
            }
          >
            <Copy className="mr-2 h-4 w-4" />
            Copiar Plano de Contas
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {copyOpen && selectedCompanyId && (
          <div
            role="dialog"
            aria-modal="true"
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
            onClick={(e) => {
              if (e.target === e.currentTarget && !copySaving) cancelCopy();
            }}
          >
            <div className="w-full max-w-md rounded-lg border bg-background p-5 shadow-lg space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Copiar Plano de Contas</h3>
                <button
                  type="button"
                  onClick={cancelCopy}
                  disabled={copySaving}
                  className="rounded p-1 hover:bg-muted disabled:opacity-50"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <p className="text-sm text-muted-foreground">
                Copia toda a estrutura DRE da origem para <strong>{selectedCompanyName}</strong>.
                Apenas a estrutura e copiada — mapeamentos Omie nao sao copiados.
              </p>

              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  Empresa de origem
                </label>
                <select
                  value={copySourceId}
                  onChange={(e) => {
                    setCopySourceId(e.target.value);
                    setCopyConfirmOverwrite(false);
                  }}
                  disabled={copySaving}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">Plano global (padrao Franquias Viva)</option>
                  {allCompanies
                    .filter((c) => c.id !== selectedCompanyId)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </div>

              {copyConfirmOverwrite && (
                <div className="rounded-md border border-red-500/40 bg-red-500/5 p-3 text-xs text-red-900 dark:text-red-200 space-y-2">
                  <p>
                    <strong>{selectedCompanyName}</strong> ja tem um plano customizado.
                    Continuar substitui todas as contas atuais e remove os mapeamentos
                    Omie vinculados a elas. Esta acao nao pode ser desfeita.
                  </p>
                </div>
              )}

              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={cancelCopy}
                  disabled={copySaving}
                >
                  Cancelar
                </Button>
                {copyConfirmOverwrite ? (
                  <Button
                    type="button"
                    variant="destructive"
                    onClick={() => void submitCopy(true)}
                    disabled={copySaving}
                  >
                    {copySaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Substituir e copiar
                  </Button>
                ) : (
                  <Button
                    type="button"
                    onClick={() => void submitCopy(false)}
                    disabled={copySaving}
                  >
                    {copySaving ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Copy className="mr-2 h-4 w-4" />
                    )}
                    Copiar
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {creating && (
          <div className="rounded-md border bg-muted/30 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold">Nova conta</h4>
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
                <label className="text-xs font-medium text-muted-foreground">Codigo</label>
                <Input
                  value={createDraft.code}
                  onChange={(e) => setCreateDraft({ ...createDraft, code: e.target.value })}
                  placeholder="Ex: 7.6 ou 7.3.21"
                />
                <p className="text-xs text-muted-foreground">
                  Nivel sera deduzido pelo numero de pontos.
                </p>
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
                    setCreateDraft({
                      ...createDraft,
                      type: e.target.value as DreType,
                      is_summary: e.target.value === "calculado" ? true : createDraft.is_summary,
                    })
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="receita">receita</option>
                  <option value="despesa">despesa</option>
                  <option value="calculado">calculado (somatorio)</option>
                  <option value="misto">misto</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Conta pai</label>
                <select
                  value={createDraft.parent_id}
                  onChange={(e) => setCreateDraft({ ...createDraft, parent_id: e.target.value })}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                >
                  <option value="">
                    {selectedCompanyId === null
                      ? "(selecione uma conta agrupadora)"
                      : "(nenhuma — criar conta de nivel 1 / top-level)"}
                  </option>
                  {parentOptions.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.code} - {a.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {selectedCompanyId === null
                    ? "A nova conta sera criada como conta final desta conta agrupadora."
                    : "Com conta pai: criada como conta final dela. Sem conta pai: criada como conta de nivel 1 (top-level) deste plano da empresa."}
                </p>
              </div>
              {createDraft.type === "calculado" && (
                <div className="space-y-1 sm:col-span-2">
                  <label className="text-xs font-medium text-muted-foreground">
                    Formula (ex.: 4-5 ou 7.1+7.2+7.3)
                  </label>
                  <Input
                    value={createDraft.formula}
                    onChange={(e) => setCreateDraft({ ...createDraft, formula: e.target.value })}
                    placeholder="Codigos de outras contas separados por + ou -"
                  />
                </div>
              )}
              {createDraft.type !== "calculado" && (
                <div className="flex items-center gap-2">
                  <input
                    id="create-is-summary"
                    type="checkbox"
                    checked={createDraft.is_summary}
                    onChange={(e) =>
                      setCreateDraft({ ...createDraft, is_summary: e.target.checked })
                    }
                  />
                  <label htmlFor="create-is-summary" className="text-xs text-muted-foreground">
                    E uma conta totalizadora (somatorio dos filhos)
                  </label>
                </div>
              )}
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

        <div className="grid grid-cols-[80px_1.8fr_130px_70px_1fr_80px_90px_170px_220px] gap-2 rounded-md border bg-muted p-2 text-xs font-semibold uppercase text-muted-foreground">
          <span>Codigo</span>
          <span>Nome</span>
          <span>Tipo</span>
          <span>Nivel</span>
          <span>Formula</span>
          <span>Ativo</span>
          <span>Ordem</span>
          <span>Mapeamento Omie</span>
          <span>Acoes</span>
        </div>

        <div className="space-y-1">
          {visibleRows.map((account) => {
            const hasChildren = (byParent.get(account.id) ?? []).length > 0;
            const isEditing = editingId === account.id && draft !== null;
            const calculatedClass =
              account.type === "calculado"
                ? "border-blue-500/30 bg-blue-500/10"
                : "border-border bg-background";

            return (
              <div
                key={account.id}
                className={`grid grid-cols-[80px_1.8fr_130px_70px_1fr_80px_90px_170px_220px] items-center gap-2 rounded-md border p-2 text-sm ${calculatedClass}`}
              >
                <div className="font-medium">{account.code}</div>
                <div
                  className="flex items-center gap-2"
                  style={{ paddingLeft: `${(account.level - 1) * 14}px` }}
                >
                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={() => toggleExpanded(account.id)}
                      className="rounded p-0.5 hover:bg-muted"
                    >
                      {expandedIds[account.id] ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <span className="h-4 w-4" />
                  )}

                  {isEditing ? (
                    <Input
                      value={draft.name}
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous ? { ...previous, name: event.target.value } : previous,
                        )
                      }
                    />
                  ) : (
                    <span className="truncate">{account.name}</span>
                  )}
                </div>
                <div>
                  {isEditing ? (
                    <select
                      value={draft.type}
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                type: event.target.value as DreType,
                                is_summary:
                                  event.target.value === "calculado" ? true : previous.is_summary,
                              }
                            : previous,
                        )
                      }
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
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous ? { ...previous, formula: event.target.value } : previous,
                        )
                      }
                      disabled={draft.type !== "calculado"}
                      placeholder={draft.type === "calculado" ? "Ex: 8+9-10" : ""}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">{account.formula ?? "-"}</span>
                  )}
                </div>
                <div>
                  {isEditing ? (
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((previous) =>
                          previous ? { ...previous, active: !previous.active } : previous,
                        )
                      }
                      className="inline-flex items-center"
                    >
                      {draft.active ? (
                        <ToggleRight className="h-6 w-6 text-emerald-600" />
                      ) : (
                        <ToggleLeft className="h-6 w-6 text-muted-foreground" />
                      )}
                    </button>
                  ) : account.active ? (
                    "Sim"
                  ) : (
                    "Nao"
                  )}
                </div>
                <div>
                  {isEditing ? (
                    <Input
                      type="number"
                      value={draft.sort_order}
                      onChange={(event) =>
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                sort_order: Number(event.target.value || previous.sort_order),
                              }
                            : previous,
                        )
                      }
                    />
                  ) : (
                    account.sort_order
                  )}
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {account.mappings.length === 0
                    ? "-"
                    : account.mappings.map((mapping) => {
                        const mappingLabel = `${mapping.code} - ${mapping.name}`;
                        const isMappingRemoving = savingId === mapping.id;
                        return (
                          <div key={mapping.id} className="flex items-center justify-between gap-2 rounded border bg-background px-1 py-0.5">
                            <span className="truncate">{mappingLabel}</span>
                            <button
                              type="button"
                              className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-red-600 disabled:opacity-50"
                              onClick={() => void removeMapping(mapping.id, mappingLabel)}
                              disabled={isMappingRemoving}
                              title="Remover mapeamento"
                            >
                              {isMappingRemoving ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Unlink2 className="h-3 w-3" />
                              )}
                            </button>
                          </div>
                        );
                      })}
                </div>
                <div className="flex flex-wrap gap-1">
                  {isEditing ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveEdit(account.id)}
                      disabled={savingId === account.id}
                    >
                      {savingId === account.id ? (
                        <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-3 w-3" />
                      )}
                      Salvar
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="outline" onClick={() => startEdit(account)}>
                      <Pencil className="mr-2 h-3 w-3" />
                      Editar
                    </Button>
                  )}

                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void moveSibling(account, "up")}
                  >
                    <ChevronsUpDown className="mr-2 h-3 w-3 rotate-180" />
                    Subir
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => void moveSibling(account, "down")}
                  >
                    <ChevronsUpDown className="mr-2 h-3 w-3" />
                    Descer
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="destructive"
                    onClick={() => void removeAccount(account)}
                    disabled={savingId === account.id || hasChildren}
                    title={hasChildren ? "Conta agrupadora — possui subcontas." : undefined}
                  >
                    {savingId === account.id ? (
                      <Loader2 className="mr-2 h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-3 w-3" />
                    )}
                    Excluir
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Contas calculadas sao destacadas em azul e nao devem receber lancamentos diretos.
        </p>
        {message ? <p className="rounded-md border px-3 py-2 text-sm">{message}</p> : null}
      </CardContent>
    </Card>
  );
}
