"use client";

import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Loader2,
  Pencil,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Unlink2,
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
  mappings: Array<{
    id: string;
    code: string;
    name: string;
    company_id: string | null;
  }>;
}

interface CashFlowStructureManagerProps {
  initialAccounts: CashFlowAccountItem[];
}

export function CashFlowStructureManager({ initialAccounts }: CashFlowStructureManagerProps) {
  const { showToast } = useToast();
  const [accounts, setAccounts] = useState(initialAccounts);
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

  const refresh = async () => {
    setLoading(true);
    const response = await fetch("/api/cash-flow-accounts", { cache: "no-store" });
    const payload = (await response.json()) as { accounts?: CashFlowAccountItem[]; error?: string };
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
    setLoading(false);
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

  const saveEdit = async (accountId: string) => {
    if (!draft) return;
    setSavingId(accountId);

    const payload = {
      ...draft,
      formula: draft.formula.trim() || null,
      is_summary: draft.type === "calculado" ? true : draft.is_summary,
    };
    const response = await fetch(`/api/cash-flow-accounts/${accountId}`, {
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
    const siblings = [...(byParent.get(account.parent_id) ?? [])];
    const currentIndex = siblings.findIndex((item) => item.id === account.id);
    if (currentIndex < 0) return;
    const swapIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (swapIndex < 0 || swapIndex >= siblings.length) return;

    const current = siblings[currentIndex];
    const target = siblings[swapIndex];
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
    if (!window.confirm(`Excluir a conta ${account.code} - ${account.name}?`)) return;
    setSavingId(account.id);
    const response = await fetch(`/api/cash-flow-accounts/${account.id}`, { method: "DELETE" });
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

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle>Estrutura Fluxo de Caixa</CardTitle>
        <p className="text-xs text-muted-foreground">
          Linhas com origem especial (Resultado do Exercicio, Saldo Inicial/Final) nao recebem mapeamento — seu valor vem do DRE ou do calculo de caixa.
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Atualizar estrutura
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
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
                    <Button type="button" size="sm" onClick={() => void saveEdit(account.id)} disabled={savingId === account.id}>
                      {savingId === account.id ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : <Save className="mr-2 h-3 w-3" />}
                      Salvar
                    </Button>
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
                    disabled={savingId === account.id}
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
