"use client";

import { useMemo, useState, useTransition } from "react";
import {
  Activity,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  KeyRound,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import type { AiProviderName, ModelPrice } from "@/lib/ai/provider";
import {
  addProvider,
  deleteProvider,
  getAiPanelData,
  refreshUsageSummary,
  refreshUsdRate,
  saveModelPrices,
  saveProviderKey,
  saveProviderSettings,
  saveUsdBrlRate,
  saveUsdIofRate,
  setActiveProvider,
  setOcrProvider,
  setUsdRateAuto,
  testProviderConnection,
  type AiPanelData,
  type UsageBucket,
} from "@/lib/ai/settings-actions";

// ─── Formatadores ────────────────────────────────────────────────────────────

function brl(n: number): string {
  return n.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function intFmt(n: number): string {
  return Math.round(n).toLocaleString("pt-BR");
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
}

function pricesToStrings(
  mp: Record<string, ModelPrice>,
): Record<string, { input: string; output: string; cachedInput: string }> {
  const out: Record<string, { input: string; output: string; cachedInput: string }> = {};
  for (const [model, p] of Object.entries(mp)) {
    out[model] = {
      input: String(p.input),
      output: String(p.output),
      cachedInput: p.cachedInput != null ? String(p.cachedInput) : "",
    };
  }
  return out;
}

interface ProviderDraft {
  enabled: boolean;
  model: string;
  baseUrl: string;
  key: string;
}

interface NewProviderForm {
  open: boolean;
  slug: string;
  label: string;
  baseUrl: string;
  model: string;
  key: string;
}

const EMPTY_NEW_PROVIDER: NewProviderForm = {
  open: false,
  slug: "",
  label: "",
  baseUrl: "",
  model: "",
  key: "",
};

interface ModuleRow {
  module: string;
  label: string;
  today: number;
  month: number;
  total: number;
  monthTokens: number;
  monthCalls: number;
}

function draftsFrom(data: AiPanelData): Record<string, ProviderDraft> {
  return Object.fromEntries(
    data.providers.map((p) => [p.provider, { enabled: p.enabled, model: p.model, baseUrl: p.baseUrl ?? "", key: "" }]),
  );
}

// Une a quebra por módulo dos três buckets (hoje/mês/total) numa tabela só.
function mergeModuleRows(data: AiPanelData): ModuleRow[] {
  const map = new Map<string, ModuleRow>();
  const ensure = (module: string, label: string): ModuleRow => {
    let row = map.get(module);
    if (!row) {
      row = { module, label, today: 0, month: 0, total: 0, monthTokens: 0, monthCalls: 0 };
      map.set(module, row);
    }
    return row;
  };
  for (const m of data.usage.today.byModule) ensure(m.module, m.label).today += m.costBrl;
  for (const m of data.usage.month.byModule) {
    const row = ensure(m.module, m.label);
    row.month += m.costBrl;
    row.monthTokens += m.totalTokens;
    row.monthCalls += m.calls;
  }
  for (const m of data.usage.total.byModule) ensure(m.module, m.label).total += m.costBrl;
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

interface ProviderUsageRow {
  provider: string;
  label: string;
  today: number;
  month: number;
  total: number;
  monthTokens: number;
  monthCalls: number;
}

// Une a quebra por provedor (IA) dos três buckets numa tabela só. O rótulo vem
// da lista de provedores (fallback: o próprio slug).
function mergeProviderRows(data: AiPanelData): ProviderUsageRow[] {
  const labelFor = (slug: string) => data.providers.find((p) => p.provider === slug)?.label ?? slug;
  const map = new Map<string, ProviderUsageRow>();
  const ensure = (slug: string): ProviderUsageRow => {
    let row = map.get(slug);
    if (!row) {
      row = { provider: slug, label: labelFor(slug), today: 0, month: 0, total: 0, monthTokens: 0, monthCalls: 0 };
      map.set(slug, row);
    }
    return row;
  };
  for (const p of data.usage.today.byProvider) ensure(p.provider).today += p.costBrl;
  for (const p of data.usage.month.byProvider) {
    const row = ensure(p.provider);
    row.month += p.costBrl;
    row.monthTokens += p.totalTokens;
    row.monthCalls += p.calls;
  }
  for (const p of data.usage.total.byProvider) ensure(p.provider).total += p.costBrl;
  return Array.from(map.values()).sort((a, b) => b.total - a.total);
}

export function AiAdminClient({ initial, embedded = false }: { initial: AiPanelData; embedded?: boolean }) {
  const { showToast } = useToast();
  const [pending, startTransition] = useTransition();

  const [data, setData] = useState<AiPanelData>(initial);
  const [drafts, setDrafts] = useState<Record<string, ProviderDraft>>(() => draftsFrom(initial));
  const [rate, setRate] = useState<string>(String(initial.usdBrlRate));
  const [iof, setIof] = useState<string>(String(initial.usdIofRate));
  const [prices, setPrices] = useState<Record<string, { input: string; output: string; cachedInput: string }>>(() =>
    pricesToStrings(initial.modelPrices),
  );
  const [newProv, setNewProv] = useState<NewProviderForm>(EMPTY_NEW_PROVIDER);

  const moduleRows = useMemo(() => mergeModuleRows(data), [data]);
  const providerRows = useMemo(() => mergeProviderRows(data), [data]);

  // Roteamento efetivo por módulo (qual IA cada um usa DE FATO). A maioria segue
  // o provedor ativo; alguns são FIXOS. O Orçamento (Planejamento dos gestores) é
  // fixado no Google Gemini — mas cai para o provedor ativo se o Gemini estiver
  // sem chave ou desabilitado, então mostramos o provedor REAL em uso.
  const ativoLabel = data.providers.find((p) => p.provider === data.activeProvider)?.label ?? data.activeProvider;
  const gemini = data.providers.find((p) => p.provider === "gemini");
  const geminiPronto = Boolean(gemini && gemini.enabled && (gemini.hasKey || gemini.hasEnvKey));
  const orcamentoLabel = geminiPronto ? gemini?.label ?? "Google Gemini" : ativoLabel;
  const ocrLabel = data.ocrProvider
    ? data.providers.find((p) => p.provider === data.ocrProvider)?.label ?? data.ocrProvider
    : "OpenAI (visão)";
  const chartData = useMemo(
    () =>
      data.usage.daily.map((d) => ({
        day: d.day.slice(8, 10) + "/" + d.day.slice(5, 7),
        custo: Number(d.costBrl.toFixed(4)),
      })),
    [data.usage.daily],
  );

  function toast(ok: boolean, msg: string) {
    showToast({
      title: ok ? "Pronto" : "Erro",
      description: msg,
      variant: ok ? "success" : "destructive",
    });
  }

  // Recarrega tudo do servidor (após mudanças estruturais: add/remover provedor).
  async function reloadAll() {
    const fresh = await getAiPanelData();
    setData(fresh);
    setDrafts(draftsFrom(fresh));
    setRate(String(fresh.usdBrlRate));
    setPrices(pricesToStrings(fresh.modelPrices));
  }

  // ─── Handlers ──────────────────────────────────────────────────────────────

  function handleActiveChange(provider: string) {
    startTransition(async () => {
      const res = await setActiveProvider(provider);
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({ ...prev, activeProvider: provider }));
      const label = data.providers.find((p) => p.provider === provider)?.label ?? provider;
      toast(true, `Provedor ativo: ${label}.`);
    });
  }

  // Provedor dedicado à leitura de documentos (OCR). "" = usar o provedor geral.
  function handleOcrChange(value: string) {
    const provider = value === "__geral__" ? null : value;
    startTransition(async () => {
      const res = await setOcrProvider(provider);
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({ ...prev, ocrProvider: provider }));
      const label = provider
        ? data.providers.find((p) => p.provider === provider)?.label ?? provider
        : "Provedor geral";
      toast(true, `Provedor de OCR: ${label}.`);
    });
  }

  function handleSaveProvider(provider: AiProviderName) {
    const draft = drafts[provider];
    if (!draft) return;
    startTransition(async () => {
      const res = await saveProviderSettings(provider, {
        enabled: draft.enabled,
        model: draft.model,
        baseUrl: draft.baseUrl,
      });
      if ("error" in res) return toast(false, res.error);

      let keyChanged = false;
      if (draft.key.trim()) {
        const keyRes = await saveProviderKey(provider, draft.key.trim());
        if ("error" in keyRes) return toast(false, keyRes.error);
        keyChanged = true;
      }

      setData((prev) => ({
        ...prev,
        providers: prev.providers.map((p) =>
          p.provider === provider
            ? {
                ...p,
                enabled: draft.enabled,
                model: draft.model,
                baseUrl: draft.baseUrl.trim() || null,
                hasKey: keyChanged ? true : p.hasKey,
              }
            : p,
        ),
      }));
      setDrafts((prev) => ({ ...prev, [provider]: { ...draft, key: "" } }));
      toast(true, "Configuração do provedor salva.");
    });
  }

  function handleClearKey(provider: AiProviderName) {
    startTransition(async () => {
      const res = await saveProviderKey(provider, "");
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({
        ...prev,
        providers: prev.providers.map((p) => (p.provider === provider ? { ...p, hasKey: false } : p)),
      }));
      setDrafts((prev) => ({ ...prev, [provider]: { ...prev[provider], key: "" } }));
      toast(true, "Chave removida.");
    });
  }

  function handleAddProvider() {
    startTransition(async () => {
      const res = await addProvider({
        slug: newProv.slug,
        label: newProv.label,
        baseUrl: newProv.baseUrl,
        model: newProv.model,
        apiKey: newProv.key,
      });
      if ("error" in res) return toast(false, res.error);
      await reloadAll();
      setNewProv(EMPTY_NEW_PROVIDER);
      toast(true, "Provedor adicionado.");
    });
  }

  function handleDeleteProvider(provider: AiProviderName, label: string) {
    if (typeof window !== "undefined" && !window.confirm(`Remover o provedor "${label}"?`)) return;
    startTransition(async () => {
      const res = await deleteProvider(provider);
      if ("error" in res) return toast(false, res.error);
      await reloadAll();
      toast(true, "Provedor removido.");
    });
  }

  function handleTestProvider(provider: AiProviderName) {
    const draft = drafts[provider];
    if (!draft) return;
    startTransition(async () => {
      const res = await testProviderConnection({
        provider,
        baseUrl: draft.baseUrl,
        apiKey: draft.key,
        model: draft.model,
      });
      if ("error" in res) return toast(false, `Falha na conexão: ${res.error}`);
      toast(true, `Conexão OK (${res.latencyMs} ms) — resposta: "${res.sample}"`);
    });
  }

  function handleTestNewProvider() {
    startTransition(async () => {
      const res = await testProviderConnection({
        baseUrl: newProv.baseUrl,
        apiKey: newProv.key,
        model: newProv.model,
      });
      if ("error" in res) return toast(false, `Falha na conexão: ${res.error}`);
      toast(true, `Conexão OK (${res.latencyMs} ms) — resposta: "${res.sample}"`);
    });
  }

  function handleSaveRate() {
    const parsed = Number(rate.replace(",", "."));
    startTransition(async () => {
      const res = await saveUsdBrlRate(parsed);
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({ ...prev, usdBrlRate: parsed, usdBrlAuto: false }));
      toast(true, "Câmbio manual salvo.");
    });
  }

  function handleSaveIof() {
    const parsed = Number(iof.replace(",", "."));
    startTransition(async () => {
      const res = await saveUsdIofRate(parsed);
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({ ...prev, usdIofRate: parsed }));
      toast(true, "IOF salvo.");
    });
  }

  function handleToggleUsdAuto(auto: boolean) {
    startTransition(async () => {
      const res = await setUsdRateAuto(auto);
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({
        ...prev,
        usdBrlAuto: auto,
        usdBrlRate: res.rate ?? prev.usdBrlRate,
        usdBrlUpdatedAt: res.updatedAt ?? prev.usdBrlUpdatedAt,
      }));
      if (res.rate) setRate(String(res.rate));
      toast(true, auto ? "Cotação automática ligada." : "Cotação automática desligada.");
    });
  }

  function handleRefreshUsd() {
    startTransition(async () => {
      const res = await refreshUsdRate();
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({ ...prev, usdBrlRate: res.rate, usdBrlUpdatedAt: res.updatedAt }));
      setRate(String(res.rate));
      toast(true, `Cotação atualizada: ${brl(res.rate)}.`);
    });
  }

  function handleSavePrices() {
    const payload: Record<string, { input: number; output: number; cachedInput?: number }> = {};
    for (const [model, p] of Object.entries(prices)) {
      const cachedStr = (p.cachedInput ?? "").trim();
      payload[model] = {
        input: Number(p.input.replace(",", ".")),
        output: Number(p.output.replace(",", ".")),
        ...(cachedStr ? { cachedInput: Number(cachedStr.replace(",", ".")) } : {}),
      };
    }
    startTransition(async () => {
      const res = await saveModelPrices(payload);
      if ("error" in res) return toast(false, res.error);
      setData((prev) => ({
        ...prev,
        modelPrices: Object.fromEntries(
          Object.entries(payload).map(([m, p]) => [
            m,
            { input: p.input, output: p.output, cachedInput: p.cachedInput },
          ]),
        ),
      }));
      toast(true, "Preços atualizados.");
    });
  }

  function handleRefreshUsage() {
    startTransition(async () => {
      const usage = await refreshUsageSummary();
      setData((prev) => ({ ...prev, usage }));
      toast(true, "Consumo atualizado.");
    });
  }

  const priceModels = Object.keys(prices).sort();

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={embedded ? "space-y-8" : "mx-auto max-w-6xl space-y-8 p-6"}>
      {!embedded && (
        <header className="space-y-1">
          <div className="flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            <h1 className="text-2xl font-bold tracking-tight">Inteligência Artificial</h1>
          </div>
          <p className="text-sm text-muted-foreground">
            Escolha o provedor de IA usado pelo Business Intelligence e demais funcionalidades, e
            acompanhe o consumo e o custo em reais.
          </p>
        </header>
      )}

      {/* Provedor ativo */}
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="text-lg">Provedor ativo (geral)</CardTitle>
          <CardDescription>
            Vale para BI, relatórios, projeções, comparações e contratos. A leitura de documentos
            (OCR de notas/boletos) tem provedor próprio, configurado logo abaixo. A busca de preços na
            web (Viagens) usa recursos exclusivos da OpenAI e segue sempre nela.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:w-72">
            <Select value={data.activeProvider} onValueChange={handleActiveChange} disabled={pending}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {data.providers.map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Badge variant="secondary" className="w-fit">
            Em uso: {data.providers.find((p) => p.provider === data.activeProvider)?.label ?? data.activeProvider}
          </Badge>
        </CardContent>
      </Card>

      {/* Provedor de leitura de documentos (OCR) — separado do geral */}
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="text-lg">Provedor de leitura de documentos (OCR)</CardTitle>
          <CardDescription>
            IA usada só para LER notas fiscais e boletos (Compras) e contratos (CASE). Escolha um
            provedor com visão (ex.: Google Gemini). Para usar o Gemini, configure a chave dele no
            card do provedor mais abaixo. Se ficar em “Provedor geral”, o OCR usa a OpenAI (visão).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="w-full sm:w-72">
            <Select
              value={data.ocrProvider ?? "__geral__"}
              onValueChange={handleOcrChange}
              disabled={pending}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__geral__">Provedor geral (OpenAI para OCR)</SelectItem>
                {data.providers.map((p) => (
                  <SelectItem key={p.provider} value={p.provider}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Badge variant="secondary" className="w-fit">
            OCR:{" "}
            {data.ocrProvider
              ? data.providers.find((p) => p.provider === data.ocrProvider)?.label ?? data.ocrProvider
              : "Provedor geral"}
          </Badge>
        </CardContent>
      </Card>

      {/* Roteamento — qual IA cada módulo usa */}
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="text-lg">Qual IA cada módulo usa</CardTitle>
          <CardDescription>
            A maioria dos módulos usa o <b>provedor ativo (geral)</b> escolhido acima. Alguns têm IA{" "}
            <b>fixa</b> por necessidade técnica — abaixo está a IA que cada módulo usa de fato.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y">
          <ModuloIaRow
            modulo="BI, Relatórios, Projeções, Comparações, Contratos"
            ia={ativoLabel}
            nota="Segue o provedor ativo (geral)."
          />
          <ModuloIaRow
            modulo="Orçamento — Planejamento dos gestores"
            ia={orcamentoLabel}
            nota={
              geminiPronto
                ? "Fixo no Google Gemini (texto). Cai para o provedor ativo apenas se o Gemini falhar."
                : "Deveria usar o Google Gemini, mas ele está sem chave ou desabilitado — está caindo para o provedor ativo. Configure o Gemini abaixo."
            }
            alerta={!geminiPronto}
          />
          <ModuloIaRow
            modulo="Leitura de documentos (OCR) — notas, boletos, contratos"
            ia={ocrLabel}
            nota="Segue o provedor de OCR configurado acima."
          />
          <ModuloIaRow
            modulo="Viagens — busca de preços na web"
            ia="OpenAI"
            nota="Recurso exclusivo da OpenAI; sempre nela."
          />
        </CardContent>
      </Card>

      {/* Consumo & Custo */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Consumo &amp; Custo</h2>
          <Button variant="outline" size="sm" onClick={handleRefreshUsage} disabled={pending}>
            <RefreshCw className="mr-2 h-4 w-4" /> Atualizar
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <UsageCard title="Hoje" icon={<Activity className="h-4 w-4" />} bucket={data.usage.today} />
          <UsageCard title="Este mês" icon={<CalendarDays className="h-4 w-4" />} bucket={data.usage.month} />
          <UsageCard title="Total (histórico)" icon={<CircleDollarSign className="h-4 w-4" />} bucket={data.usage.total} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Custo por dia (últimos 30 dias)</CardTitle>
          </CardHeader>
          <CardContent>
            {chartData.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Ainda não há consumo registrado. Os dados aparecem aqui conforme a IA for usada.
              </p>
            ) : (
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <RTooltip
                      formatter={(value) => [brl(Number(value ?? 0)), "Custo"]}
                      labelFormatter={(l) => `Dia ${l}`}
                    />
                    <Bar dataKey="custo" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consumo por módulo</CardTitle>
            <CardDescription>Custo em reais por funcionalidade.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Módulo</th>
                  <th className="py-2 pr-4 text-right font-medium">Hoje</th>
                  <th className="py-2 pr-4 text-right font-medium">Mês</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 pr-4 text-right font-medium">Tokens (mês)</th>
                  <th className="py-2 text-right font-medium">Chamadas (mês)</th>
                </tr>
              </thead>
              <tbody>
                {moduleRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      Sem consumo registrado ainda.
                    </td>
                  </tr>
                ) : (
                  moduleRows.map((r) => (
                    <tr key={r.module} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{r.label}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{brl(r.today)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{brl(r.month)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{brl(r.total)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {intFmt(r.monthTokens)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{intFmt(r.monthCalls)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Consumo por IA (provedor)</CardTitle>
            <CardDescription>Custo em reais por provedor de IA.</CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Provedor</th>
                  <th className="py-2 pr-4 text-right font-medium">Hoje</th>
                  <th className="py-2 pr-4 text-right font-medium">Mês</th>
                  <th className="py-2 pr-4 text-right font-medium">Total</th>
                  <th className="py-2 pr-4 text-right font-medium">Tokens (mês)</th>
                  <th className="py-2 text-right font-medium">Chamadas (mês)</th>
                </tr>
              </thead>
              <tbody>
                {providerRows.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-6 text-center text-muted-foreground">
                      Sem consumo registrado ainda.
                    </td>
                  </tr>
                ) : (
                  providerRows.map((r) => (
                    <tr key={r.provider} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{r.label}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{brl(r.today)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{brl(r.month)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{brl(r.total)}</td>
                      <td className="py-2 pr-4 text-right tabular-nums text-muted-foreground">
                        {intFmt(r.monthTokens)}
                      </td>
                      <td className="py-2 text-right tabular-nums text-muted-foreground">{intFmt(r.monthCalls)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </section>

      {/* Provedores */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Provedores</h2>
          {!newProv.open && (
            <Button variant="outline" size="sm" onClick={() => setNewProv({ ...EMPTY_NEW_PROVIDER, open: true })}>
              <Plus className="mr-2 h-4 w-4" /> Adicionar provedor
            </Button>
          )}
        </div>

        {newProv.open && (
          <Card className="border-dashed">
            <CardHeader>
              <CardTitle className="text-base">Novo provedor</CardTitle>
              <CardDescription>
                Qualquer provedor compatível com a API da OpenAI (ex.: Groq, Together, OpenRouter, Mistral).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="np-label">Nome</Label>
                  <Input
                    id="np-label"
                    value={newProv.label}
                    onChange={(e) => setNewProv((p) => ({ ...p, label: e.target.value }))}
                    placeholder="Groq"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-slug">Identificador</Label>
                  <Input
                    id="np-slug"
                    value={newProv.slug}
                    onChange={(e) => setNewProv((p) => ({ ...p, slug: e.target.value }))}
                    placeholder="groq"
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="np-base">Base URL (compatível com a API da OpenAI)</Label>
                  <Input
                    id="np-base"
                    value={newProv.baseUrl}
                    onChange={(e) => setNewProv((p) => ({ ...p, baseUrl: e.target.value }))}
                    placeholder="https://api.groq.com/openai/v1"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-model">Modelo padrão</Label>
                  <Input
                    id="np-model"
                    value={newProv.model}
                    onChange={(e) => setNewProv((p) => ({ ...p, model: e.target.value }))}
                    placeholder="llama-3.3-70b-versatile"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="np-key">Chave de API</Label>
                  <Input
                    id="np-key"
                    type="password"
                    value={newProv.key}
                    onChange={(e) => setNewProv((p) => ({ ...p, key: e.target.value }))}
                    placeholder="Cole a chave"
                    autoComplete="off"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleAddProvider} disabled={pending}>
                  Adicionar
                </Button>
                <Button size="sm" variant="outline" onClick={handleTestNewProvider} disabled={pending}>
                  <Zap className="mr-2 h-4 w-4" /> Testar conexão
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNewProv(EMPTY_NEW_PROVIDER)} disabled={pending}>
                  Cancelar
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          {data.providers.map((p) => {
            const draft = drafts[p.provider];
            const isActive = data.activeProvider === p.provider;
            return (
              <Card key={p.provider} className={isActive ? "border-primary/40" : undefined}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{p.label}</CardTitle>
                    <div className="flex items-center gap-2">
                      {isActive && <Badge variant="secondary">Ativo</Badge>}
                      <Badge variant={p.enabled ? "default" : "outline"}>
                        {p.enabled ? "Habilitado" : "Desabilitado"}
                      </Badge>
                    </div>
                  </div>
                  {p.capabilityNote && <CardDescription>{p.capabilityNote}</CardDescription>}
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor={`model-${p.provider}`}>Modelo</Label>
                    <Input
                      id={`model-${p.provider}`}
                      value={draft?.model ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [p.provider]: { ...prev[p.provider], model: e.target.value } }))
                      }
                      placeholder={p.provider === "openai" ? "gpt-4o-mini" : "deepseek-chat"}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`base-${p.provider}`}>Base URL</Label>
                    <Input
                      id={`base-${p.provider}`}
                      value={draft?.baseUrl ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [p.provider]: { ...prev[p.provider], baseUrl: e.target.value } }))
                      }
                      placeholder={p.isBuiltin ? "Padrão do provedor" : "https://..."}
                    />
                    {p.provider === "openai" && (
                      <p className="text-xs text-muted-foreground">Deixe em branco para usar a API padrão da OpenAI.</p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor={`key-${p.provider}`} className="flex items-center gap-1">
                      <KeyRound className="h-3.5 w-3.5" /> Chave de API
                    </Label>
                    <Input
                      id={`key-${p.provider}`}
                      type="password"
                      value={draft?.key ?? ""}
                      onChange={(e) =>
                        setDrafts((prev) => ({ ...prev, [p.provider]: { ...prev[p.provider], key: e.target.value } }))
                      }
                      placeholder={
                        p.hasKey
                          ? "•••••••••• (chave salva — digite para trocar)"
                          : p.hasEnvKey
                            ? "Usando variável de ambiente"
                            : "Cole a chave de API"
                      }
                      autoComplete="off"
                    />
                    <p className="text-xs text-muted-foreground">
                      {p.hasKey ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                          <BadgeCheck className="h-3.5 w-3.5" /> Chave salva no painel (criptografada)
                        </span>
                      ) : p.hasEnvKey ? (
                        "Sem chave no painel — usando a variável de ambiente."
                      ) : (
                        "Nenhuma chave configurada."
                      )}
                    </p>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={draft?.enabled ?? false}
                      onChange={(e) =>
                        setDrafts((prev) => ({
                          ...prev,
                          [p.provider]: { ...prev[p.provider], enabled: e.target.checked },
                        }))
                      }
                    />
                    Habilitado (disponível para seleção)
                  </label>

                  <div className="flex items-center gap-2">
                    <Button size="sm" onClick={() => handleSaveProvider(p.provider)} disabled={pending}>
                      Salvar
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleTestProvider(p.provider)}
                      disabled={pending}
                    >
                      <Zap className="mr-2 h-4 w-4" /> Testar
                    </Button>
                    {p.hasKey && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleClearKey(p.provider)}
                        disabled={pending}
                      >
                        Remover chave
                      </Button>
                    )}
                    {p.canDelete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-destructive hover:text-destructive"
                        onClick={() => handleDeleteProvider(p.provider, p.label)}
                        disabled={pending}
                      >
                        <Trash2 className="mr-1 h-4 w-4" /> Remover
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* Câmbio & Preços */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Câmbio &amp; Preços</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Câmbio USD → BRL</CardTitle>
            <CardDescription>Converte o custo dos tokens (cobrados em dólar) para reais.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-input"
                checked={data.usdBrlAuto}
                onChange={(e) => handleToggleUsdAuto(e.target.checked)}
                disabled={pending}
              />
              Automático — cotação atual do dólar comercial
            </label>

            {data.usdBrlAuto ? (
              <div className="flex flex-wrap items-end gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Cotação atual</p>
                  <p className="text-2xl font-semibold tabular-nums">
                    {data.usdBrlRate.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 4 })}
                  </p>
                  <p className="text-xs text-muted-foreground">Atualizada em {fmtDateTime(data.usdBrlUpdatedAt)}</p>
                </div>
                <Button variant="outline" size="sm" onClick={handleRefreshUsd} disabled={pending}>
                  <RefreshCw className="mr-2 h-4 w-4" /> Atualizar agora
                </Button>
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <div className="w-40 space-y-1.5">
                  <Label htmlFor="rate">1 USD =</Label>
                  <Input id="rate" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
                </div>
                <Button size="sm" onClick={handleSaveRate} disabled={pending}>
                  Salvar câmbio
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">IOF — compras em dólar</CardTitle>
            <CardDescription>
              Alíquota de IOF (%) somada na conversão das compras em dólar das requisições de Compras
              (US$ × câmbio × (1 + IOF)). O câmbio acima é o mesmo usado na conversão.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-3">
              <div className="w-40 space-y-1.5">
                <Label htmlFor="iof">IOF (%)</Label>
                <Input id="iof" inputMode="decimal" value={iof} onChange={(e) => setIof(e.target.value)} />
              </div>
              <Button size="sm" onClick={handleSaveIof} disabled={pending}>
                Salvar IOF
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Preços por modelo (USD por 1M tokens)</CardTitle>
            <CardDescription>
              Ajuste conforme a tabela do provedor. &quot;Input cache&quot; é o preço do input em cache hit
              (contexto repetido) — o DeepSeek cobra bem mais barato; deixe em branco para usar o preço de
              input. O custo em reais usa estes valores × o câmbio.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                  <th className="py-2 pr-4 font-medium">Modelo</th>
                  <th className="py-2 pr-4 font-medium">Input (USD/1M)</th>
                  <th className="py-2 pr-4 font-medium">Input cache (USD/1M)</th>
                  <th className="py-2 font-medium">Output (USD/1M)</th>
                </tr>
              </thead>
              <tbody>
                {priceModels.map((model) => (
                  <tr key={model} className="border-b last:border-0">
                    <td className="py-2 pr-4 font-mono text-xs">{model}</td>
                    <td className="py-2 pr-4">
                      <Input
                        className="h-8 w-28"
                        inputMode="decimal"
                        value={prices[model]?.input ?? ""}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [model]: { ...prev[model], input: e.target.value } }))
                        }
                      />
                    </td>
                    <td className="py-2 pr-4">
                      <Input
                        className="h-8 w-28"
                        inputMode="decimal"
                        placeholder="= input"
                        value={prices[model]?.cachedInput ?? ""}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [model]: { ...prev[model], cachedInput: e.target.value } }))
                        }
                      />
                    </td>
                    <td className="py-2">
                      <Input
                        className="h-8 w-28"
                        inputMode="decimal"
                        value={prices[model]?.output ?? ""}
                        onChange={(e) =>
                          setPrices((prev) => ({ ...prev, [model]: { ...prev[model], output: e.target.value } }))
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Button size="sm" onClick={handleSavePrices} disabled={pending}>
              Salvar preços
            </Button>
          </CardContent>
        </Card>
      </section>
    </div>
  );
}

function ModuloIaRow({
  modulo,
  ia,
  nota,
  alerta = false,
}: {
  modulo: string;
  ia: string;
  nota: string;
  alerta?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{modulo}</p>
        <p className={`text-xs ${alerta ? "text-amber-600 dark:text-amber-500" : "text-muted-foreground"}`}>{nota}</p>
      </div>
      <Badge variant={alerta ? "outline" : "secondary"} className="w-fit shrink-0">
        {ia}
      </Badge>
    </div>
  );
}

function UsageCard({ title, icon, bucket }: { title: string; icon: React.ReactNode; bucket: UsageBucket }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          {icon} {title}
        </CardDescription>
        <CardTitle className="text-2xl tabular-nums">{brl(bucket.costBrl)}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0 text-xs text-muted-foreground">
        {intFmt(bucket.totalTokens)} tokens · {intFmt(bucket.calls)} chamadas
      </CardContent>
    </Card>
  );
}
