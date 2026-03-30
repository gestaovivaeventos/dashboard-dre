"use client";

import { FormEvent, useMemo, useState } from "react";
import { KeyRound, Loader2, Plus, RefreshCcw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/toaster";

interface CompanyItem {
  id: string;
  name: string;
  active: boolean;
  created_at: string;
  has_credentials: boolean;
}

interface SettingsCompaniesProps {
  initialCompanies: CompanyItem[];
  segmentId: string | null;
}

async function safeJson<T>(response: Response): Promise<T | null> {
  const bodyText = await response.text();
  if (!bodyText) return null;
  try {
    return JSON.parse(bodyText) as T;
  } catch {
    return null;
  }
}

export function SettingsCompanies({ initialCompanies, segmentId }: SettingsCompaniesProps) {
  const { showToast } = useToast();
  const [companies, setCompanies] = useState(initialCompanies);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<Record<string, string | null>>({});
  const [form, setForm] = useState({
    name: "",
    appKey: "",
    appSecret: "",
  });

  // Credentials editing state
  const [editingCredentials, setEditingCredentials] = useState<string | null>(null);
  const [credForm, setCredForm] = useState({ appKey: "", appSecret: "" });
  const [savingCred, setSavingCred] = useState(false);

  const sortedCompanies = useMemo(
    () => [...companies].sort((a, b) => a.name.localeCompare(b.name)),
    [companies],
  );

  const refreshCompanies = async () => {
    setIsRefreshing(true);
    setStatusMessage(null);
    const params = segmentId ? `?segmentId=${segmentId}` : "";
    const response = await fetch(`/api/companies${params}`, { cache: "no-store" });
    const payload = await safeJson<{ companies?: CompanyItem[]; error?: string }>(response);
    if (!response.ok || !payload?.companies) {
      setStatusMessage(payload?.error ?? "Nao foi possivel atualizar lista de empresas.");
      showToast({
        title: "Falha ao atualizar empresas",
        description: payload?.error ?? "Nao foi possivel buscar a lista.",
        variant: "destructive",
      });
      setIsRefreshing(false);
      return;
    }
    setCompanies(payload.companies);
    setIsRefreshing(false);
  };

  const handleCreateCompany = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIsSaving(true);
    setStatusMessage(null);

    const response = await fetch("/api/companies", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ...form, segmentId }),
    });

    const payload = await safeJson<{ company?: CompanyItem; error?: string }>(response);
    if (!response.ok || !payload?.company) {
      setStatusMessage(payload?.error ?? "Erro ao criar empresa.");
      showToast({
        title: "Falha ao criar empresa",
        description: payload?.error ?? "Verifique os dados informados.",
        variant: "destructive",
      });
      setIsSaving(false);
      return;
    }

    const company = payload.company;
    setCompanies((previous) => [...previous, company]);
    setForm({ name: "", appKey: "", appSecret: "" });
    setIsModalOpen(false);
    setIsSaving(false);
    showToast({
      title: "Empresa criada",
      description: `${company.name} foi adicionada.`,
      variant: "success",
    });
  };

  const openCredentials = (companyId: string) => {
    if (editingCredentials === companyId) {
      setEditingCredentials(null);
      return;
    }
    setEditingCredentials(companyId);
    setCredForm({ appKey: "", appSecret: "" });
  };

  const saveCredentials = async (companyId: string) => {
    if (!credForm.appKey.trim() || !credForm.appSecret.trim()) {
      showToast({
        title: "Campos obrigatorios",
        description: "Preencha App Key e App Secret.",
        variant: "destructive",
      });
      return;
    }

    setSavingCred(true);
    const response = await fetch(`/api/companies/${companyId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        appKey: credForm.appKey.trim(),
        appSecret: credForm.appSecret.trim(),
      }),
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);

    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar credenciais",
        description: payload?.error ?? "Nao foi possivel atualizar.",
        variant: "destructive",
      });
      setSavingCred(false);
      return;
    }

    // Update local state
    setCompanies((prev) =>
      prev.map((c) =>
        c.id === companyId ? { ...c, has_credentials: true } : c,
      ),
    );
    setEditingCredentials(null);
    setCredForm({ appKey: "", appSecret: "" });
    setSavingCred(false);
    showToast({
      title: "Credenciais salvas",
      description: "App Key e App Secret atualizados com sucesso.",
      variant: "success",
    });
  };

  const runAction = async (companyId: string, type: "test" | "sync") => {
    setActionLoading((previous) => ({
      ...previous,
      [companyId]: type,
    }));
    setStatusMessage(null);

    const endpoint =
      type === "test" ? `/api/companies/${companyId}/test` : `/api/sync/${companyId}`;
    const response = await fetch(endpoint, {
      method: "POST",
    });
    const payload = await safeJson<{ error?: string; recordsImported?: number }>(response);

    if (!response.ok) {
      setStatusMessage(payload?.error ?? "A operacao falhou.");
      showToast({
        title: type === "sync" ? "Falha na sincronizacao" : "Falha no teste de conexao",
        description: payload?.error ?? "Nao foi possivel concluir a operacao.",
        variant: "destructive",
      });
    } else if (type === "sync") {
      showToast({
        title: "Sincronizacao concluida",
        description: `${payload?.recordsImported ?? 0} lancamentos importados.`,
        variant: "success",
      });
    } else {
      showToast({
        title: "Conexao validada",
        description: "Credenciais Omie estao corretas.",
        variant: "success",
      });
    }

    setActionLoading((previous) => ({
      ...previous,
      [companyId]: null,
    }));
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Configuracoes</h2>
          <p className="text-sm text-muted-foreground">
            Gerencie empresas, credenciais Omie e sincronizacao.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={refreshCompanies}
            disabled={isRefreshing}
          >
            {isRefreshing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Atualizar
          </Button>
          <Button type="button" onClick={() => setIsModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Adicionar Empresa
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Empresas</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {sortedCompanies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma empresa cadastrada.</p>
          ) : null}

          {sortedCompanies.map((company) => {
            const loadingAction = actionLoading[company.id];
            const isEditingCred = editingCredentials === company.id;

            return (
              <div key={company.id} className="rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{company.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Credenciais:{" "}
                      <span className={company.has_credentials ? "text-emerald-600" : "text-amber-600"}>
                        {company.has_credentials ? "configuradas" : "pendentes"}
                      </span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant={isEditingCred ? "default" : "outline"}
                      size="sm"
                      onClick={() => openCredentials(company.id)}
                    >
                      <KeyRound className="mr-2 h-4 w-4" />
                      Credenciais
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => runAction(company.id, "test")}
                      disabled={Boolean(loadingAction) || !company.has_credentials}
                    >
                      {loadingAction === "test" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <ShieldCheck className="mr-2 h-4 w-4" />
                      )}
                      Testar Conexao
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => runAction(company.id, "sync")}
                      disabled={Boolean(loadingAction) || !company.has_credentials}
                    >
                      {loadingAction === "sync" ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <RefreshCcw className="mr-2 h-4 w-4" />
                      )}
                      Sincronizar
                    </Button>
                  </div>
                </div>

                {/* Credentials form (expandable) */}
                {isEditingCred && (
                  <div className="mt-3 space-y-3 rounded-md border bg-muted/30 p-3">
                    <p className="text-xs font-medium text-muted-foreground">
                      {company.has_credentials
                        ? "Atualizar credenciais Omie (os valores atuais nao sao exibidos por seguranca)"
                        : "Configurar credenciais Omie"}
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        placeholder="Omie App Key"
                        value={credForm.appKey}
                        onChange={(e) =>
                          setCredForm((prev) => ({ ...prev, appKey: e.target.value }))
                        }
                      />
                      <Input
                        placeholder="Omie App Secret"
                        value={credForm.appSecret}
                        onChange={(e) =>
                          setCredForm((prev) => ({ ...prev, appSecret: e.target.value }))
                        }
                      />
                    </div>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setEditingCredentials(null)}
                        disabled={savingCred}
                      >
                        Cancelar
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void saveCredentials(company.id)}
                        disabled={savingCred || !credForm.appKey.trim() || !credForm.appSecret.trim()}
                      >
                        {savingCred ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                        Salvar Credenciais
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {statusMessage ? (
        <p className="rounded-md border bg-background px-3 py-2 text-sm">{statusMessage}</p>
      ) : null}

      {isModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <Card className="w-full max-w-lg">
            <CardHeader>
              <CardTitle>Adicionar Empresa</CardTitle>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleCreateCompany}>
                <Input
                  placeholder="Nome da empresa"
                  value={form.name}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, name: event.target.value }))
                  }
                  required
                />
                <Input
                  placeholder="Omie App Key (opcional)"
                  value={form.appKey}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, appKey: event.target.value }))
                  }
                />
                <Input
                  placeholder="Omie App Secret (opcional)"
                  value={form.appSecret}
                  onChange={(event) =>
                    setForm((previous) => ({ ...previous, appSecret: event.target.value }))
                  }
                />
                <Separator />
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isSaving}
                  >
                    Cancelar
                  </Button>
                  <Button type="submit" disabled={isSaving}>
                    {isSaving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                    Salvar
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
