"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, RefreshCcw, Search, Unlink2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toaster";

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
  const [companyId, setCompanyId] = useState(companies[0]?.id ?? "");
  const [rows, setRows] = useState<MappingRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingCode, setSavingCode] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [draftByCode, setDraftByCode] = useState<Record<string, string>>({});

  const loadRows = async () => {
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
    const nextDraft: Record<string, string> = {};
    payload.rows.forEach((row) => {
      nextDraft[row.code] = row.dreAccountId ?? "";
    });
    setDraftByCode(nextDraft);
    setLoading(false);
  };

  useEffect(() => {
    void loadRows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId]);

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

  const mappedCount = rows.filter((row) => row.dreAccountId).length;

  const saveMapping = async (row: MappingRow, clear = false) => {
    const selectedAccountId = clear ? null : draftByCode[row.code] || null;
    setSavingCode(row.code);
    const response = await fetch("/api/category-mapping", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyId,
        omieCategoryCode: row.code,
        omieCategoryName: row.description,
        dreAccountId: selectedAccountId,
      }),
    });
    const payload = await safeJson<{ ok?: boolean; error?: string }>(response);
    if (!response.ok || !payload?.ok) {
      showToast({
        title: "Falha ao salvar mapeamento",
        description: payload?.error ?? "Nao foi possivel salvar o vinculo.",
        variant: "destructive",
      });
      setSavingCode(null);
      return;
    }

    await loadRows();
    setSavingCode(null);
    showToast({
      title: clear ? "Mapeamento removido" : "Mapeamento salvo",
      description: `${row.code} atualizado com sucesso.`,
      variant: "success",
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Mapeamento OMIE x DRE</h2>
        <p className="text-sm text-muted-foreground">
          Vincule cada categoria Omie a uma conta do DRE.
        </p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <select
                className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                value={companyId}
                onChange={(event) => setCompanyId(event.target.value)}
              >
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadRows()} disabled={loading}>
                {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCcw className="mr-2 h-4 w-4" />}
                Atualizar
              </Button>
            </div>

            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  className="pl-9 w-64"
                  placeholder="Buscar categoria ou conta DRE"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {mappedCount}/{rows.length} mapeadas
              </span>
            </div>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-xs font-semibold uppercase text-muted-foreground">
                  <th className="whitespace-nowrap px-4 py-3 text-left">Codigo</th>
                  <th className="px-4 py-3 text-left">Descricao</th>
                  <th className="px-4 py-3 text-left">Conta DRE</th>
                  <th className="px-4 py-3 text-right">Acoes</th>
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
                    const isMapped = !!row.dreAccountId;
                    return (
                      <tr
                        key={row.code}
                        className={`border-b transition-colors hover:bg-muted/30 ${isMapped ? "" : "bg-amber-50/40"}`}
                      >
                        <td className="whitespace-nowrap px-4 py-2.5 font-mono font-medium">
                          {row.code}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="line-clamp-1">{row.description}</span>
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            className="h-9 w-full min-w-[220px] rounded-md border border-input bg-background px-2 text-sm"
                            value={draftByCode[row.code] ?? ""}
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
                        <td className="whitespace-nowrap px-4 py-2.5 text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Button
                              type="button"
                              size="sm"
                              onClick={() => void saveMapping(row)}
                              disabled={savingCode === row.code || !draftByCode[row.code]}
                            >
                              {savingCode === row.code ? (
                                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Check className="mr-1.5 h-3.5 w-3.5" />
                              )}
                              Salvar
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => void saveMapping(row, true)}
                              disabled={savingCode === row.code || !row.dreAccountId}
                            >
                              <Unlink2 className="mr-1.5 h-3.5 w-3.5" />
                              Limpar
                            </Button>
                          </div>
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
    </div>
  );
}
