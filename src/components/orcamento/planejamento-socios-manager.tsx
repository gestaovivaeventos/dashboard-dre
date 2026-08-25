"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDot,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import {
  getPlanejamentoSocios,
  getPlanejamentoCategoria,
  enviarMensagemPlanejamento,
  salvarPlanejamentoItens,
  removerPlanejamentoSocios,
  type PlanejamentoListItem,
  type PlanejamentoCategoriaDetalhe,
} from "@/lib/orcamento/actions/planejamento-socios";
import {
  categoriaTotal,
  type PlanejamentoMensagem,
  type PlanejamentoItem,
} from "@/lib/orcamento/planejamento-calc";
import { formatBRL, numberToInput, parseBrNumber } from "@/lib/orcamento/format";
import { cn } from "@/lib/utils";

const INPUT_CLS =
  "w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring disabled:opacity-50";
const CELL =
  "w-full rounded border bg-background px-2 py-1 text-sm text-right tabular-nums outline-none focus:ring-1 focus:ring-ring";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MESES_LONGO = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

// ─── Selo de status ─────────────────────────────────────────────────────────

type Selo = "nao_iniciado" | "andamento" | "concluido";

function StatusChip({ selo }: { selo: Selo }) {
  const map = {
    nao_iniciado: { icon: Circle, label: "Não iniciado", cls: "text-muted-foreground border-border" },
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

// ─── Célula de moeda (valor mensal do item) ─────────────────────────────────

function CurrencyCell({ value, onCommit }: { value: number; onCommit: (n: number) => void }) {
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
      placeholder="R$ 0,00"
      className={cn(CELL, "w-28")}
    />
  );
}

/** Meses ativos de um item (do mês de início até dezembro). */
function mesesAtivos(mesInicio: number): number {
  return 12 - Math.min(12, Math.max(1, mesInicio)) + 1;
}

// ─── Linha de item ──────────────────────────────────────────────────────────

interface LocalItem extends PlanejamentoItem {
  key: string;
}

function ItemRow({
  item,
  onChange,
  onRemove,
}: {
  item: LocalItem;
  onChange: (partial: Partial<LocalItem>) => void;
  onRemove: () => void;
}) {
  const descFaltando = item.descricao.trim() === "";
  const totalItem = item.valorMensal * mesesAtivos(item.mesInicio);
  return (
    <tr className="align-top">
      <td className="px-2 py-2">
        <input
          value={item.descricao}
          onChange={(e) => onChange({ descricao: e.target.value })}
          placeholder="ex.: Omie, Google Workspace…"
          className={cn(INPUT_CLS, "py-1.5", descFaltando && "border-amber-500/60 focus:ring-amber-500")}
        />
        <div className="mt-1 flex items-center gap-2">
          <select
            value={item.origem}
            onChange={(e) => onChange({ origem: e.target.value === "mantido" ? "mantido" : "novo" })}
            className="rounded border bg-background px-1.5 py-0.5 text-[11px] outline-none"
          >
            <option value="mantido">mantido</option>
            <option value="novo">novo</option>
          </select>
          {item.fornecedor && (
            <span className="truncate text-[11px] text-muted-foreground" title={item.fornecedor}>
              {item.fornecedor}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        <CurrencyCell value={item.valorMensal} onCommit={(n) => onChange({ valorMensal: n })} />
      </td>
      <td className="px-2 py-2">
        <select
          value={item.mesInicio}
          onChange={(e) => onChange({ mesInicio: Number(e.target.value) })}
          className={cn(INPUT_CLS, "w-32 py-1.5")}
        >
          {MESES_LONGO.map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-start justify-end gap-2">
          <div>
            <span className="font-semibold tabular-nums">{formatBRL(totalItem)}</span>
            <div className="text-[11px] text-muted-foreground">
              {item.mesInicio > 1 ? `${MESES[item.mesInicio - 1]}–dez` : "ano todo"}
            </div>
          </div>
          <button
            type="button"
            onClick={onRemove}
            title="Remover item"
            className="mt-0.5 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </td>
    </tr>
  );
}

// ─── Painel de entrevista de UMA categoria ──────────────────────────────────

function CategoriaInterview({
  companyId,
  year,
  categoryCode,
  onBack,
  onSaved,
  onError,
}: {
  companyId: string;
  year: number;
  categoryCode: string;
  onBack: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [detalhe, setDetalhe] = useState<PlanejamentoCategoriaDetalhe | null>(null);
  const [loading, setLoading] = useState(true);

  const [conversa, setConversa] = useState<PlanejamentoMensagem[]>([]);
  const [itens, setItens] = useState<LocalItem[]>([]);
  const [justificativa, setJustificativa] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const seq = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  function toLocal(list: { descricao: string; valorMensal: number; mesInicio: number; origem: "mantido" | "novo"; fornecedor: string | null }[]): LocalItem[] {
    return list.map((it) => ({
      key: `it-${seq.current++}`,
      id: `it-${seq.current}`,
      descricao: it.descricao,
      valorMensal: it.valorMensal,
      mesInicio: it.mesInicio,
      origem: it.origem,
      fornecedor: it.fornecedor,
    }));
  }

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void getPlanejamentoCategoria(companyId, year, categoryCode).then((res) => {
      if (!alive) return;
      setLoading(false);
      if (res.needsMigration) {
        onError("Migration do Planejamento dos sócios ainda não aplicada.");
        return;
      }
      if (res.error || !res.detalhe) {
        onError(res.error ?? "Falha ao carregar a categoria.");
        return;
      }
      setDetalhe(res.detalhe);
      setConversa(res.detalhe.conversa);
      setItens(toLocal(res.detalhe.itens));
      setJustificativa(res.detalhe.justificativa ?? "");
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year, categoryCode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversa, sending]);

  async function enviar(texto: string) {
    setSending(true);
    setLocalErr(null);
    const res = await enviarMensagemPlanejamento(companyId, year, categoryCode, detalhe?.categoryName ?? categoryCode, conversa, texto);
    setSending(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.conversa) setConversa(res.conversa);
    if (res.proposta) {
      setItens(toLocal(res.proposta.itens.map((i) => ({
        descricao: i.descricao,
        valorMensal: i.valorMensal,
        mesInicio: i.mesInicio,
        origem: i.origem,
        fornecedor: i.fornecedor ?? null,
      }))));
      setJustificativa(res.proposta.justificativa);
    }
    if (res.error) setLocalErr(res.error);
  }

  function handleSend() {
    const t = input.trim();
    if (!t || sending) return;
    setInput("");
    void enviar(t);
  }

  function addItem(seed?: Partial<LocalItem>) {
    setItens((prev) => [
      ...prev,
      {
        key: `it-${seq.current++}`,
        id: `it-new-${seq.current}`,
        descricao: seed?.descricao ?? "",
        valorMensal: seed?.valorMensal ?? 0,
        mesInicio: seed?.mesInicio ?? 1,
        origem: seed?.origem ?? "novo",
        fornecedor: seed?.fornecedor ?? null,
      },
    ]);
  }

  function updateItem(key: string, partial: Partial<LocalItem>) {
    setItens((prev) => prev.map((it) => (it.key === key ? { ...it, ...partial } : it)));
  }

  function removeItem(key: string) {
    setItens((prev) => prev.filter((it) => it.key !== key));
  }

  async function salvar() {
    setSaving(true);
    setLocalErr(null);
    const res = await salvarPlanejamentoItens(
      companyId,
      year,
      categoryCode,
      detalhe?.categoryName ?? categoryCode,
      itens.map((i) => ({
        descricao: i.descricao,
        valorMensal: i.valorMensal,
        mesInicio: i.mesInicio,
        origem: i.origem,
        fornecedor: i.fornecedor,
      })),
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
    const res = await removerPlanejamentoSocios(companyId, year, categoryCode);
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    setConversa([]);
    setItens([]);
    setJustificativa("");
    setLocalErr(null);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-lg border p-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Carregando categoria…
      </div>
    );
  }
  if (!detalhe) return null;

  const total = categoriaTotal(itens);
  const conversaIniciada = conversa.length > 0;
  const temItens = itens.length > 0;
  const descFaltando = itens.some((i) => i.descricao.trim() === "");
  const selo: Selo =
    detalhe.status === "concluido" && temItens ? "concluido" : conversaIniciada || temItens ? "andamento" : "nao_iniciado";
  const r = detalhe.realizadoAnterior;
  const fornecedoresUsados = new Set(itens.map((i) => (i.fornecedor ?? "").toLowerCase()).filter(Boolean));

  return (
    <div className="space-y-4">
      {/* Cabeçalho */}
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
              <h3 className="text-lg font-semibold">{detalhe.categoryName}</h3>
              <StatusChip selo={selo} />
            </div>
            <p className="text-xs text-muted-foreground">
              {detalhe.categoryCode} · linha DRE {detalhe.dreLineCode} — {detalhe.dreLineName}
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

        {(conversaIniciada || temItens) &&
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
              <button type="button" onClick={() => setConfirmReset(false)} className="rounded-md border px-2 py-1">
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
        <div className="flex min-h-[28rem] flex-col rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
            <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            Entrevista com a IA
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" style={{ maxHeight: "26rem" }}>
            {!conversaIniciada && !sending && (
              <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
                <p className="max-w-xs text-sm text-muted-foreground">
                  A IA vai listar as plataformas pagas em {year - 1}, perguntar quais serão mantidas e se
                  há novas contratações — e propor os itens do orçamento de {year}.
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
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm",
                    m.role === "user" ? "bg-emerald-600 text-white" : "bg-muted text-foreground",
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

        {/* Itens do orçamento */}
        <div className="flex flex-col rounded-lg border">
          <div className="flex items-center justify-between border-b bg-muted/30 px-3 py-2 text-sm font-medium">
            <span>Itens do orçamento {year}</span>
            <button
              type="button"
              onClick={() => addItem()}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> item
            </button>
          </div>

          <div className="flex-1 space-y-3 p-3">
            {/* Referência do ano anterior (plataformas já pagas) */}
            {detalhe.realizadoItens.length > 0 && (
              <div className="rounded-md border bg-muted/20 p-2">
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Pagas em {year - 1} — clique para adicionar
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {detalhe.realizadoItens.map((ri, i) => {
                    const jaUsado = fornecedoresUsados.has(ri.fornecedor.toLowerCase());
                    return (
                      <button
                        key={i}
                        type="button"
                        disabled={jaUsado}
                        onClick={() =>
                          addItem({
                            descricao: ri.fornecedor,
                            valorMensal: Math.round((ri.total / 12) * 100) / 100,
                            mesInicio: 1,
                            origem: "mantido",
                            fornecedor: ri.fornecedor,
                          })
                        }
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]",
                          jaUsado
                            ? "opacity-40"
                            : "hover:border-emerald-500/50 hover:bg-emerald-500/5",
                        )}
                        title={`${formatBRL(ri.total)} no ano · ${ri.lancamentos} lançamento(s)`}
                      >
                        {!jaUsado && <Plus className="h-3 w-3" />}
                        {ri.fornecedor} · {formatBRL(ri.total / 12)}/mês
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {itens.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                Nenhum item ainda. Rode a entrevista para a IA propor, use as plataformas do ano anterior
                acima, ou adicione com <span className="font-medium">+ item</span>.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 font-medium">Item</th>
                      <th className="px-2 py-1 font-medium">Valor/mês</th>
                      <th className="px-2 py-1 font-medium">Início</th>
                      <th className="px-2 py-1 text-right font-medium">Ano</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {itens.map((it) => (
                      <ItemRow
                        key={it.key}
                        item={it}
                        onChange={(partial) => updateItem(it.key, partial)}
                        onRemove={() => removeItem(it.key)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {descFaltando && (
              <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                <TriangleAlert className="h-3 w-3" />
                Todos os itens precisam de descrição para salvar.
              </div>
            )}

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">Total da categoria ({year})</span>
              <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Justificativa / premissas</label>
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
              disabled={saving || total <= 0 || descFaltando}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Salvar orçamento da categoria
            </button>
            {total <= 0 && (
              <p className="mt-1 text-center text-[11px] text-muted-foreground">
                Adicione ao menos um item com valor para salvar.
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
  const [items, setItems] = useState<PlanejamentoListItem[]>([]);
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

  if (selected) {
    return (
      <CategoriaInterview
        companyId={companyId}
        year={year}
        categoryCode={selected}
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
              const selo: Selo =
                item.status === "concluido" && item.itemCount > 0
                  ? "concluido"
                  : item.iniciado
                    ? "andamento"
                    : "nao_iniciado";
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
                      {item.itemCount > 0
                        ? `${item.itemCount} item(ns)`
                        : item.realizadoAnterior && item.realizadoAnterior.media != null
                          ? `${year - 1}: ${formatBRL(item.realizadoAnterior.media)}/mês`
                          : `sem realizado ${year - 1}`}
                    </span>
                    {item.totalOrcado > 0 ? (
                      <span className="font-semibold tabular-nums">{formatBRL(item.totalOrcado)}</span>
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
