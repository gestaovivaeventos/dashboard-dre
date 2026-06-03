"use client";

import { Loader2, RefreshCcw, Save, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

interface AccountOption {
  id: string;
  code: string;
  name: string;
}

interface CategoryItem {
  code: string;
  name: string;
  accountId: string | null;
}

interface Section {
  sourceCompanyId: string;
  sourceCompanyName: string;
  departmentCode: string;
  departmentName: string;
  categories: CategoryItem[];
}

interface RoutedDepartmentMappingProps {
  companyId: string;
  kind: "dre" | "cashflow";
  // Contas ja escopadas para a empresa de destino (mesma lista do mapeamento
  // proprio: plano custom da empresa ou global).
  accounts: AccountOption[];
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

const keyOf = (sourceCompanyId: string, departmentCode: string, categoryCode: string) =>
  `${sourceCompanyId}|${departmentCode}|${categoryCode}`;

export function RoutedDepartmentMapping({
  companyId,
  kind,
  accounts,
}: RoutedDepartmentMappingProps) {
  const { showToast } = useToast();
  const [sections, setSections] = useState<Section[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draftByKey, setDraftByKey] = useState<Record<string, string>>({});
  const [originalByKey, setOriginalByKey] = useState<Record<string, string>>({});

  const accountLabel = kind === "dre" ? "conta DRE" : "conta de Fluxo de Caixa";

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    const params = new URLSearchParams({ companyId, kind });
    const response = await fetch(
      `/api/routed-department-mapping?${params.toString()}`,
      { cache: "no-store" },
    );
    const payload = await safeJson<{ sections?: Section[]; error?: string }>(response);
    if (!response.ok || !payload?.sections) {
      // Sem departamentos roteados ainda é resposta válida (sections: []).
      if (response.ok) {
        setSections([]);
        setDraftByKey({});
        setOriginalByKey({});
      } else {
        showToast({
          title: "Falha ao carregar mapeamento roteado",
          description: payload?.error ?? "Tente novamente.",
          variant: "destructive",
        });
      }
      setLoading(false);
      return;
    }
    setSections(payload.sections);
    const snapshot: Record<string, string> = {};
    payload.sections.forEach((section) => {
      section.categories.forEach((cat) => {
        snapshot[keyOf(section.sourceCompanyId, section.departmentCode, cat.code)] =
          cat.accountId ?? "";
      });
    });
    setDraftByKey({ ...snapshot });
    setOriginalByKey(snapshot);
    setLoading(false);
  }, [companyId, kind, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  const changedKeys = useMemo(() => {
    const keys: string[] = [];
    for (const key of Object.keys(draftByKey)) {
      if (draftByKey[key] !== (originalByKey[key] ?? "")) keys.push(key);
    }
    return keys;
  }, [draftByKey, originalByKey]);

  const hasChanges = changedKeys.length > 0;

  const discardChanges = () => setDraftByKey({ ...originalByKey });

  const saveAll = async () => {
    if (!hasChanges) return;
    // Indexa categorias por chave para recuperar o nome ao salvar.
    const metaByKey = new Map<
      string,
      { sourceCompanyId: string; departmentCode: string; categoryCode: string; categoryName: string }
    >();
    sections.forEach((section) => {
      section.categories.forEach((cat) => {
        metaByKey.set(keyOf(section.sourceCompanyId, section.departmentCode, cat.code), {
          sourceCompanyId: section.sourceCompanyId,
          departmentCode: section.departmentCode,
          categoryCode: cat.code,
          categoryName: cat.name,
        });
      });
    });

    const items = changedKeys
      .map((key) => {
        const meta = metaByKey.get(key);
        if (!meta) return null;
        return { ...meta, accountId: draftByKey[key] || null };
      })
      .filter(Boolean);

    setSaving(true);
    const response = await fetch("/api/routed-department-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId, kind, items }),
    });
    const payload = await safeJson<{ ok?: boolean; saved?: number; cleared?: number; error?: string }>(
      response,
    );
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar mapeamento roteado",
        description: payload?.error ?? "Nao foi possivel salvar.",
        variant: "destructive",
      });
      setSaving(false);
      return;
    }
    await load();
    setSaving(false);
    showToast({
      title: "Mapeamento roteado salvo",
      description: `${payload.saved ?? 0} vinculado(s), ${payload.cleared ?? 0} removido(s).`,
      variant: "success",
    });
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin" />
          Carregando mapeamento de departamentos roteados...
        </CardContent>
      </Card>
    );
  }

  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold">Departamentos roteados de outras empresas</h3>
          <p className="text-xs text-muted-foreground">
            Categorias dos departamentos roteados para esta empresa. Deixe em
            branco para herdar o mapeamento automatico (mesma conta por codigo);
            selecione uma {accountLabel} para sobrescrever.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={saving}>
            <RefreshCcw className="mr-2 h-4 w-4" />
            Atualizar
          </Button>
          {hasChanges && (
            <>
              <Button type="button" variant="outline" size="sm" onClick={discardChanges} disabled={saving}>
                <Undo2 className="mr-2 h-4 w-4" />
                Descartar ({changedKeys.length})
              </Button>
              <Button type="button" size="sm" onClick={() => void saveAll()} disabled={saving}>
                {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Salvar ({changedKeys.length})
              </Button>
            </>
          )}
        </div>
      </div>

      {sections.map((section) => (
        <Card key={`${section.sourceCompanyId}-${section.departmentCode}`}>
          <CardHeader>
            <CardTitle className="text-sm">
              Mapeamento do departamento{" "}
              <span className="text-primary">{section.departmentName}</span> da empresa{" "}
              <span className="text-primary">{section.sourceCompanyName}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
                    <th className="whitespace-nowrap px-4 py-3 text-left">Codigo</th>
                    <th className="px-4 py-3 text-left">Descricao</th>
                    <th className="px-4 py-3 text-left">
                      {kind === "dre" ? "Conta DRE" : "Conta de Fluxo de Caixa"}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {section.categories.length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 text-center text-muted-foreground">
                        Nenhuma categoria com lancamentos neste departamento.
                      </td>
                    </tr>
                  ) : (
                    section.categories.map((cat) => {
                      const key = keyOf(section.sourceCompanyId, section.departmentCode, cat.code);
                      const draftValue = draftByKey[key] ?? "";
                      const isModified = draftValue !== (originalByKey[key] ?? "");
                      return (
                        <tr
                          key={key}
                          className={`border-b transition-colors hover:bg-muted/30 ${
                            isModified ? "bg-blue-50/60" : ""
                          }`}
                        >
                          <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium">
                            {cat.code}
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="line-clamp-1">{cat.name}</span>
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
                                setDraftByKey((prev) => ({ ...prev, [key]: e.target.value }))
                              }
                            >
                              <option value="">Herdar (mapeamento automatico)</option>
                              {accounts.map((account) => (
                                <option key={account.id} value={account.id}>
                                  {account.code} - {account.name}
                                </option>
                              ))}
                            </select>
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
      ))}
    </div>
  );
}
