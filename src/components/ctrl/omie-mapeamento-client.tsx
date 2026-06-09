"use client";

import { useState, useTransition, useCallback } from "react";
import { RefreshCw } from "lucide-react";

import {
  syncOmieOptions,
  getOmieMappingData,
  saveExpenseTypeCategoria,
  saveSectorDepartamento,
  saveContaCorrente,
  type OmieMappingData,
} from "@/lib/ctrl/actions/omie-mapping";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";

const BTN_PRIMARY =
  "inline-flex items-center gap-1.5 rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors";


interface Props {
  companies: { id: string; name: string }[];
}

type SaveFeedback = { id: string; ok: boolean; msg: string };

export function OmieMapeamentoClient({ companies }: Props) {
  const [companyId, setCompanyId] = useState("");
  const [data, setData] = useState<OmieMappingData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncFeedback, setSyncFeedback] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saveFeedback, setSaveFeedback] = useState<SaveFeedback | null>(null);
  const [isPending, startTransition] = useTransition();

  const loadData = useCallback(
    (cid: string) => {
      setData(null);
      setLoadError(null);
      setSyncFeedback(null);
      setSaveFeedback(null);
      startTransition(async () => {
        const res = await getOmieMappingData(cid);
        if ("error" in res) {
          setLoadError(res.error);
        } else {
          setData(res);
        }
      });
    },
    [],
  );

  function handleCompanyChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const cid = e.target.value;
    setCompanyId(cid);
    if (cid) loadData(cid);
    else {
      setData(null);
      setLoadError(null);
    }
  }

  function handleSync() {
    if (!companyId) return;
    setSyncFeedback(null);
    startTransition(async () => {
      const res = await syncOmieOptions(companyId);
      if ("error" in res) {
        setSyncFeedback({ ok: false, msg: res.error });
      } else {
        setSyncFeedback({
          ok: true,
          msg: `Sincronizado: ${res.counts.categoria} categorias, ${res.counts.departamento} departamentos, ${res.counts.conta_corrente} contas.`,
        });
        loadData(companyId);
      }
    });
  }

  function handleContaCorrente(codigo: string) {
    if (!companyId || !data) return;
    const prev = data.contaCorrente;
    setData({ ...data, contaCorrente: codigo || null });
    startTransition(async () => {
      const res = await saveContaCorrente(companyId, codigo || null);
      if ("error" in res) {
        setData({ ...data, contaCorrente: prev });
        setSaveFeedback({ id: "cc", ok: false, msg: res.error });
      } else {
        setSaveFeedback({ id: "cc", ok: true, msg: "Salvo" });
        setTimeout(() => setSaveFeedback((f) => (f?.id === "cc" ? null : f)), 2000);
      }
    });
  }

  function handleExpenseMap(expenseTypeId: string, codigo: string) {
    if (!companyId || !data) return;
    const prev = data.expenseMap[expenseTypeId] ?? "";
    const next = { ...data.expenseMap };
    if (codigo) next[expenseTypeId] = codigo;
    else delete next[expenseTypeId];
    setData({ ...data, expenseMap: next });
    startTransition(async () => {
      const res = await saveExpenseTypeCategoria(companyId, expenseTypeId, codigo || null);
      if ("error" in res) {
        const revert = { ...data.expenseMap };
        if (prev) revert[expenseTypeId] = prev;
        else delete revert[expenseTypeId];
        setData({ ...data, expenseMap: revert });
        setSaveFeedback({ id: expenseTypeId, ok: false, msg: res.error });
      } else {
        setSaveFeedback({ id: expenseTypeId, ok: true, msg: "Salvo" });
        setTimeout(() => setSaveFeedback((f) => (f?.id === expenseTypeId ? null : f)), 2000);
      }
    });
  }

  function handleSectorMap(sectorId: string, codigo: string) {
    if (!companyId || !data) return;
    const prev = data.sectorMap[sectorId] ?? "";
    const next = { ...data.sectorMap };
    if (codigo) next[sectorId] = codigo;
    else delete next[sectorId];
    setData({ ...data, sectorMap: next });
    startTransition(async () => {
      const res = await saveSectorDepartamento(companyId, sectorId, codigo || null);
      if ("error" in res) {
        const revert = { ...data.sectorMap };
        if (prev) revert[sectorId] = prev;
        else delete revert[sectorId];
        setData({ ...data, sectorMap: revert });
        setSaveFeedback({ id: sectorId, ok: false, msg: res.error });
      } else {
        setSaveFeedback({ id: sectorId, ok: true, msg: "Salvo" });
        setTimeout(() => setSaveFeedback((f) => (f?.id === sectorId ? null : f)), 2000);
      }
    });
  }

  const isEmpty =
    data &&
    data.categorias.length === 0 &&
    data.departamentos.length === 0 &&
    data.contasCorrentes.length === 0;

  const expenseMapped = data
    ? data.expenseTypes.filter((et) => data.expenseMap[et.id]).length
    : 0;
  const sectorMapped = data
    ? data.sectors.filter((s) => data.sectorMap[s.id]).length
    : 0;

  // OmieCash auto-suggestion: find conta whose descricao contains "omiecash" / "omie cash"
  const suggestedCc = data?.contasCorrentes.find((c) =>
    /omie\s?cash/i.test(c.descricao),
  );

  return (
    <div className="space-y-6">
      {/* Company selector */}
      <div className="flex items-center gap-3">
        <label className="shrink-0 text-sm font-medium">Empresa</label>
        <select
          value={companyId}
          onChange={handleCompanyChange}
          disabled={isPending}
          className={INPUT_CLS + " max-w-xs"}
        >
          <option value="">Selecione a empresa</option>
          {companies.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {isPending && !data && (
          <span className="text-xs text-muted-foreground">Carregando...</span>
        )}
      </div>

      {!companyId && (
        <p className="text-sm text-muted-foreground">
          Selecione uma empresa para configurar o mapeamento.
        </p>
      )}

      {loadError && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {loadError}
        </div>
      )}

      {companyId && data && (
        <div className="space-y-8">
          {/* Header: sync info + button */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/20 px-4 py-3">
            <p className="text-sm text-muted-foreground">
              {data.lastSyncedAt
                ? `Opções sincronizadas em ${new Date(data.lastSyncedAt).toLocaleString("pt-BR")}`
                : "Nunca sincronizado"}
            </p>
            <div className="flex items-center gap-3">
              {syncFeedback && (
                <span
                  className={`text-xs font-medium ${syncFeedback.ok ? "text-green-700" : "text-destructive"}`}
                >
                  {syncFeedback.msg}
                </span>
              )}
              <button
                onClick={handleSync}
                disabled={isPending}
                className={BTN_PRIMARY}
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
                {isPending ? "Aguarde..." : "Sincronizar opções do Omie"}
              </button>
            </div>
          </div>

          {isEmpty && (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Nenhuma opção carregada. Clique em{" "}
              <span className="font-medium">Sincronizar opções do Omie</span>.
            </div>
          )}

          {!isEmpty && (
            <>
              {/* ── Conta OmieCash ───────────────────────────────────── */}
              <section className="space-y-3">
                <h2 className="text-base font-semibold">Conta OmieCash</h2>
                <div className="flex items-center gap-3">
                  <select
                    value={data.contaCorrente ?? suggestedCc?.codigo ?? ""}
                    onChange={(e) => handleContaCorrente(e.target.value)}
                    disabled={isPending}
                    className={INPUT_CLS + " max-w-sm"}
                  >
                    <option value="">— não mapeado —</option>
                    {data.contasCorrentes.map((cc) => (
                      <option key={cc.codigo} value={cc.codigo}>
                        {cc.descricao}
                      </option>
                    ))}
                  </select>
                  {saveFeedback?.id === "cc" && (
                    <span
                      className={`text-xs font-medium ${saveFeedback.ok ? "text-green-700" : "text-destructive"}`}
                    >
                      {saveFeedback.msg}
                    </span>
                  )}
                </div>
              </section>

              {/* ── Tipos de despesa → Categoria ─────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-base font-semibold">
                    Tipos de despesa → Categoria Omie
                  </h2>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">
                    {expenseMapped}/{data.expenseTypes.length} mapeados
                  </span>
                </div>

                {data.expenseTypes.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum tipo de despesa cadastrado.</p>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {data.expenseTypes.map((et) => (
                      <div
                        key={et.id}
                        className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                      >
                        <span className="w-48 shrink-0 text-sm font-medium">{et.name}</span>
                        <select
                          value={data.expenseMap[et.id] ?? ""}
                          onChange={(e) => handleExpenseMap(et.id, e.target.value)}
                          disabled={isPending}
                          className={INPUT_CLS + " flex-1"}
                        >
                          <option value="">— não mapeado —</option>
                          {data.categorias.map((c) => (
                            <option key={c.codigo} value={c.codigo}>
                              {c.descricao}
                            </option>
                          ))}
                        </select>
                        {saveFeedback?.id === et.id && (
                          <span
                            className={`shrink-0 text-xs font-medium ${saveFeedback.ok ? "text-green-700" : "text-destructive"}`}
                          >
                            {saveFeedback.msg}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* ── Setores → Departamento ───────────────────────────── */}
              <section className="space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <h2 className="text-base font-semibold">
                    Setores → Departamento Omie
                  </h2>
                  <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold">
                    {sectorMapped}/{data.sectors.length} mapeados
                  </span>
                </div>

                {data.sectors.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum setor cadastrado.</p>
                ) : (
                  <div className="rounded-lg border divide-y">
                    {data.sectors.map((sec) => (
                      <div
                        key={sec.id}
                        className="flex flex-wrap items-center gap-3 px-4 py-2.5"
                      >
                        <span className="w-48 shrink-0 text-sm font-medium">{sec.name}</span>
                        <select
                          value={data.sectorMap[sec.id] ?? ""}
                          onChange={(e) => handleSectorMap(sec.id, e.target.value)}
                          disabled={isPending}
                          className={INPUT_CLS + " flex-1"}
                        >
                          <option value="">— não mapeado —</option>
                          {data.departamentos.map((d) => (
                            <option key={d.codigo} value={d.codigo}>
                              {d.descricao}
                            </option>
                          ))}
                        </select>
                        {saveFeedback?.id === sec.id && (
                          <span
                            className={`shrink-0 text-xs font-medium ${saveFeedback.ok ? "text-green-700" : "text-destructive"}`}
                          >
                            {saveFeedback.msg}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      )}
    </div>
  );
}
