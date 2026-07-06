"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw, Check } from "lucide-react";

import { syncOmieOptions, syncCaseCadastros, syncCasePagamentos, saveOmieConfig, type CaseOmieConfigData } from "@/lib/case/actions/omie-config";

const INPUT_CLS =
  "h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-amber-500/40";
const LABEL_CLS = "block text-xs font-medium text-ink-secondary mb-1";

export function OmieConfigForm({ initial }: { initial: CaseOmieConfigData }) {
  const router = useRouter();
  const [, startTransition] = useTransition();

  const [custodia, setCustodia] = useState(initial.config.codigo_categoria_custodia ?? "");
  const [servicos, setServicos] = useState(initial.config.codigo_categoria_servicos ?? "");
  const [conta, setConta] = useState(initial.config.codigo_conta_corrente ?? "");

  const [syncing, setSyncing] = useState(false);
  const [syncingCad, setSyncingCad] = useState(false);
  const [syncingPag, setSyncingPag] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function handleSync() {
    setSyncing(true);
    setErr(null);
    setMsg(null);
    const res = await syncOmieOptions();
    setSyncing(false);
    if ("error" in res) {
      setErr(res.error);
      return;
    }
    setMsg(`Sincronizado: ${res.categorias} categorias, ${res.contas} contas correntes.`);
    startTransition(() => router.refresh());
  }

  async function handleSyncCadastros() {
    setSyncingCad(true);
    setErr(null);
    setMsg(null);
    const res = await syncCaseCadastros();
    setSyncingCad(false);
    if ("error" in res) {
      setErr(res.error);
      return;
    }
    if (res.skipped) {
      setErr(res.skipped);
      return;
    }
    setMsg(
      `Cadastros sincronizados do Omie: ${res.fetched} lidos · clientes +${res.clientsInserted}/~${res.clientsUpdated} · artistas +${res.bandsInserted}/~${res.bandsUpdated}.`,
    );
    startTransition(() => router.refresh());
  }

  async function handleSyncPagamentos() {
    setSyncingPag(true);
    setErr(null);
    setMsg(null);
    const res = await syncCasePagamentos();
    setSyncingPag(false);
    if ("error" in res) {
      setErr(res.error);
      return;
    }
    if (res.skipped) {
      setErr(res.skipped);
      return;
    }
    setMsg(`Status de pagamento atualizado: ${res.atualizados} título(s) alterado(s), ${res.pagos} marcado(s) como pago.`);
    startTransition(() => router.refresh());
  }

  async function handleSave() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    const res = await saveOmieConfig({
      codigo_categoria_custodia: custodia || null,
      codigo_categoria_servicos: servicos || null,
      codigo_conta_corrente: conta || null,
    });
    setSaving(false);
    if ("error" in res) {
      setErr(res.error);
      return;
    }
    setMsg("Configuração salva.");
    startTransition(() => router.refresh());
  }

  const noOptions = initial.categorias.length === 0 && initial.contasCorrentes.length === 0;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 p-4">
        <div>
          <div className="text-sm font-medium text-ink-primary">Opções do Omie</div>
          <div className="text-xs text-ink-muted">
            {noOptions
              ? "Nenhuma opção em cache. Sincronize do Omie primeiro."
              : `${initial.categorias.length} categorias · ${initial.contasCorrentes.length} contas correntes em cache.`}
          </div>
        </div>
        <button
          type="button"
          onClick={handleSync}
          disabled={syncing}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-60"
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sincronizar do Omie
        </button>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 p-4">
        <div>
          <div className="text-sm font-medium text-ink-primary">Clientes e fornecedores</div>
          <div className="text-xs text-ink-muted">
            Espelha os cadastros do Omie para o banco do Case (atualiza toda noite; use aqui para
            forçar agora). A regra é ter todo cliente/artista já cadastrado no Omie.
          </div>
        </div>
        <button
          type="button"
          onClick={handleSyncCadastros}
          disabled={syncingCad}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-60"
        >
          {syncingCad ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sincronizar cadastros
        </button>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border bg-surface-1 p-4">
        <div>
          <div className="text-sm font-medium text-ink-primary">Status de pagamentos</div>
          <div className="text-xs text-ink-muted">
            Atualiza pago/pendente dos títulos lançados no Omie (a receber do cliente e a pagar dos
            artistas). Roda toda noite; use aqui para forçar agora.
          </div>
        </div>
        <button
          type="button"
          onClick={handleSyncPagamentos}
          disabled={syncingPag}
          className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-60"
        >
          {syncingPag ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Atualizar pagamentos
        </button>
      </div>

      <div className="space-y-4 rounded-lg border border-border bg-surface-1 p-4">
        <div>
          <label className={LABEL_CLS}>Categoria — Custódia de Valores de Artistas</label>
          <select value={custodia} onChange={(e) => setCustodia(e.target.value)} className={INPUT_CLS}>
            <option value="">— selecione —</option>
            {initial.categorias.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.descricao} ({c.codigo})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL_CLS}>Categoria — Clientes / Serviços Prestados (Comissões e BV)</label>
          <select value={servicos} onChange={(e) => setServicos(e.target.value)} className={INPUT_CLS}>
            <option value="">— selecione —</option>
            {initial.categorias.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.descricao} ({c.codigo})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className={LABEL_CLS}>Conta corrente</label>
          <select value={conta} onChange={(e) => setConta(e.target.value)} className={INPUT_CLS}>
            <option value="">— selecione —</option>
            {initial.contasCorrentes.map((c) => (
              <option key={c.codigo} value={c.codigo}>
                {c.descricao} ({c.codigo})
              </option>
            ))}
          </select>
        </div>
      </div>

      {err && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
          {err}
        </div>
      )}
      {msg && (
        <div className="flex items-center gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
          <Check className="h-4 w-4" />
          {msg}
        </div>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Salvar configuração
        </button>
      </div>
    </div>
  );
}
