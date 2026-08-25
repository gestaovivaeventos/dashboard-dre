"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDot,
  Loader2,
  Search,
  Send,
  Sparkles,
  RotateCcw,
} from "lucide-react";

import {
  getPlanejamentoSocios,
  enviarMensagemPlanejamento,
  salvarPlanejamentoSocios,
  removerPlanejamentoSocios,
  type PlanejamentoSociosItem,
  type PlanejamentoMensagem,
} from "@/lib/orcamento/actions/planejamento-socios";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const CELL =
  "w-full rounded border bg-background px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-ring";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// ─── Selo de status ─────────────────────────────────────────────────────────

type Selo = "nao_iniciado" | "andamento" | "concluido";

function seloDe(item: PlanejamentoSociosItem): Selo {
  if (item.status === "concluido" && item.valores) return "concluido";
  if (item.conversa.length > 0 || item.valores) return "andamento";
  return "nao_iniciado";
}

function StatusChip({ selo }: { selo: Selo }) {
  const map = {
    nao_iniciado: {
      icon: Circle,
      label: "Não iniciado",
      cls: "text-muted-foreground border-border",
    },
    andamento: {
      icon: CircleDot,
      label: "Em andamento",
      cls: "text-amber-600 dark:text-amber-500 border-amber-500/40 bg-amber-500/5",
    },
    concluido: {
      icon: CheckCircle2,
      label: "Concluído",
      cls: "text-emerald-600 dark:text-emerald-400 border-emerald-500/40 bg-emerald-500/5",
    },
  }[selo];
  const Icon = map.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        map.cls,
      )}
    >
      <Icon className="h-3 w-3" />
      {map.label}
    </span>
  );
}

// ─── Célula editável de valor mensal ────────────────────────────────────────

