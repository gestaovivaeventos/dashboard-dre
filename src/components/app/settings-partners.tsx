"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Save, Trash2, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

interface CompanyOption {
  id: string;
  name: string;
}

interface PartnerLink {
  id: string;
  supplier_customer: string;
}

interface PartnerItem {
  id: string;
  name: string;
  sort_order: number;
  links: PartnerLink[];
}

interface Candidate {
  supplier_customer: string;
  occurrences: number;
  total_value: number;
  last_payment_date: string | null;
}

interface SettingsPartnersProps {
  companies: CompanyOption[];
}

const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

async function safeJson<T>(response: Response): Promise<T | null> {
  const bodyText = await response.text();
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return null;
  }
}

export function SettingsPartners({ companies }: SettingsPartnersProps) {
  const { showToast } = useToast();

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const [selectedCompanyId, setSelectedCompanyId] = useState<string>(
    sortedCompanies[0]?.id ?? "",
  );
  const [partners, setPartners] = useState<PartnerItem[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState<"initial" | "saving" | null>("initial");
  const [newPartnerName, setNewPartnerName] = useState("");

  // Estado local de edicao por socio: nome digitado + set de supplier_customers
  // selecionados. Espelha o que esta no servidor e e descarregado a cada save.
  const [editByPartner, setEditByPartner] = useState<
    Record<string, { name: string; selected: Set<string>; dirty: boolean; savingKind: "name" | "links" | null }>
  >({});

  useEffect(() => {
    if (!selectedCompanyId) {
      setLoading(null);
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoading("initial");
      const [partnersRes, candidatesRes] = await Promise.all([
        fetch(`/api/companies/${selectedCompanyId}/partners`, { cache: "no-store" }),
        fetch(`/api/companies/${selectedCompanyId}/partners/candidates`, { cache: "no-store" }),
      ]);
      const partnersPayload = await safeJson<{ partners?: PartnerItem[]; error?: string }>(partnersRes);
      const candidatesPayload = await safeJson<{ candidates?: Candidate[]; error?: string }>(candidatesRes);
      if (cancelled) return;

      const nextPartners = partnersPayload?.partners ?? [];
      setPartners(nextPartners);
      setCandidates(candidatesPayload?.candidates ?? []);

      const nextEdit: typeof editByPartner = {};
      for (const p of nextPartners) {
        nextEdit[p.id] = {
          name: p.name,
          selected: new Set(p.links.map((l) => l.supplier_customer)),
          dirty: false,
          savingKind: null,
        };
      }
      setEditByPartner(nextEdit);
      setLoading(null);

      if (!partnersRes.ok && partnersPayload?.error) {
        showToast({ title: "Falha ao carregar socios", description: partnersPayload.error, variant: "destructive" });
      }
      if (!candidatesRes.ok && candidatesPayload?.error) {
        showToast({ title: "Falha ao carregar candidatos", description: candidatesPayload.error, variant: "destructive" });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [selectedCompanyId, showToast]);

  // Conjunto de nomes ja vinculados a OUTROS socios — usados para travar
  // multi-selecao do mesmo nome em dois socios (a constraint UNIQUE no
  // banco protege, mas evitamos o erro mostrando ja desabilitado).
  const claimedByOtherPartner = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const partner of partners) {
      for (const link of partner.links) {
        const set = map.get(link.supplier_customer) ?? new Set<string>();
        set.add(partner.id);
        map.set(link.supplier_customer, set);
      }
    }
    return map;
  }, [partners]);

  const handleAddPartner = async () => {
    const name = newPartnerName.trim();
    if (!name) {
      showToast({ title: "Informe o nome do socio.", variant: "destructive" });
      return;
    }
    setLoading("saving");
    const response = await fetch(`/api/companies/${selectedCompanyId}/partners`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await safeJson<{ partner?: PartnerItem; error?: string }>(response);
    setLoading(null);
    if (!response.ok || !payload?.partner) {
      showToast({
        title: "Falha ao adicionar socio",
        description: payload?.error ?? "Tente novamente.",
        variant: "destructive",
      });
      return;
    }
    const partner = payload.partner;
    setPartners((prev) => [...prev, partner]);
    setEditByPartner((prev) => ({
      ...prev,
      [partner.id]: { name: partner.name, selected: new Set(), dirty: false, savingKind: null },
    }));
    setNewPartnerName("");
    showToast({ title: "Socio adicionado", description: name, variant: "success" });
  };

  const handleDeletePartner = async (partnerId: string) => {
    if (!window.confirm("Remover este socio? Os vinculos com clientes/fornecedores tambem serao removidos.")) {
      return;
    }
    setLoading("saving");
    const response = await fetch(`/api/companies/${selectedCompanyId}/partners/${partnerId}`, {
      method: "DELETE",
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
    setLoading(null);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao remover",
        description: payload?.error ?? "Tente novamente.",
        variant: "destructive",
      });
      return;
    }
    setPartners((prev) => prev.filter((p) => p.id !== partnerId));
    setEditByPartner((prev) => {
      const next = { ...prev };
      delete next[partnerId];
      return next;
    });
    showToast({ title: "Socio removido", variant: "success" });
  };

  const updateEdit = (partnerId: string, patch: Partial<typeof editByPartner[string]>) => {
    setEditByPartner((prev) => ({
      ...prev,
      [partnerId]: { ...prev[partnerId], ...patch, dirty: true },
    }));
  };

  const setSavingKind = (partnerId: string, kind: "name" | "links" | null) => {
    setEditByPartner((prev) => ({
      ...prev,
      [partnerId]: { ...prev[partnerId], savingKind: kind },
    }));
  };

  const handleSaveName = async (partnerId: string) => {
    const state = editByPartner[partnerId];
    if (!state) return;
    const name = state.name.trim();
    if (!name) {
      showToast({ title: "Nome nao pode ficar vazio.", variant: "destructive" });
      return;
    }
    setSavingKind(partnerId, "name");
    const response = await fetch(`/api/companies/${selectedCompanyId}/partners/${partnerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
    setSavingKind(partnerId, null);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar nome",
        description: payload?.error ?? "Tente novamente.",
        variant: "destructive",
      });
      return;
    }
    setPartners((prev) => prev.map((p) => (p.id === partnerId ? { ...p, name } : p)));
    setEditByPartner((prev) => ({
      ...prev,
      [partnerId]: { ...prev[partnerId], name, dirty: false, savingKind: null },
    }));
    showToast({ title: "Nome atualizado", description: name, variant: "success" });
  };

  const handleSaveLinks = async (partnerId: string) => {
    const state = editByPartner[partnerId];
    if (!state) return;
    setSavingKind(partnerId, "links");
    const response = await fetch(
      `/api/companies/${selectedCompanyId}/partners/${partnerId}/links`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplier_customers: Array.from(state.selected) }),
      },
    );
    const payload = await safeJson<{
      ok?: boolean;
      links?: PartnerLink[];
      error?: string;
    }>(response);
    setSavingKind(partnerId, null);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar vinculos",
        description: payload?.error ?? "Tente novamente.",
        variant: "destructive",
      });
      return;
    }
    const newLinks = payload.links ?? [];
    setPartners((prev) =>
      prev.map((p) => (p.id === partnerId ? { ...p, links: newLinks } : p)),
    );
    setEditByPartner((prev) => ({
      ...prev,
      [partnerId]: {
        ...prev[partnerId],
        selected: new Set(newLinks.map((l) => l.supplier_customer)),
        dirty: false,
        savingKind: null,
      },
    }));
    showToast({
      title: "Vinculos salvos",
      description: `${newLinks.length} cliente(s)/fornecedor(es) vinculado(s).`,
      variant: "success",
    });
  };

  const toggleSupplierForPartner = (partnerId: string, supplier: string) => {
    const state = editByPartner[partnerId];
    if (!state) return;
    const next = new Set(state.selected);
    if (next.has(supplier)) {
      next.delete(supplier);
    } else {
      next.add(supplier);
    }
    updateEdit(partnerId, { selected: next });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Socios</h2>
        <p className="text-sm text-muted-foreground">
          Cadastre os socios de cada empresa e vincule os clientes/fornecedores
          da Omie que devem ser usados para detalhar &quot;Dividendos Pagos&quot; e
          &quot;Aumento de Capital&quot; no Fluxo de Caixa por socio.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empresa</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedCompanies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma empresa cadastrada neste grupo.
            </p>
          ) : (
            <select
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
              className="h-10 w-full max-w-md rounded-md border border-input bg-background px-3 text-sm"
              disabled={loading === "saving"}
            >
              {sortedCompanies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </CardContent>
      </Card>

      {selectedCompanyId ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4" />
              Socios cadastrados
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {loading === "initial" ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Carregando socios...
              </div>
            ) : (
              <>
                {partners.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Nenhum socio cadastrado ainda. Use o campo abaixo para
                    adicionar o primeiro.
                  </p>
                ) : null}

                {partners.map((partner) => {
                  const state = editByPartner[partner.id] ?? {
                    name: partner.name,
                    selected: new Set<string>(),
                    dirty: false,
                    savingKind: null,
                  };
                  const isSavingName = state.savingKind === "name";
                  const isSavingLinks = state.savingKind === "links";

                  return (
                    <div key={partner.id} className="rounded-lg border p-4 space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={state.name}
                          onChange={(e) =>
                            updateEdit(partner.id, { name: e.target.value })
                          }
                          placeholder="Nome do socio"
                          className="max-w-md"
                          disabled={isSavingName}
                        />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => void handleSaveName(partner.id)}
                          disabled={
                            isSavingName ||
                            state.name.trim() === partner.name ||
                            state.name.trim().length === 0
                          }
                        >
                          {isSavingName ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Save className="mr-2 h-4 w-4" />
                          )}
                          Salvar nome
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => void handleDeletePartner(partner.id)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remover
                        </Button>
                      </div>

                      <div className="rounded-md border bg-muted/30 p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <p className="text-xs font-medium text-muted-foreground">
                            Clientes/fornecedores vinculados a este socio
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => void handleSaveLinks(partner.id)}
                            disabled={isSavingLinks || !state.dirty}
                          >
                            {isSavingLinks ? (
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                              <Save className="mr-2 h-4 w-4" />
                            )}
                            Salvar vinculos
                          </Button>
                        </div>

                        {candidates.length === 0 ? (
                          <p className="text-sm text-muted-foreground">
                            Nenhum lancamento de Dividendos ou Aportes
                            encontrado nesta empresa ainda. Verifique se o
                            mapeamento de categorias Omie (Fluxo de Caixa) esta
                            preenchido para 4.2 e 5.1 e se a empresa ja foi
                            sincronizada.
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                            {candidates.map((candidate) => {
                              const claimingPartners = claimedByOtherPartner.get(
                                candidate.supplier_customer,
                              );
                              const claimedByOther = claimingPartners
                                ? Array.from(claimingPartners).some((id) => id !== partner.id)
                                : false;
                              const selected = state.selected.has(
                                candidate.supplier_customer,
                              );
                              return (
                                <label
                                  key={candidate.supplier_customer}
                                  className={`flex items-start gap-2 rounded-md border p-2 text-sm ${
                                    claimedByOther && !selected
                                      ? "opacity-50"
                                      : ""
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={selected}
                                    disabled={claimedByOther && !selected}
                                    onChange={() =>
                                      toggleSupplierForPartner(
                                        partner.id,
                                        candidate.supplier_customer,
                                      )
                                    }
                                    className="mt-0.5 h-4 w-4 rounded border-input"
                                  />
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium" title={candidate.supplier_customer}>
                                      {candidate.supplier_customer}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {candidate.occurrences} lancamento(s) •{" "}
                                      {currencyFormatter.format(candidate.total_value)}
                                      {claimedByOther ? " • ja vinculado a outro socio" : ""}
                                    </p>
                                  </div>
                                </label>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}

                <div className="rounded-lg border-2 border-dashed p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      value={newPartnerName}
                      onChange={(e) => setNewPartnerName(e.target.value)}
                      placeholder="Nome do novo socio"
                      className="max-w-md"
                      disabled={loading === "saving"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void handleAddPartner();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      onClick={() => void handleAddPartner()}
                      disabled={loading === "saving" || newPartnerName.trim().length === 0}
                    >
                      {loading === "saving" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Plus className="mr-2 h-4 w-4" />
                      )}
                      Adicionar socio
                    </Button>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
