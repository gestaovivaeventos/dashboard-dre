"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Circle,
  CircleDot,
  ListChecks,
  Loader2,
  Plus,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Trash2,
  TriangleAlert,
  X,
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
  totalItem,
  type Periodicidade,
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
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium", map.cls)}>
      <Icon className="h-3 w-3" />
      {map.label}
    </span>
  );
}

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

interface LocalItem extends PlanejamentoItem {
  key: string;
}

interface RefInfo {
  media: number | null;
  total: number;
  lancamentos: number;
}

// ─── Linha do editor (um item) ──────────────────────────────────────────────

function ItemRow({
  item,
  refInfo,
  onChange,
  onRemove,
}: {
  item: LocalItem;
  refInfo: RefInfo | null;
  onChange: (partial: Partial<LocalItem>) => void;
  onRemove: (() => void) | null;
}) {
  const descFaltando = item.incluir && item.descricao.trim() === "";
  const anual = item.periodicidade === "anual";
  const total = totalItem(item.valorMensal, item.mesInicio, item.periodicidade);
  return (
    <tr className={cn("align-top", !item.incluir && "opacity-50")}>
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={item.incluir}
          onChange={() => onChange({ incluir: !item.incluir })}
          className="h-4 w-4 accent-emerald-600"
          title={item.incluir ? "Incluído no orçamento" : "Fora do orçamento"}
        />
      </td>
      <td className="px-2 py-2">
        <input
          value={item.descricao}
          onChange={(e) => onChange({ descricao: e.target.value })}
          placeholder="ex.: Trello, Microsoft…"
          className={cn(INPUT_CLS, "py-1.5", descFaltando && "border-amber-500/60 focus:ring-amber-500")}
        />
        <div className="mt-1 flex items-center gap-2">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10px] font-medium",
              item.origem === "mantido"
                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "bg-sky-500/10 text-sky-600 dark:text-sky-400",
            )}
          >
            {item.origem === "mantido" ? "mantido" : "novo"}
          </span>
          {item.fornecedor && item.fornecedor.toLowerCase() !== item.descricao.trim().toLowerCase() && (
            <span className="truncate text-[11px] text-muted-foreground" title={`Omie: ${item.fornecedor}`}>
              Omie: {item.fornecedor}
            </span>
          )}
        </div>
      </td>
      <td className="px-2 py-2">
        <CurrencyCell value={item.valorMensal} onCommit={(n) => onChange({ valorMensal: n })} />
      </td>
      <td className="px-2 py-2">
        <select
          value={item.periodicidade}
          onChange={(e) => onChange({ periodicidade: e.target.value === "anual" ? "anual" : "mensal" })}
          className={cn(INPUT_CLS, "w-24 py-1.5")}
        >
          <option value="mensal">mensal</option>
          <option value="anual">anual</option>
        </select>
      </td>
      <td className="px-2 py-2">
        <select
          value={item.mesInicio}
          onChange={(e) => onChange({ mesInicio: Number(e.target.value) })}
          className={cn(INPUT_CLS, "w-32 py-1.5")}
          title={anual ? "Mês da renovação" : "Mês de início"}
        >
          {MESES_LONGO.map((m, i) => (
            <option key={i} value={i + 1}>
              {m}
            </option>
          ))}
        </select>
      </td>
      <td className="px-2 py-2 text-right text-xs tabular-nums text-muted-foreground">
        {refInfo ? (
          <>
            <div>{refInfo.media == null ? "—" : `${formatBRL(refInfo.media)}/mês`}</div>
            <div className="text-[10px]">total {formatBRL(refInfo.total)}</div>
          </>
        ) : (
          "—"
        )}
      </td>
      <td className="px-2 py-2 text-right">
        <div className="flex items-start justify-end gap-2">
          <div>
            <span className="font-semibold tabular-nums">{formatBRL(total)}</span>
            <div className="text-[11px] text-muted-foreground">
              {anual ? `1×/ano em ${MESES[item.mesInicio - 1]}` : item.mesInicio > 1 ? `${MESES[item.mesInicio - 1]}–dez` : "ano todo"}
            </div>
          </div>
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              title="Remover item"
              className="mt-0.5 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
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
  isAdmin,
  onBack,
  onSaved,
  onError,
}: {
  companyId: string;
  year: number;
  categoryCode: string;
  isAdmin: boolean;
  onBack: () => void;
  onSaved: () => void;
  onError: (msg: string) => void;
}) {
  const [detalhe, setDetalhe] = useState<PlanejamentoCategoriaDetalhe | null>(null);
  const [loading, setLoading] = useState(true);

  const [conversa, setConversa] = useState<PlanejamentoMensagem[]>([]);
  const [itens, setItens] = useState<LocalItem[]>([]);
  const [refMap, setRefMap] = useState<Map<string, RefInfo>>(new Map());
  const [justificativa, setJustificativa] = useState("");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useState(false);
  const [localErr, setLocalErr] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [statusLocal, setStatusLocal] = useState<"rascunho" | "concluido">("rascunho");
  const seq = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Semeia as linhas: itens já salvos + fornecedores do ano anterior ainda não
  // virados item (a lista fica completa; o admin inclui/exclui e edita).
  function seedFrom(d: PlanejamentoCategoriaDetalhe) {
    const ref = new Map<string, RefInfo>();
    d.realizadoItens.forEach((ri) =>
      ref.set(ri.fornecedor.toLowerCase(), { media: ri.media, total: ri.total, lancamentos: ri.lancamentos }),
    );
    const usados = new Set(d.itens.map((i) => (i.fornecedor ?? "").toLowerCase()).filter(Boolean));
    const persistidos: LocalItem[] = d.itens.map((i) => ({ ...i, key: `it-${seq.current++}` }));
    const novos: LocalItem[] = d.realizadoItens
      .filter((ri) => !usados.has(ri.fornecedor.toLowerCase()))
      .map((ri) => ({
        key: `it-${seq.current++}`,
        id: `seed-${seq.current}`,
        descricao: ri.fornecedor,
        valorMensal: ri.media != null ? Math.round(ri.media * 100) / 100 : 0,
        mesInicio: 1,
        periodicidade: "mensal" as Periodicidade,
        origem: "mantido" as const,
        fornecedor: ri.fornecedor,
        incluir: true,
      }));
    setRefMap(ref);
    setItens([...persistidos, ...novos]);
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
      setJustificativa(res.detalhe.justificativa ?? "");
      setStatusLocal(res.detalhe.status);
      seedFrom(res.detalhe);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year, categoryCode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversa, sending]);

  const incluidos = useMemo(() => itens.filter((i) => i.incluir), [itens]);
  const total = categoriaTotal(incluidos);

  async function enviar(texto: string) {
    setSending(true);
    setLocalErr(null);
    const res = await enviarMensagemPlanejamento(
      companyId,
      year,
      categoryCode,
      detalhe?.categoryName ?? categoryCode,
      conversa,
      texto,
      incluidos.map((i) => ({ descricao: i.descricao, valorMensal: i.valorMensal, periodicidade: i.periodicidade })),
    );
    setSending(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.conversa) setConversa(res.conversa);
    if (res.proposta) mergeProposta(res.proposta.itens, res.proposta.justificativa);
    if (res.error) setLocalErr(res.error);
  }

  // Aplica a proposta da IA SEM apagar a curadoria: atualiza a linha existente
  // (por descrição/fornecedor) ou acrescenta uma nova; marca como incluída.
  function mergeProposta(
    propostos: {
      descricao: string;
      valorMensal: number;
      mesInicio: number;
      periodicidade: Periodicidade;
      origem: "mantido" | "novo";
      fornecedor?: string | null;
    }[],
    just: string,
  ) {
    setItens((prev) => {
      const next = [...prev];
      const norm = (s: string) => s.trim().toLowerCase();
      propostos.forEach((p) => {
        const idx = next.findIndex(
          (r) =>
            norm(r.descricao) === norm(p.descricao) ||
            (p.fornecedor && r.fornecedor && norm(r.fornecedor) === norm(p.fornecedor)),
        );
        if (idx >= 0) {
          next[idx] = {
            ...next[idx],
            valorMensal: p.valorMensal,
            mesInicio: p.mesInicio,
            periodicidade: p.periodicidade,
            origem: p.origem,
            incluir: true,
          };
        } else {
          next.push({
            key: `it-${seq.current++}`,
            id: `ai-${seq.current}`,
            descricao: p.descricao,
            valorMensal: p.valorMensal,
            mesInicio: p.mesInicio,
            periodicidade: p.periodicidade,
            origem: p.origem,
            fornecedor: p.fornecedor ?? null,
            incluir: true,
          });
        }
      });
      return next;
    });
    if (just) setJustificativa(just);
  }

  function handleSend() {
    const t = input.trim();
    if (!t || sending) return;
    setInput("");
    void enviar(t);
  }

  function addItem() {
    setItens((prev) => [
      ...prev,
      {
        key: `it-${seq.current++}`,
        id: `new-${seq.current}`,
        descricao: "",
        valorMensal: 0,
        mesInicio: 1,
        periodicidade: "mensal",
        origem: "novo",
        fornecedor: null,
        incluir: true,
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
        periodicidade: i.periodicidade,
        origem: i.origem,
        fornecedor: i.fornecedor,
        incluir: i.incluir,
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
    setStatusLocal("concluido");
    setShowEditor(false);
    onSaved();
  }

  async function recomecar() {
    setConfirmReset(false);
    const res = await removerPlanejamentoSocios(companyId, year, categoryCode);
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    if (detalhe) {
      setConversa([]);
      setJustificativa("");
      setStatusLocal("rascunho");
      // ressemeia a partir do realizado (curadoria limpa)
      seedFrom({ ...detalhe, itens: [], conversa: [], justificativa: null });
    }
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

  const conversaIniciada = conversa.length > 0;
  const descFaltando = incluidos.some((i) => i.descricao.trim() === "");
  const selo: Selo =
    statusLocal === "concluido" && incluidos.length > 0
      ? "concluido"
      : conversaIniciada || itens.some((i) => i.incluir)
        ? "andamento"
        : "nao_iniciado";
  const r = detalhe.realizadoAnterior;

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

        {isAdmin &&
          (conversaIniciada || statusLocal === "concluido") &&
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

      {/* Etapa do admin: botão-destaque que abre a base da entrevista (modal). */}
      {isAdmin && (
        <button
          type="button"
          onClick={() => setShowEditor(true)}
          className={cn(
            "group flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
            statusLocal === "concluido"
              ? "border-emerald-500/40 bg-emerald-500/5 hover:bg-emerald-500/10"
              : "border-amber-500/60 bg-amber-500/5 hover:bg-amber-500/10",
          )}
        >
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
              statusLocal === "concluido"
                ? "bg-emerald-600/10 text-emerald-600 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-600 dark:text-amber-500",
            )}
          >
            <ListChecks className="h-5 w-5" strokeWidth={1.75} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">Pagos em {year - 1} — o que a IA deve considerar</span>
              <span
                className={cn(
                  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  statusLocal === "concluido"
                    ? "border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    : "border-amber-500/50 text-amber-600 dark:text-amber-500",
                )}
              >
                {statusLocal === "concluido" ? "revisado" : "etapa do admin — comece aqui"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {incluidos.length > 0
                ? `${incluidos.length} item(ns) marcados · ${formatBRL(total)} no ano — clique para revisar/editar`
                : `Revise os pagamentos de ${year - 1} e monte a base antes de conversar com a IA`}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
      )}

      {/* Modal (admin): a base — pagos em {ano-1} + itens novos. */}
      {isAdmin && showEditor && (
        <div
          className="fixed inset-0 z-50 flex overflow-y-auto bg-black/50 p-4 sm:p-6"
          onClick={() => setShowEditor(false)}
        >
          <div
            className="m-auto w-full max-w-5xl rounded-lg border bg-background shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3">
              <div>
                <p className="text-sm font-semibold">Pagos em {year - 1} — o que a IA deve considerar</p>
                <p className="text-xs text-muted-foreground">
                  Marque o que entra no orçamento, ajuste o nome, valor, período e mês. O total é a soma
                  dos itens marcados.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={addItem}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Plus className="h-3.5 w-3.5" /> item novo
                </button>
                <button
                  type="button"
                  onClick={() => setShowEditor(false)}
                  title="Fechar"
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            <div className="max-h-[68vh] space-y-3 overflow-y-auto p-4">
            {itens.length === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
                Nenhum pagamento encontrado em {year - 1} nesta categoria. Adicione itens com{" "}
                <span className="font-medium">+ item novo</span> ou rode a entrevista.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1 text-center font-medium">Incluir</th>
                      <th className="px-2 py-1 font-medium">Item</th>
                      <th className="px-2 py-1 font-medium">Valor</th>
                      <th className="px-2 py-1 font-medium">Período</th>
                      <th className="px-2 py-1 font-medium">Início/Renov.</th>
                      <th className="px-2 py-1 text-right font-medium">Ref. {year - 1}</th>
                      <th className="px-2 py-1 text-right font-medium">Ano</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {itens.map((it) => (
                      <ItemRow
                        key={it.key}
                        item={it}
                        refInfo={it.fornecedor ? refMap.get(it.fornecedor.toLowerCase()) ?? null : null}
                        onChange={(partial) => updateItem(it.key, partial)}
                        onRemove={it.origem === "novo" ? () => removeItem(it.key) : null}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {descFaltando && (
              <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                <TriangleAlert className="h-3 w-3" />
                Todo item incluído precisa de descrição para salvar.
              </div>
            )}

            <div className="flex items-center justify-between rounded-md bg-muted/40 px-3 py-2 text-sm">
              <span className="text-muted-foreground">
                Total da categoria ({year}) · {incluidos.length} item(ns)
              </span>
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

            <div className="flex flex-wrap items-center justify-end gap-2 border-t px-4 py-3">
              {total <= 0 && (
                <span className="mr-auto text-[11px] text-muted-foreground">
                  Marque ao menos um item com valor para salvar.
                </span>
              )}
              <button
                type="button"
                onClick={() => setShowEditor(false)}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={salvar}
                disabled={saving || total <= 0 || descFaltando}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
              >
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Salvar orçamento da categoria
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tela principal: a Entrevista com a IA (todos veem). */}
      <div className="flex min-h-[30rem] flex-col rounded-lg border">
        <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
          <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
          Entrevista com a IA
        </div>

        <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" style={{ maxHeight: "26rem" }}>
          {!conversaIniciada && !sending && (
            <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
              <p className="max-w-md text-sm text-muted-foreground">
                {isAdmin
                  ? "A IA usa os itens marcados na base (botão acima), confirma quais serão mantidos (mensal ou anual) e se há novas contratações — e devolve a proposta lá."
                  : "A IA vai perguntar quais serviços serão mantidos (mensal ou anual) e se há novas contratações para montar o orçamento do ano."}
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
    </div>
  );
}

// ─── Manager (lista + seleção) ──────────────────────────────────────────────

export function PlanejamentoSociosManager({
  companyId,
  year,
  isAdmin = true,
}: {
  companyId: string;
  year: number;
  isAdmin?: boolean;
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
          Aplique as migrations do Planejamento dos sócios (
          <code className="rounded bg-muted px-1 py-0.5">20260825120000</code>,{" "}
          <code className="rounded bg-muted px-1 py-0.5">20260826120000</code> e{" "}
          <code className="rounded bg-muted px-1 py-0.5">20260827120000</code>) para habilitar esta tela.
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
        isAdmin={isAdmin}
        onBack={() => {
          setSelected(null);
          void reload();
        }}
        onSaved={() => void reload()}
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