function MonthValueCell({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(numberToInput(value));
  const [focused, setFocused] = useState(false);
  const dirty = useRef(false);

  useEffect(() => {
    setDraft(numberToInput(value));
    dirty.current = false;
  }, [value]);

  function commit() {
    if (!dirty.current) return;
    dirty.current = false;
    const parsed = parseBrNumber(draft);
    onCommit(parsed != null && Number.isFinite(parsed) && parsed > 0 ? parsed : 0);
  }

  const display = focused ? draft : value > 0 ? formatBRL(value) : "";

  return (
    <input
      value={display}
      onChange={(e) => {
        dirty.current = true;
        setDraft(e.target.value);
      }}
      onFocus={(e) => {
        setFocused(true);
        const el = e.target;
        requestAnimationFrame(() => el.select());
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      inputMode="decimal"
      placeholder="0"
      className={CELL}
    />
  );
}

// ─── Painel de entrevista de UMA categoria ──────────────────────────────────

function CategoriaInterview({
  companyId,
  year,
  item,
  onBack,
  onSaved,
  onError,
}: {
  companyId: string;
  year: number;
  item: PlanejamentoSociosItem;
  onBack: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [conversa, setConversa] = useState<PlanejamentoMensagem[]>(item.conversa);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [valores, setValores] = useState<number[]>(item.valores ?? Array<number>(12).fill(0));
  const [temProposta, setTemProposta] = useState<boolean>(Boolean(item.valores));
  const [justificativa, setJustificativa] = useState(item.justificativa ?? "");
  const [saving, setSaving] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversa, sending]);

  async function enviar(texto: string) {
    setSending(true);
    setLocalErr(null);
    const res = await enviarMensagemPlanejamento(
      companyId,
      year,
      item.categoryCode,
      item.categoryName,
      conversa,
      texto,
    );
    setSending(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.conversa) setConversa(res.conversa);
    if (res.proposta) {
      setValores(res.proposta.valores);
      setJustificativa(res.proposta.justificativa);
      setTemProposta(true);
    }
    // res.error com conversa presente = a resposta veio, só o persist falhou.
    if (res.error) setLocalErr(res.error);
  }

  function handleSend() {
    const t = input.trim();
    if (!t || sending) return;
    setInput("");
    void enviar(t);
  }

  async function salvar() {
    setSaving(true);
    setLocalErr(null);
    const res = await salvarPlanejamentoSocios(
      companyId,
      year,
      item.categoryCode,
      item.categoryName,
      valores,
      justificativa,
      conversa,
    );
    setSaving(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    onSaved();
  }

  async function recomecar() {
    setConfirmReset(false);
    const res = await removerPlanejamentoSocios(companyId, year, item.categoryCode);
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    setConversa([]);
    setValores(Array<number>(12).fill(0));
    setJustificativa("");
    setTemProposta(false);
    setLocalErr(null);
  }

  const total = valores.reduce((a, b) => a + b, 0);
  const conversaIniciada = conversa.length > 0;
  const r = item.realizadoAnterior;

  return (
    <div className="space-y-4">
      {/* Cabeçalho da categoria */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={onBack}
            className="mt-0.5 inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted"
          >
            <ArrowLeft className="h-4 w-4" />
            Categorias
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">{item.categoryName}</h3>
              <StatusChip selo={seloDe({ ...item, conversa, valores: temProposta ? valores : item.valores })} />
            </div>
            <p className="text-xs text-muted-foreground">
              {item.categoryCode} · linha DRE {item.dreLineCode} — {item.dreLineName}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Ano anterior ({year - 1}):{" "}
              {r && r.media != null ? (
                <span className="tabular-nums">
                  {formatBRL(r.media)}/mês · total {formatBRL(r.total)}
                </span>
              ) : (
                "sem realizado"
              )}
            </p>
          </div>
        </div>

        {(conversaIniciada || temProposta) &&
          (confirmReset ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground">Apagar tudo?</span>
              <button
                type="button"
                onClick={recomecar}
                className="rounded-md bg-destructive px-2 py-1 font-medium text-destructive-foreground"
              >
                Recomeçar
              </button>
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="rounded-md border px-2 py-1"
              >
                Cancelar
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-sm text-muted-foreground hover:bg-muted"
            >
              <RotateCcw className="h-4 w-4" />
              Recomeçar
            </button>
          ))}
      </div>

      {localErr && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{localErr}</div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Chat */}
        <div className="flex min-h-[26rem] flex-col rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Entrevista com a IA
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" style={{ maxHeight: "24rem" }}>
            {!conversaIniciada && !sending && (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
                <p className="max-w-xs text-sm text-muted-foreground">
                  A IA vai fazer algumas perguntas para entender como essa despesa deve se comportar
                  em {year} e propor os 12 valores mensais.
                </p>
                <button
                  type="button"
                  onClick={() => void enviar("")}
                  className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700"
                >
                  <Sparkles className="h-4 w-4" />
                  Iniciar entrevista
                </button>
              </div>
            )}

            {conversa.map((m, i) => (
              <div
                key={i}
                className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                    m.role === "user"
                      ? "bg-emerald-600 text-white"
                      : "bg-muted text-foreground",
                  )}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {sending && (
              <div className="flex justify-start">
                <div className="inline-flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  A IA está pensando…
                </div>
              </div>
            )}
          </div>

          {conversaIniciada && (
            <div className="border-t p-2">
              <div className="flex items-end gap-2">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  rows={2}
                  placeholder="Responda à IA… (Enter envia, Shift+Enter quebra linha)"
                  disabled={sending}
                  className={cn(INPUT_CLS, "resize-none")}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={sending || !input.trim()}
                  className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
                  title="Enviar"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Proposta / valores */}
        <div className="flex flex-col rounded-lg border">
          <div className="border-b bg-muted/30 px-3 py-2 text-sm font-medium">
            Orçamento {year} — 12 meses
          </div>
          <div className="flex-1 space-y-3 p-3">
            {!temProposta && (
              <p className="text-xs text-muted-foreground">
                Os valores aparecem aqui quando a IA propuser — você pode ajustar qualquer mês antes
                de salvar. Também dá para preencher à mão.
              </p>
            )}
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {valores.map((v, i) => (
                <div key={i}>
                  <label className="mb-0.5 block text-[10px] uppercase tracking-wide text-muted-foreground">
                    {MESES[i]}
                  </label>
                  <MonthValueCell
                    value={v}
                    onCommit={(n) =>
                      setValores((prev) => prev.map((x, idx) => (idx === i ? n : x)))
                    }
                  />
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total do ano</span>
              <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">
                Justificativa / premissas
              </label>
              <textarea
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3}
                placeholder="O porquê do número (a IA preenche ao propor; você pode editar)."
                className={cn(INPUT_CLS, "resize-none")}
              />
            </div>
          </div>

          <div className="border-t p-3">
            <button
              type="button"
              onClick={salvar}
              disabled={saving || total <= 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar orçamento da categoria
            </button>
            {total <= 0 && (
              <p className="mt-1 text-center text-[11px] text-muted-foreground">
                Defina ao menos um mês com valor para salvar.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Manager (lista + seleção) ──────────────────────────────────────────────

export function PlanejamentoSociosManager({
  companyId,
  year,
}: {
  companyId: string;
  year: number;
}) {
  const [items, setItems] = useState<PlanejamentoSociosItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [needsMigration, setNeedsMigration] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  async function reload() {
    if (!companyId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setNeedsMigration(false);
    const res = await getPlanejamentoSocios(companyId, year);
    setLoading(false);
    if (res.needsMigration) {
      setNeedsMigration(true);
      setItems([]);
      return;
    }
    if (res.error || !res.items) {
      setLoadError(res.error ?? "Falha ao carregar.");
      setItems([]);
      return;
    }
    setItems(res.items);
  }

  useEffect(() => {
    void reload();
    setSearch("");
    setSelected(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (i) => i.categoryName.toLowerCase().includes(q) || i.categoryCode.toLowerCase().includes(q),
    );
  }, [items, search]);

  const selectedItem = selected ? items.find((i) => i.categoryCode === selected) ?? null : null;

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando categorias…
      </div>
    );
  }

  if (needsMigration) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Migration pendente</p>
        <p className="mt-1 text-muted-foreground">
          Aplique a migration{" "}
          <code className="rounded bg-muted px-1 py-0.5">20260825120000_orcamento_planejamento_socios</code>{" "}
          para habilitar esta tela.
        </p>
      </div>
    );
  }

  if (selectedItem) {
    return (
      <CategoriaInterview
        companyId={companyId}
        year={year}
        item={selectedItem}
        onBack={() => setSelected(null)}
        onSaved={() => {
          setSelected(null);
          void reload();
        }}
        onError={(msg) => {
          setSelected(null);
          setLoadError(msg);
          void reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-4">
      {loadError && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{loadError}</div>
      )}

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-12 text-center text-sm text-muted-foreground">
          Nenhuma categoria desta empresa está marcada para o método{" "}
          <span className="font-medium">Planejamento dos sócios</span> em {year}. Defina o método em
          Configuração → Método por categoria.
        </div>
      ) : (
        <>
          <div className="relative max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar categoria"
              className={INPUT_CLS + " pl-9"}
            />
          </div>

          <p className="text-sm text-muted-foreground">
            {items.length} categoria(s) por planejamento dos sócios. Escolha por qual começar — a
            entrevista com a IA guarda o progresso de cada uma.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const selo = seloDe(item);
              const total = item.valores ? item.valores.reduce((a, b) => a + b, 0) : null;
              return (
                <button
                  key={item.categoryCode}
                  type="button"
                  onClick={() => setSelected(item.categoryCode)}
                  className="group flex flex-col rounded-xl border bg-card p-4 text-left transition-colors hover:border-emerald-500/40 hover:bg-muted/40"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-semibold">{item.categoryName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.dreLineCode} — {item.dreLineName}
                      </div>
                    </div>
                    <StatusChip selo={selo} />
                  </div>
                  <div className="mt-3 flex items-end justify-between gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {item.realizadoAnterior && item.realizadoAnterior.media != null
                        ? `${year - 1}: ${formatBRL(item.realizadoAnterior.media)}/mês`
                        : `sem realizado ${year - 1}`}
                    </span>
                    {total != null && total > 0 ? (
                      <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 group-hover:underline dark:text-emerald-400">
                        <Sparkles className="h-3.5 w-3.5" />
                        Começar
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="col-span-full rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                Nenhuma categoria encontrada para “{search}”.
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
