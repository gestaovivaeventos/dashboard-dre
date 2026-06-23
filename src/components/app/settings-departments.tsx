"use client";

import { useMemo, useState } from "react";
import { Loader2, RefreshCcw, Save } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

interface DepartmentItem {
  id: string;
  omie_code: string;
  name: string;
  included: boolean;
  synced_at: string | null;
  routed_to_company_id: string | null;
}

interface CompanyWithDepartments {
  id: string;
  name: string;
  active: boolean;
  has_credentials: boolean;
  has_department_apportionment: boolean;
  departments: DepartmentItem[];
}

interface CompanyOption {
  id: string;
  name: string;
}

interface SettingsDepartmentsProps {
  companies: CompanyWithDepartments[];
  // Todas as empresas do sistema (cross-segment) — destinos possiveis de
  // roteamento de um departamento.
  allCompanies: CompanyOption[];
}

const NONE_CODE = "__none__";

async function safeJson<T>(response: Response): Promise<T | null> {
  const bodyText = await response.text();
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return null;
  }
}

interface CompanyEditState {
  hasFlag: boolean;
  // codigos selecionados (incluindo possivelmente "__none__")
  selected: Set<string>;
  // codigo do departamento -> empresa de destino do roteamento
  routing: Map<string, string>;
  departments: DepartmentItem[];
  syncedOnce: boolean;
}

function buildInitialState(company: CompanyWithDepartments): CompanyEditState {
  const selected = new Set<string>();
  const routing = new Map<string, string>();
  for (const d of company.departments) {
    if (d.included) selected.add(d.omie_code);
    if (d.routed_to_company_id) routing.set(d.omie_code, d.routed_to_company_id);
  }
  return {
    hasFlag: company.has_department_apportionment,
    selected,
    routing,
    departments: company.departments,
    syncedOnce: company.departments.length > 0,
  };
}

