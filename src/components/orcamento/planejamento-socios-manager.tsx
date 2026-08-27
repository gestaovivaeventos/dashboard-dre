"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  CircleDot,
  Lock,
  Loader2,
  MessageSquare,
  Pencil,
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
  salvarBasePlanejamento,
  confirmarPropostaPlanejamento,
  editarPropostaPlanejamento,
  reiniciarConversaPlanejamento,
  type PlanejamentoListItem,
  type PlanejamentoCategoriaDetalhe,
} from "@/lib/orcamento/actions/planejamento-socios";
import {
  categoriaTotal,
  totalItem,
  type Periodicidade,
  type PlanejamentoMensagem,
  type PlanejamentoItem,
  type PlanejamentoProposta,
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
      label: "Confirmado",
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
  const total = totalItem(item.valorMensal, item.mesInicio, item.periodicidade, item.mesFim);
  const fim = item.mesFim != null && item.mesFim >= 1 && item.mesFim <= 12 ? item.mesFim : null;
  const rangeLabel = anual
    ? `1×/ano em ${MESES[item.mesInicio - 1]}`
    : fim != null && fim < 12
      ? `${MESES[item.mesInicio - 1]}–${MESES[fim - 1]} (cancela)`
      : item.mesInicio > 1
        ? `${MESES[item.mesInicio - 1]}–dez`
        : "ano todo";
  return (
    <tr className={cn("align-top", !item.incluir && "opacity-50")}>
      <td className="px-2 py-2 text-center">
        <input
          type="checkbox"
          checked={item.incluir}
          onChange={() => onChange({ incluir: !item.incluir })}
          className="h-4 w-4 accent-emerald-600"
          title={item.incluir ? "Incluído" : "Fora"}
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
        {!anual && (
          <select
            value={fim ?? 0}
            onChange={(e) => {
              const n = Number(e.target.value);
              onChange({ mesFim: n === 0 ? null : n });
            }}
            className={cn(INPUT_CLS, "mt-1 w-32 py-1.5 text-xs")}
            title="Último mês pago (cancelamento no meio do ano)"
          >
            <option value={0}>até dezembro</option>
            {MESES_LONGO.map((m, i) => (
              <option key={i} value={i + 1}>
                até {m}
              </option>
            ))}
          </select>
        )}
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
            <div className="text-[11px] text-muted-foreground">{rangeLabel}</div>
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

// ─── Tabela editável de itens (usada na Etapa 1 e na edição da proposta) ──────

function ItensTable({
  itens,
  refMap,
  year,
  onChange,
  onRemove,
  onAdd,
}: {
  itens: LocalItem[];
  refMap: Map<string, RefInfo>;
  year: number;
  onChange: (key: string, partial: Partial<LocalItem>) => void;
  onRemove: (key: string) => void;
  onAdd: () => void;
}) {
  return (
    <div className="space-y-2">
      {itens.length === 0 ? (
        <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
          Nenhum item. Adicione com <span className="font-medium">+ item</span>.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr className="border-b">
                <th className="px-2 py-1.5 text-center font-medium">Incluir</th>
                <th className="px-2 py-1.5 font-medium">Item</th>
                <th className="px-2 py-1.5 font-medium">Valor</th>
                <th className="px-2 py-1.5 font-medium">Período</th>
                <th className="px-2 py-1.5 font-medium">Início/Renov.</th>
                <th className="px-2 py-1.5 text-right font-medium">Ref. {year - 1}</th>
                <th className="px-2 py-1.5 text-right font-medium">Ano</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {itens.map((it) => (
                <ItemRow
                  key={it.key}
                  item={it}
                  refInfo={it.fornecedor ? refMap.get(it.fornecedor.toLowerCase()) ?? null : null}
                  onChange={(partial) => onChange(it.key, partial)}
                  onRemove={() => onRemove(it.key)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button
        type="button"
        onClick={onAdd}
        className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
      >
        <Plus className="h-3.5 w-3.5" /> item
      </button>
    </div>
  );
}

// ─── Card da proposta (somente leitura) ─────────────────────────────────────

function PropostaCard({ proposta, year }: { proposta: PlanejamentoProposta; year: number }) {
  const total = categoriaTotal(
    proposta.itens.map((i) => ({
      valorMensal: i.valorMensal,
      mesInicio: i.mesInicio,
      periodicidade: i.periodicidade,
      mesFim: i.mesFim ?? null,
    })),
  );
  return (
    <div className="rounded-lg border border-emerald-500/40 bg-emerald-50/60 p-3 dark:bg-emerald-950/20">
      <ul className="divide-y divide-emerald-500/15 text-sm">
        {proposta.itens.map((it, idx) => {
          const mes = MESES_LONGO[Math.min(12, Math.max(1, it.mesInicio)) - 1];
          const fimIt = it.mesFim != null && it.mesFim >= 1 && it.mesFim <= 12 ? it.mesFim : null;
          const cancela =
            it.periodicidade !== "anual" && fimIt != null && fimIt < 12
              ? ` · até ${MESES_LONGO[fimIt - 1]} (cancela)`
              : "";
          const quando =
            it.periodicidade === "anual"
              ? `${formatBRL(it.valorMensal)}/ano · pago em ${mes}`
              : `${formatBRL(it.valorMensal)}/mês · a partir de ${mes}${cancela}`;
          return (
            <li key={idx} className="flex items-baseline justify-between gap-3 py-1.5">
              <div className="min-w-0">
                <div className="truncate font-medium">{it.descricao || "—"}</div>
                <div className="text-xs text-muted-foreground">{quando}</div>
              </div>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatBRL(totalItem(it.valorMensal, it.mesInicio, it.periodicidade, it.mesFim ?? null))}
              </span>
            </li>
          );
        })}
      </ul>
      <div className="mt-2 flex items-center justify-between border-t border-emerald-500/20 pt-2 text-sm">
        <span className="font-medium text-muted-foreground">Total da categoria ({year})</span>
        <span className="font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{formatBRL(total)}</span>
      </div>
      {proposta.justificativa.trim() && (
        <p className="mt-2 border-t border-emerald-500/20 pt-2 text-xs text-muted-foreground">
          <span className="font-medium">Justificativa:</span> {proposta.justificativa.trim()}
        </p>
      )}
    </div>
  );
}

// ─── Passo do fluxo (stepper vertical) ──────────────────────────────────────

type StepState = "locked" | "active" | "done";

function Step({
  n,
  title,
  description,
  state,
  last,
  chip,
  children,
}: {
  n: number;
  title: string;
  description: string;
  state: StepState;
  last?: boolean;
  chip?: React.ReactNode;
  children: React.ReactNode;
}) {
  const done = state === "done";
  const locked = state === "locked";
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-sm font-semibold",
            done && "border-emerald-500/50 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
            state === "active" && "border-emerald-500/60 bg-emerald-600 text-white",
            locked && "border-border bg-muted text-muted-foreground",
          )}
        >
          {done ? <CheckCircle2 className="h-5 w-5" /> : locked ? <Lock className="h-4 w-4" /> : n}
        </div>
        {!last && <div className="my-1 w-px flex-1 bg-border" />}
      </div>
      <div className={cn("min-w-0 flex-1 pb-8", locked && "opacity-70")}>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-base font-semibold">
            {n}. {title}
          </h3>
          {chip}
        </div>
        <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

// ─── Painel de UMA categoria (fluxo em 3 etapas) ────────────────────────────

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

  // ETAPA 1 — base
  const [baseItens, setBaseItens] = useState<LocalItem[]>([]);
  const [refMap, setRefMap] = useState<Map<string, RefInfo>>(new Map());
  const [baseSalva, setBaseSalva] = useState(false);
  const [baseEdit, setBaseEdit] = useState(false);
  const [savingBase, setSavingBase] = useState(false);
  const [contextoAdmin, setContextoAdmin] = useState("");
  const baseRef = useRef<LocalItem[]>([]);

  // ETAPA 2 — entrevista
  const [conversa, setConversa] = useState<PlanejamentoMensagem[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [podeFechar, setPodeFechar] = useState(false);

  // ETAPA 3 — proposta
  const [proposta, setProposta] = useState<PlanejamentoProposta | null>(null);
  const [propostaConfirmada, setPropostaConfirmada] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [propostaEdit, setPropostaEdit] = useState<LocalItem[] | null>(null);
  const [propostaEditJust, setPropostaEditJust] = useState("");
  const [savingProposta, setSavingProposta] = useState(false);

  const [localErr, setLocalErr] = useState<string | null>(null);
  const seq = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    baseRef.current = baseItens;
  }, [baseItens]);

  // Semeia a base: itens já salvos + fornecedores do ano anterior ainda não
  // virados item (a lista fica completa; o admin inclui/exclui e edita).
  function seedBase(d: PlanejamentoCategoriaDetalhe) {
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
        mesFim: null,
        periodicidade: "mensal" as Periodicidade,
        origem: "mantido" as const,
        fornecedor: ri.fornecedor,
        incluir: true,
      }));
    setRefMap(ref);
    setBaseItens([...persistidos, ...novos]);
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
      const d = res.detalhe;
      setDetalhe(d);
      seedBase(d);
      setBaseSalva(d.baseSalva);
      setContextoAdmin(d.contextoAdmin);
      setBaseEdit(!d.baseSalva); // sem base salva → abre o editor; salva → colapsa
      setConversa(d.conversa);
      setProposta(d.proposta);
      setPropostaConfirmada(d.propostaConfirmada);
      setPodeFechar(d.proposta != null);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, year, categoryCode]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [conversa, sending]);

  const baseIncluidos = useMemo(() => baseItens.filter((i) => i.incluir), [baseItens]);
  const baseTotal = categoriaTotal(baseIncluidos);
  const baseDescFaltando = baseIncluidos.some((i) => i.descricao.trim() === "");

  // ── Etapa 1: CRUD da base ──────────────────────────────────────────────────
  function updateBaseItem(key: string, partial: Partial<LocalItem>) {
    setBaseItens((prev) => prev.map((it) => (it.key === key ? { ...it, ...partial } : it)));
  }
  function removeBaseItem(key: string) {
    setBaseItens((prev) => prev.filter((it) => it.key !== key));
  }
  function addBaseItem() {
    setBaseItens((prev) => [
      ...prev,
      {
        key: `it-${seq.current++}`,
        id: `new-${seq.current}`,
        descricao: "",
        valorMensal: 0,
        mesInicio: 1,
        mesFim: null,
        periodicidade: "mensal",
        origem: "novo",
        fornecedor: null,
        incluir: true,
      },
    ]);
  }

  async function salvarBase() {
    // A base pode ser VAZIA (categorias sem contratos prévios, ex.: Consultoria e
    // Treinamento) — a entrevista vira aberta. Só exigimos descrição do que existe.
    if (baseDescFaltando) {
      setLocalErr("Todo item incluído precisa de descrição.");
      return;
    }
    setSavingBase(true);
    setLocalErr(null);
    const res = await salvarBasePlanejamento(
      companyId,
      year,
      categoryCode,
      detalhe?.categoryName ?? categoryCode,
      baseItens.map((i) => ({
        descricao: i.descricao,
        valorMensal: i.valorMensal,
        mesInicio: i.mesInicio,
        mesFim: i.mesFim,
        periodicidade: i.periodicidade,
        origem: i.origem,
        fornecedor: i.fornecedor,
        incluir: i.incluir,
      })),
      contextoAdmin,
    );
    setSavingBase(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    setBaseSalva(true);
    setBaseEdit(false);
    onSaved();
  }

  // ── Etapa 2: entrevista ────────────────────────────────────────────────────
  async function enviar(texto: string, finalizar = false) {
    setSending(true);
    setLocalErr(null);
    const res = await enviarMensagemPlanejamento(
      companyId,
      year,
      categoryCode,
      detalhe?.categoryName ?? categoryCode,
      conversa,
      texto,
      baseRef.current
        .filter((i) => i.incluir)
        .map((i) => ({
          descricao: i.descricao,
          valorMensal: i.valorMensal,
          periodicidade: i.periodicidade,
          mesInicio: i.mesInicio,
          mesFim: i.mesFim,
        })),
      finalizar,
      // Contexto fixo do prompt (linha DRE + realizado ano-1) que já temos —
      // evita a IA reconsultar catálogo/Omie a cada mensagem.
      detalhe
        ? {
            dreLineCode: detalhe.dreLineCode,
            dreLineName: detalhe.dreLineName,
            realizadoTotal: detalhe.realizadoAnterior?.total ?? 0,
            realizadoMedia: detalhe.realizadoAnterior?.media ?? null,
          }
        : undefined,
    );
    setSending(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.conversa) setConversa(res.conversa);
    setPodeFechar(res.podeFechar === true);
    if (res.proposta) {
      // A proposta é a saída da entrevista (já persistida no servidor). Ela
      // SUBSTITUI a anterior — nada de merge com a base.
      setProposta(res.proposta);
      setPropostaConfirmada(false);
    }
    if (res.error) setLocalErr(res.error);
  }

  function handleSend() {
    const t = input.trim();
    if (!t || sending) return;
    setInput("");
    void enviar(t);
  }

  async function recomecar() {
    setConfirmReset(false);
    const res = await reiniciarConversaPlanejamento(companyId, year, categoryCode);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    setConversa([]);
    setProposta(null);
    setPropostaConfirmada(false);
    setPropostaEdit(null);
    setPodeFechar(false);
    setLocalErr(null);
    onSaved();
  }

  // ── Etapa 3: confirmar / editar proposta ───────────────────────────────────
  async function confirmar() {
    setConfirming(true);
    setLocalErr(null);
    const res = await confirmarPropostaPlanejamento(companyId, year, categoryCode);
    setConfirming(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    setPropostaConfirmada(true);
    onSaved();
  }

  function abrirEdicaoProposta() {
    if (!proposta) return;
    setPropostaEditJust(proposta.justificativa);
    setPropostaEdit(
      proposta.itens.map((it) => ({
        key: `pe-${seq.current++}`,
        id: `pe-${seq.current}`,
        descricao: it.descricao,
        valorMensal: it.valorMensal,
        mesInicio: it.mesInicio,
        mesFim: it.mesFim ?? null,
        periodicidade: it.periodicidade,
        origem: it.origem,
        fornecedor: it.fornecedor ?? null,
        incluir: true,
      })),
    );
  }

  async function salvarEdicaoProposta() {
    if (!propostaEdit) return;
    const itens = propostaEdit.filter((i) => i.incluir && i.descricao.trim() !== "");
    if (itens.length === 0) {
      setLocalErr("A proposta precisa de ao menos um item.");
      return;
    }
    setSavingProposta(true);
    setLocalErr(null);
    const payload = itens.map((i) => ({
      descricao: i.descricao,
      valorMensal: i.valorMensal,
      mesInicio: i.mesInicio,
      mesFim: i.mesFim,
      periodicidade: i.periodicidade,
      origem: i.origem,
      fornecedor: i.fornecedor,
    }));
    const res = await editarPropostaPlanejamento(companyId, year, categoryCode, payload, propostaEditJust);
    setSavingProposta(false);
    if (res.needsMigration) {
      onError("Migration do Planejamento dos sócios ainda não aplicada.");
      return;
    }
    if (res.error) {
      setLocalErr(res.error);
      return;
    }
    setProposta({ itens: payload, justificativa: propostaEditJust });
    setPropostaEdit(null);
    onSaved();
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

  const step1State: StepState = baseSalva ? "done" : "active";
  const step2State: StepState = !baseSalva ? "locked" : "active";
  const step3State: StepState = !proposta ? "locked" : propostaConfirmada ? "done" : "active";
  const conversaIniciada = conversa.length > 0;
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
            <h3 className="text-lg font-semibold">{detalhe.categoryName}</h3>
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
      </div>

      {localErr && (
        <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{localErr}</div>
      )}

      {/* ─── Fluxo em etapas ─── */}
      <div className="rounded-lg border p-4 sm:p-5">
        {/* ETAPA 1 — Base */}
        <Step
          n={1}
          title={`Pagos em ${year - 1} — o que a IA deve considerar`}
          description="O administrador valida a base de itens. Após salvar, ela alimenta a entrevista. Não vira orçamento — é só a fonte de informação da IA."
          state={step1State}
          chip={
            baseSalva ? (
              <StatusChip selo="concluido" />
            ) : (
              <span className="inline-flex items-center rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-500">
                a validar
              </span>
            )
          }
        >
          {!isAdmin ? (
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              {baseSalva
                ? baseIncluidos.length > 0
                  ? `Base definida pelo administrador: ${baseIncluidos.length} item(ns).`
                  : "Base validada sem itens prévios — a IA fará uma entrevista aberta."
                : "Aguardando o administrador validar a base."}
            </div>
          ) : baseSalva && !baseEdit ? (
            <div className="space-y-2 rounded-md border bg-emerald-500/5 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-muted-foreground">
                  {baseIncluidos.length > 0 ? (
                    <>
                      {baseIncluidos.length} item(ns) marcados · referência de {formatBRL(baseTotal)}/ano.{" "}
                    </>
                  ) : (
                    <>Sem itens prévios — a entrevista será aberta. </>
                  )}
                  <span className="font-medium text-emerald-600 dark:text-emerald-400">Base validada.</span>
                </span>
                <button
                  type="button"
                  onClick={() => setBaseEdit(true)}
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Pencil className="h-3.5 w-3.5" /> Editar base
                </button>
              </div>
              {contextoAdmin.trim() !== "" && (
                <div className="flex items-start gap-1.5 rounded-md border border-emerald-500/20 bg-background/60 p-2 text-xs text-muted-foreground">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>
                    <span className="font-medium text-foreground">Contexto para a IA:</span> {contextoAdmin.trim()}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <ItensTable
                itens={baseItens}
                refMap={refMap}
                year={year}
                onChange={updateBaseItem}
                onRemove={removeBaseItem}
                onAdd={addBaseItem}
              />
              <div className="space-y-1">
                <label className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                  Contexto para a IA <span className="font-normal">(opcional)</span>
                </label>
                <textarea
                  value={contextoAdmin}
                  onChange={(e) => setContextoAdmin(e.target.value)}
                  rows={3}
                  placeholder="Direcionamento extra que a IA deve considerar antes de entrevistar o gestor — ex.: “vamos trocar o fornecedor de limpeza em março”, “não renovar o contrato X”, “teto de R$ 5.000/mês nesta categoria”."
                  className="w-full resize-y rounded-md border bg-background p-2.5 text-sm outline-none focus:ring-2 focus:ring-emerald-500/40"
                />
                <p className="text-[11px] text-muted-foreground">
                  Se preenchido, a IA lê e interpreta este texto <b>antes</b> de conduzir a entrevista, mantendo as
                  perguntas condizentes com ele.
                </p>
              </div>
              {baseIncluidos.length === 0 && (
                <p className="rounded-md border border-dashed bg-muted/20 p-2 text-[11px] text-muted-foreground">
                  Categoria sem contratos/assinaturas prévios? Pode validar a base <b>vazia</b> — a IA fará
                  uma <b>entrevista aberta</b>, perguntando se o gestor pretende contratar algo.
                </p>
              )}
              {baseDescFaltando && (
                <div className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-500">
                  <TriangleAlert className="h-3 w-3" />
                  Todo item incluído precisa de descrição.
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {baseSalva && (
                  <button
                    type="button"
                    onClick={() => {
                      setBaseEdit(false);
                      if (detalhe) {
                        seedBase(detalhe);
                        setContextoAdmin(detalhe.contextoAdmin);
                      }
                    }}
                    className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    Cancelar
                  </button>
                )}
                <button
                  type="button"
                  onClick={salvarBase}
                  disabled={savingBase || baseDescFaltando}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {savingBase ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  {baseSalva ? "Salvar alterações da base" : "Validar base e liberar entrevista"}
                </button>
              </div>
            </div>
          )}
        </Step>

        {/* ETAPA 2 — Entrevista */}
        <Step
          n={2}
          title="Entrevista com a IA"
          description="Com a base validada, a IA entrevista o gestor item por item. Ao terminar, clique em “Concluir entrevista e gerar proposta” para destravar a Etapa 3."
          state={step2State}
          chip={
            conversaIniciada ? (
              <span className="inline-flex items-center rounded-full border border-emerald-500/40 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                em andamento
              </span>
            ) : undefined
          }
        >
          {!baseSalva ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              <Lock className="h-4 w-4" />
              Conclua a Etapa 1 (validar a base) para liberar a entrevista.
            </div>
          ) : (
            <div className="flex min-h-[24rem] flex-col rounded-lg border">
              <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2 text-sm font-medium">
                <span className="inline-flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  Entrevista com a IA
                </span>
                {(conversaIniciada || proposta) &&
                  (confirmReset ? (
                    <span className="inline-flex items-center gap-2 text-xs font-normal">
                      <span className="text-muted-foreground">Reiniciar? (a base é mantida)</span>
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
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmReset(true)}
                      className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-normal text-muted-foreground hover:bg-muted"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Recomeçar
                    </button>
                  ))}
              </div>

              {/* Total do ano anterior — dado FRESCO (soma categoria + irmãs "(*)").
                  Fica sempre correto, mesmo que a fala da IA no chat esteja antiga. */}
              <div className="flex items-center justify-between gap-2 border-b bg-emerald-500/5 px-3 py-1.5 text-xs">
                <span className="text-muted-foreground">Total gasto em {year - 1} nesta categoria</span>
                <span className="font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                  {r && r.total > 0 ? formatBRL(r.total) : "sem gasto registrado"}
                </span>
              </div>

              <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto p-3" style={{ maxHeight: "24rem" }}>
                {!conversaIniciada && !sending && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
                    <p className="max-w-md text-sm text-muted-foreground">
                      {baseIncluidos.length > 0
                        ? "A IA vai confirmar item por item da base (mantém? muda valor? cancela no meio do ano?) e perguntar se há novas contratações — e então montar a proposta."
                        : "Sem base prévia: a IA explica o que é esta despesa e pergunta, de forma aberta, se você pretende contratar algo nesta categoria — e então monta a proposta."}
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
                <div className="space-y-2 border-t p-2">
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
                  <button
                    type="button"
                    onClick={() => void enviar("", true)}
                    disabled={sending || !podeFechar}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-emerald-500/50 bg-emerald-500/5 px-3 py-2 text-sm font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:opacity-40 dark:text-emerald-400"
                    title={
                      podeFechar
                        ? "Fecha a proposta com o que já foi respondido"
                        : "Disponível quando a IA terminar todas as perguntas"
                    }
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Concluir entrevista e gerar proposta
                  </button>
                  {!podeFechar && (
                    <p className="text-center text-[11px] text-muted-foreground">
                      Disponível quando a IA terminar todas as perguntas.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </Step>

        {/* ETAPA 3 — Proposta */}
        <Step
          n={3}
          title={`Proposta do orçamento de ${year}`}
          description="O resultado da entrevista. O gestor confirma para congelar; depois só o administrador altera os números. Ao confirmar, vai para a Prévia."
          state={step3State}
          last
          chip={
            propostaConfirmada ? (
              <StatusChip selo="concluido" />
            ) : proposta ? (
              <span className="inline-flex items-center rounded-full border border-amber-500/50 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-500">
                aguardando confirmação
              </span>
            ) : undefined
          }
        >
          {!proposta ? (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
              <Lock className="h-4 w-4" />
              A proposta aparece aqui quando a entrevista chegar a um fechamento.
            </div>
          ) : propostaEdit ? (
            <div className="space-y-3">
              <ItensTable
                itens={propostaEdit}
                refMap={refMap}
                year={year}
                onChange={(key, partial) =>
                  setPropostaEdit((prev) => (prev ? prev.map((it) => (it.key === key ? { ...it, ...partial } : it)) : prev))
                }
                onRemove={(key) => setPropostaEdit((prev) => (prev ? prev.filter((it) => it.key !== key) : prev))}
                onAdd={() =>
                  setPropostaEdit((prev) =>
                    prev
                      ? [
                          ...prev,
                          {
                            key: `pe-${seq.current++}`,
                            id: `pe-${seq.current}`,
                            descricao: "",
                            valorMensal: 0,
                            mesInicio: 1,
                            mesFim: null,
                            periodicidade: "mensal",
                            origem: "novo",
                            fornecedor: null,
                            incluir: true,
                          },
                        ]
                      : prev,
                  )
                }
              />
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Justificativa / premissas</label>
                <textarea
                  value={propostaEditJust}
                  onChange={(e) => setPropostaEditJust(e.target.value)}
                  rows={2}
                  className={cn(INPUT_CLS, "resize-none")}
                />
              </div>
              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPropostaEdit(null)}
                  className="rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={salvarEdicaoProposta}
                  disabled={savingProposta}
                  className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                >
                  {savingProposta ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Salvar alterações
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <PropostaCard proposta={proposta} year={year} />
              <div className="flex flex-wrap items-center justify-end gap-2">
                {isAdmin && (
                  <button
                    type="button"
                    onClick={abrirEdicaoProposta}
                    className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar números
                  </button>
                )}
                {propostaConfirmada ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-600 dark:text-emerald-400">
                    <CheckCircle2 className="h-4 w-4" />
                    Confirmada — enviada à Prévia
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={confirmar}
                    disabled={confirming}
                    className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40"
                  >
                    {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Confirmar proposta
                  </button>
                )}
              </div>
            </div>
          )}
        </Step>
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

  // A categoria selecionada renderiza ANTES do gate de `loading` da lista: um
  // reload em segundo plano (ex.: onSaved) NÃO pode desmontar a entrevista.
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
          <code className="rounded bg-muted px-1 py-0.5">20260825120000</code> …{" "}
          <code className="rounded bg-muted px-1 py-0.5">20260830120000</code>) para habilitar esta tela.
        </p>
      </div>
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
            {items.length} categoria(s) por planejamento dos sócios. Escolha por qual começar — cada uma
            guarda o progresso das etapas.
          </p>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((item) => {
              const selo: Selo = item.propostaConfirmada
                ? "concluido"
                : item.temProposta || item.baseSalva
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
                      {item.temProposta
                        ? `${item.itemCount} item(ns) na proposta`
                        : item.baseSalva
                          ? "base validada — falta a entrevista"
                          : item.realizadoAnterior && item.realizadoAnterior.media != null
                            ? `${year - 1}: ${formatBRL(item.realizadoAnterior.media)}/mês`
                            : `sem realizado ${year - 1}`}
                    </span>
                    {item.propostaConfirmada && item.totalOrcado > 0 ? (
                      <span className="font-semibold tabular-nums">{formatBRL(item.totalOrcado)}</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600 group-hover:underline dark:text-emerald-400">
                        <Sparkles className="h-3.5 w-3.5" />
                        {item.temProposta ? "Revisar" : item.baseSalva ? "Entrevistar" : "Começar"}
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
