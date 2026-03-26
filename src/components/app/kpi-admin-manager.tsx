"use client";

import { FormEvent, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";
import type { KpiDefinition, KpiFormulaType } from "@/lib/kpi/calc";

interface DreAccountOption {
  code: string;
  name: string;
}

interface KpiAdminManagerProps {
  initialKpis: KpiDefinition[];
  dreAccounts: DreAccountOption[];
}

export function KpiAdminManager({ initialKpis, dreAccounts }: KpiAdminManagerProps) {
  const { showToast } = useToast();
  const [kpis, setKpis] = useState(initialKpis);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "",
    description: "",
    formula_type: "value" as KpiFormulaType,
    numerator_account_codes: [] as string[],
    denominator_account_codes: [] as string[],
    multiply_by: 1,
    sort_order: 0,
    active: true,
  });

  const sortedAccounts = useMemo(
    () =>
      [...dreAccounts].sort((a, b) =>
        a.code.localeCompare(b.code, undefined, { numeric: true }),
      ),
    [dreAccounts],
  );

  const refresh = async () => {
    setLoading(true);
    const response = await fetch("/api/kpi-definitions", { cache: "no-store" });
    const payload = (await response.json()) as { kpis?: KpiDefinition[]; error?: string };
    if (!response.ok || !payload.kpis) {
      setMessage(payload.error ?? "Falha ao carregar KPIs.");
      showToast({
        title: "Falha ao carregar KPIs",
        description: payload.error ?? "Nao foi possivel atualizar a lista.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    setKpis(payload.kpis);
    setLoading(false);
  };

  const openNew = () => {
    setEditingId(null);
    setForm({
      name: "",
      description: "",
      formula_type: "value",
      numerator_account_codes: [],
      denominator_account_codes: [],
      multiply_by: 1,
      sort_order: 0,
      active: true,
    });
    setModalOpen(true);
  };

  const openEdit = (kpi: KpiDefinition) => {
    setEditingId(kpi.id);
    setForm({
      name: kpi.name,
      description: kpi.description ?? "",
      formula_type: kpi.formula_type,
      numerator_account_codes: kpi.numerator_account_codes ?? [],
      denominator_account_codes: kpi.denominator_account_codes ?? [],
      multiply_by: Number(kpi.multiply_by ?? 1),
      sort_order: kpi.sort_order ?? 0,
      active: kpi.active,
    });
    setModalOpen(true);
  };

  const toggleCode = (field: "numerator_account_codes" | "denominator_account_codes", code: string) => {
    setForm((previous) => {
      const has = previous[field].includes(code);
      return {
        ...previous,
        [field]: has ? previous[field].filter((item) => item !== code) : [...previous[field], code],
      };
    });
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setMessage(null);
    setLoading(true);

    const endpoint = editingId ? `/api/kpi-definitions/${editingId}` : "/api/kpi-definitions";
    const method = editingId ? "PATCH" : "POST";
    const response = await fetch(endpoint, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao salvar KPI.");
      showToast({
        title: "Falha ao salvar KPI",
        description: payload.error ?? "Verifique os campos e tente novamente.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    setModalOpen(false);
    setLoading(false);
    await refresh();
    setMessage("KPI salvo com sucesso.");
    showToast({
      title: "KPI salvo",
      description: "Alteracoes aplicadas com sucesso.",
      variant: "success",
    });
  };

  const remove = async (kpiId: string) => {
    if (!window.confirm("Excluir este KPI? Essa acao nao pode ser desfeita.")) {
      return;
    }
    setLoading(true);
    setMessage(null);
    const response = await fetch(`/api/kpi-definitions/${kpiId}`, { method: "DELETE" });
    const payload = (await response.json()) as { error?: string };
    if (!response.ok) {
      setMessage(payload.error ?? "Falha ao excluir KPI.");
      showToast({
        title: "Falha ao excluir KPI",
        description: payload.error ?? "Nao foi possivel remover o KPI.",
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    await refresh();
    setLoading(false);
    setMessage("KPI excluido.");
    showToast({
      title: "KPI excluido",
      description: "O KPI foi removido com sucesso.",
      variant: "success",
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>KPIs</CardTitle>
        <Button type="button" onClick={openNew}>
          <Plus className="mr-2 h-4 w-4" />
          Novo KPI
        </Button>
      </CardHeader>
      <CardContent className="space-y-2">
        {kpis.map((kpi) => (
          <div key={kpi.id} className="flex items-center justify-between rounded-md border p-3">
            <div>
              <p className="font-medium">{kpi.name}</p>
              <p className="text-xs text-muted-foreground">
                Tipo: {kpi.formula_type} | Numerador: {kpi.numerator_account_codes.join(", ")}
                {kpi.denominator_account_codes?.length
                  ? ` | Denominador: ${kpi.denominator_account_codes.join(", ")}`
                  : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => openEdit(kpi)}>
                <Pencil className="mr-2 h-3 w-3" />
                Editar
              </Button>
              <Button type="button" size="sm" variant="destructive" onClick={() => void remove(kpi.id)}>
                <Trash className="mr-2 h-3 w-3" />
                Excluir
              </Button>
            </div>
          </div>
        ))}

        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={refresh} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Atualizar
          </Button>
        </div>

        {message ? <p className="rounded-md border px-3 py-2 text-sm">{message}</p> : null}
      </CardContent>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-3xl">
            <CardHeader>
              <CardTitle>{editingId ? "Editar KPI" : "Novo KPI"}</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={save} className="space-y-4">
                <div className="grid gap-3 md:grid-cols-2">
                  <Input
                    placeholder="Nome"
                    value={form.name}
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                    required
                  />
                  <select
                    value={form.formula_type}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        formula_type: event.target.value as KpiFormulaType,
                        multiply_by: event.target.value === "value" ? 1 : prev.multiply_by,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="value">value</option>
                    <option value="percentage">percentage</option>
                    <option value="ratio">ratio</option>
                  </select>
                </div>

                <Input
                  placeholder="Descricao"
                  value={form.description}
                  onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                />

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-sm font-medium">Numerador (ordem importa)</p>
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {sortedAccounts.map((account) => (
                        <label key={`num-${account.code}`} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.numerator_account_codes.includes(account.code)}
                            onChange={() => toggleCode("numerator_account_codes", account.code)}
                          />
                          <span>
                            {account.code} - {account.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-md border p-3">
                    <p className="mb-2 text-sm font-medium">Denominador</p>
                    <div className="max-h-48 space-y-1 overflow-y-auto">
                      {sortedAccounts.map((account) => (
                        <label key={`den-${account.code}`} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={form.denominator_account_codes.includes(account.code)}
                            onChange={() => toggleCode("denominator_account_codes", account.code)}
                          />
                          <span>
                            {account.code} - {account.name}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <Input
                    type="number"
                    step="0.01"
                    placeholder="Multiplicador"
                    value={String(form.multiply_by)}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, multiply_by: Number(event.target.value || 1) }))
                    }
                  />
                  <Input
                    type="number"
                    placeholder="Sort order"
                    value={String(form.sort_order)}
                    onChange={(event) =>
                      setForm((prev) => ({ ...prev, sort_order: Number(event.target.value || 0) }))
                    }
                  />
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={form.active}
                      onChange={(event) => setForm((prev) => ({ ...prev, active: event.target.checked }))}
                    />
                    Ativo
                  </label>
                </div>

                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setModalOpen(false)}>
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={loading}>
                    {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Salvar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </Card>
  );
}