export function SettingsDepartments({ companies, allCompanies }: SettingsDepartmentsProps) {
  const { showToast } = useToast();

  const [stateByCompany, setStateByCompany] = useState<Record<string, CompanyEditState>>(
    () =>
      Object.fromEntries(companies.map((c) => [c.id, buildInitialState(c)])),
  );
  const [loadingByCompany, setLoadingByCompany] = useState<Record<string, "fetch" | "save" | null>>({});

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const setLoading = (companyId: string, kind: "fetch" | "save" | null) => {
    setLoadingByCompany((prev) => ({ ...prev, [companyId]: kind }));
  };

  const updateState = (companyId: string, patch: Partial<CompanyEditState>) => {
    setStateByCompany((prev) => ({
      ...prev,
      [companyId]: { ...prev[companyId], ...patch },
    }));
  };

  const refreshDepartments = async (companyId: string) => {
    setLoading(companyId, "fetch");
    const response = await fetch(
      `/api/companies/${companyId}/departments?refresh=1`,
      { cache: "no-store" },
    );
    const payload = await safeJson<{
      has_department_apportionment?: boolean;
      departments?: DepartmentItem[];
      error?: string;
    }>(response);
    if (!response.ok || !payload?.departments) {
      showToast({
        title: "Falha ao buscar departamentos",
        description: payload?.error ?? "Verifique as credenciais Omie da empresa.",
        variant: "destructive",
      });
      setLoading(companyId, null);
      return;
    }

    const selected = new Set<string>();
    const routing = new Map<string, string>();
    for (const d of payload.departments) {
      if (d.included) selected.add(d.omie_code);
      if (d.routed_to_company_id) routing.set(d.omie_code, d.routed_to_company_id);
    }
    updateState(companyId, {
      hasFlag: Boolean(payload.has_department_apportionment),
      selected,
      routing,
      departments: payload.departments,
      syncedOnce: true,
    });
    setLoading(companyId, null);
    showToast({
      title: "Departamentos atualizados",
      description: `${payload.departments.length} departamento(s) sincronizados.`,
      variant: "success",
    });
  };

  const handleFlagChange = async (companyId: string, value: "sim" | "nao") => {
    const desiredFlag = value === "sim";
    const current = stateByCompany[companyId];
    if (!current) return;

    // Se o usuario marcar Sim e ainda nao temos departamentos sincronizados,
    // dispara automaticamente o refresh para popular a lista.
    if (desiredFlag && !current.syncedOnce) {
      updateState(companyId, { hasFlag: desiredFlag });
      await refreshDepartments(companyId);
      return;
    }

    updateState(companyId, { hasFlag: desiredFlag });
  };

  const handleToggleCode = (companyId: string, code: string) => {
    setStateByCompany((prev) => {
      const current = prev[companyId];
      if (!current) return prev;
      const next = new Set(current.selected);
      if (next.has(code)) {
        next.delete(code);
      } else {
        next.add(code);
      }
      return { ...prev, [companyId]: { ...current, selected: next } };
    });
  };

  // Define (ou limpa, quando target === "") a empresa de destino do roteamento
  // de um departamento. Departamento roteado entra forcado na selecao (included).
  const handleRoutingChange = (companyId: string, code: string, target: string) => {
    setStateByCompany((prev) => {
      const current = prev[companyId];
      if (!current) return prev;
      const routing = new Map(current.routing);
      const selected = new Set(current.selected);
      if (target) {
        routing.set(code, target);
        selected.add(code);
      } else {
        routing.delete(code);
      }
      return { ...prev, [companyId]: { ...current, routing, selected } };
    });
  };

  const saveCompany = async (companyId: string) => {
    const current = stateByCompany[companyId];
    if (!current) return;

    setLoading(companyId, "save");
    const includedCodes = current.hasFlag ? Array.from(current.selected) : [];
    // Com rateio: envia os destinos por departamento. Sem rateio: so faz
    // sentido a rota "todos os lancamentos" (mapeada no pseudo __none__), que
    // cobre os lancamentos sem departamento vinculado.
    const routing = current.hasFlag
      ? Object.fromEntries(current.routing)
      : (() => {
          const allTarget = current.routing.get(NONE_CODE);
          return allTarget ? { [NONE_CODE]: allTarget } : {};
        })();
    const response = await fetch(`/api/companies/${companyId}/departments`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        has_department_apportionment: current.hasFlag,
        included_codes: includedCodes,
        routing,
      }),
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar",
        description: payload?.error ?? "Nao foi possivel atualizar a configuracao.",
        variant: "destructive",
      });
      setLoading(companyId, null);
      return;
    }

    // Reflete localmente: atualiza `included` e o destino de roteamento.
    const nextDepts = current.departments.map((d) => ({
      ...d,
      included: current.hasFlag && current.selected.has(d.omie_code),
      routed_to_company_id: current.routing.get(d.omie_code) ?? null,
    }));
    updateState(companyId, { departments: nextDepts });
    setLoading(companyId, null);
    const allTarget = current.routing.get(NONE_CODE);
    showToast({
      title: "Configuracao salva",
      description: current.hasFlag
        ? `${includedCodes.length} departamento(s) selecionado(s) para a DRE.`
        : allTarget
          ? "Todos os lancamentos desta empresa serao roteados para a empresa selecionada."
          : "Filtro por departamento desativado.",
      variant: "success",
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Departamentos</h2>
        <p className="text-sm text-muted-foreground">
          Configure por empresa se ha rateio por departamento na Omie e
          selecione quais departamentos devem entrar na DRE.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empresas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedCompanies.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma empresa cadastrada neste grupo.
            </p>
          ) : null}

          {sortedCompanies.map((company) => {
            const state = stateByCompany[company.id];
            if (!state) return null;
            const loading = loadingByCompany[company.id] ?? null;

            // Garante que a sentinela "__none__" sempre apareca quando ja
            // sincronizamos pelo menos uma vez. Quando ainda nao houve sync,
            // a lista vem vazia e exibimos um aviso para o usuario.
            const hasNoneRow = state.departments.some(
              (d) => d.omie_code === NONE_CODE,
            );
            const departmentsDisplay = hasNoneRow
              ? state.departments
              : state.syncedOnce
                ? [
                    ...state.departments,
                    {
                      id: `${company.id}-none-virtual`,
                      omie_code: NONE_CODE,
                      name: "Sem departamento vinculado",
                      included: state.selected.has(NONE_CODE),
                      synced_at: null,
                      routed_to_company_id: null,
                    },
                  ]
                : [];

            return (
              <div key={company.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex-1 min-w-[16rem]">
                    <p className="font-medium">{company.name}</p>
                    {!company.has_credentials ? (
                      <p className="text-xs text-amber-600">
                        Configure as credenciais Omie antes de buscar departamentos.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        Possui rateio por departamento?
                      </span>
                      <select
                        value={state.hasFlag ? "sim" : "nao"}
                        onChange={(e) =>
                          handleFlagChange(
                            company.id,
                            e.target.value as "sim" | "nao",
                          )
                        }
                        className="rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        disabled={loading !== null || !company.has_credentials}
                      >
                        <option value="nao">Nao</option>
                        <option value="sim">Sim</option>
                      </select>
                    </label>

                    {state.hasFlag ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void refreshDepartments(company.id)}
                        disabled={loading !== null || !company.has_credentials}
                      >
                        {loading === "fetch" ? (
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        ) : (
                          <RefreshCcw className="mr-2 h-4 w-4" />
                        )}
                        Atualizar lista Omie
                      </Button>
                    ) : null}

                    <Button
                      type="button"
                      size="sm"
                      onClick={() => void saveCompany(company.id)}
                      disabled={loading !== null}
                    >
                      {loading === "save" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Save className="mr-2 h-4 w-4" />
                      )}
                      Salvar
                    </Button>
                  </div>
                </div>

                {state.hasFlag ? (
                  <div className="mt-3 rounded-md border bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Departamentos a incluir na DRE — apenas lancamentos
                      vinculados a um dos departamentos selecionados (ou ao
                      pseudo &quot;Sem departamento vinculado&quot;, se marcado) entrarao
                      no Dashboard. Em &quot;Enviar para&quot;, escolha outra empresa para
                      rotear os lancamentos daquele departamento para a DRE e o
                      Fluxo de Caixa dela (eles somem desta empresa).
                    </p>
                    {departmentsDisplay.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhum departamento sincronizado ainda. Clique em
                        &quot;Atualizar lista Omie&quot; para buscar.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {departmentsDisplay.map((d) => {
                          const routedTarget = state.routing.get(d.omie_code) ?? "";
                          const isRouted = routedTarget !== "";
                          const canRoute = d.omie_code !== NONE_CODE;
                          return (
                            <div
                              key={d.id}
                              className="flex flex-wrap items-center gap-2 text-sm"
                            >
                              <label className="flex min-w-[14rem] flex-1 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={state.selected.has(d.omie_code)}
                                  onChange={() =>
                                    handleToggleCode(company.id, d.omie_code)
                                  }
                                  disabled={loading !== null || isRouted}
                                  className="h-4 w-4 rounded border-input"
                                />
                                <span>
                                  {d.omie_code === NONE_CODE
                                    ? "Sem departamento vinculado"
                                    : d.name}
                                  {d.omie_code !== NONE_CODE ? (
                                    <span className="ml-1 text-xs text-muted-foreground">
                                      ({d.omie_code})
                                    </span>
                                  ) : null}
                                </span>
                              </label>

                              {canRoute ? (
                                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <span>Enviar para</span>
                                  <select
                                    value={routedTarget}
                                    onChange={(e) =>
                                      handleRoutingChange(
                                        company.id,
                                        d.omie_code,
                                        e.target.value,
                                      )
                                    }
                                    disabled={loading !== null}
                                    className="rounded-md border border-input bg-background px-2 py-1 text-xs"
                                  >
                                    <option value="">Esta empresa</option>
                                    {allCompanies
                                      .filter((c) => c.id !== company.id)
                                      .map((c) => (
                                        <option key={c.id} value={c.id}>
                                          {c.name}
                                        </option>
                                      ))}
                                  </select>
                                </label>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                {!state.hasFlag ? (
                  <div className="mt-3 rounded-md border bg-muted/30 p-3">
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      Sem rateio por departamento, todos os lancamentos desta
                      empresa entram na DRE/Fluxo dela. Se quiser, envie TODOS os
                      lancamentos para outra empresa (&quot;Todos os
                      departamentos&quot;): eles passam a compor a DRE, o Fluxo de
                      Caixa e tudo mais da empresa escolhida (e somem desta).
                    </p>
                    <label className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground">
                        Enviar todos os lancamentos para
                      </span>
                      <select
                        value={state.routing.get(NONE_CODE) ?? ""}
                        onChange={(e) =>
                          handleRoutingChange(company.id, NONE_CODE, e.target.value)
                        }
                        disabled={loading !== null}
                        className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      >
                        <option value="">Esta empresa (nao rotear)</option>
                        {allCompanies
                          .filter((c) => c.id !== company.id)
                          .map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Clique em Salvar para aplicar. A mudanca recalcula a DRE e o
                      Fluxo das empresas envolvidas.
                    </p>
                  </div>
                ) : null}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
