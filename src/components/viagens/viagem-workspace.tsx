"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bus,
  Car,
  CheckCircle2,
  ExternalLink,
  Lightbulb,
  Loader2,
  Plane,
  RefreshCw,
  TrendingDown,
  XCircle,
} from "lucide-react";

import { buscarAgora, cancelarRequisicao } from "@/lib/viagens/actions/requests";
import { escolherOpcao, rejeitarRequisicao, reservarViagem } from "@/lib/viagens/actions/decisoes";
import type { ViagemModal, ViagemQuoteRow, ViagemRequestDetail } from "@/lib/viagens/types";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtBRL = (n: number) => `R$ ${fmt.format(n)}`;
const fmtDate = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  buscando: "Buscando preços…",
  cotado: "Aguardando escolha",
  aprovado: "Aprovada — reservar",
  reservado: "Reservada",
  concluido: "Concluída",
  rejeitado: "Rejeitada",
  erro: "Erro na busca",
  cancelado: "Cancelada",
};

const STATUS_CLS: Record<string, string> = {
  buscando: "bg-blue-500/10 text-blue-600 dark:text-blue-400",
  cotado: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  aprovado: "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  reservado: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  concluido: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  rejeitado: "bg-red-500/10 text-red-600 dark:text-red-400",
  erro: "bg-red-500/10 text-red-600 dark:text-red-400",
  cancelado: "bg-slate-500/10 text-slate-500",
};

const MODAL_META: Record<ViagemModal, { label: string; Icon: typeof Car }> = {
  carro: { label: "Carro", Icon: Car },
  onibus: { label: "Ônibus", Icon: Bus },
  aviao: { label: "Avião", Icon: Plane },
};

export function ViagemWorkspace({ detail, isAprovador }: { detail: ViagemRequestDetail; isAprovador: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const searchFired = useRef(false);

  // Ao abrir uma requisição ainda em busca, dispara o processamento e recarrega.
  useEffect(() => {
    if (detail.status !== "buscando" || searchFired.current) return;
    searchFired.current = true;
    (async () => {
      await buscarAgora().catch(() => null);
      router.refresh();
    })();
  }, [detail.status, router]);

  // Enquanto busca, revalida a cada 6s (o cron também drena a fila).
  useEffect(() => {
    if (detail.status !== "buscando") return;
    const t = setInterval(() => router.refresh(), 6000);
    return () => clearInterval(t);
  }, [detail.status, router]);

  async function run(label: string, fn: () => Promise<{ ok?: true; error?: string } | { error: string }>) {
    if (busy) return;
    setError(null);
    setBusy(label);
    const res = await fn();
    setBusy(null);
    if (res && "error" in res && res.error) return setError(res.error);
    router.refresh();
  }

  const chosen = detail.quotes.find((q) => q.id === detail.chosen_quote_id) ?? null;
  const melhor = detail.quotes.length ? Math.min(...detail.quotes.map((q) => q.total)) : null;
  const aviaoQuote = detail.quotes.find((q) => q.modal === "aviao");
  const recomendacao = (aviaoQuote?.detalhes?.recomendacao as string | undefined) ?? null;

  return (
    <div className="space-y-5">
      {/* Cabeçalho */}
      <div className="rounded-lg border border-border bg-surface-1 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-ink-primary">
              Viagem #{detail.request_number} — {detail.origem} → {detail.destino}
            </h1>
            <p className="mt-0.5 text-sm text-ink-muted">
              {fmtDate(detail.data_ida)} a {fmtDate(detail.data_volta)} · {detail.passageiros}{" "}
              {detail.passageiros === 1 ? "passageiro" : "passageiros"}
              {detail.janela_flex_dias > 0 && ` · flex ±${detail.janela_flex_dias}d`}
              {detail.monitorar && " · monitorando preço"}
              {" · pedida por "}
              {detail.created_by_name}
            </p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${STATUS_CLS[detail.status] ?? "bg-surface-2 text-ink-secondary"}`}>
            {STATUS_LABEL[detail.status] ?? detail.status}
          </span>
        </div>
        {detail.observacao && <p className="mt-2 text-sm text-ink-secondary">{detail.observacao}</p>}
        {detail.rejected_reason && (
          <p className="mt-2 text-sm text-red-600 dark:text-red-400">Motivo da rejeição: {detail.rejected_reason}</p>
        )}
      </div>

      {/* Busca em andamento */}
      {detail.status === "buscando" && (
        <div className="flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/5 p-4 text-sm text-blue-700 dark:text-blue-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Buscando as melhores opções de carro, ônibus e avião… isso leva menos de um minuto.
        </div>
      )}

      {detail.status === "erro" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/5 p-4 text-sm text-red-700 dark:text-red-300">
          <span>A busca falhou. Tente novamente.</span>
          <button
            type="button"
            onClick={() => run("retry", async () => {
              // Recoloca a busca na fila e processa.
              const res = await buscarAgora();
              return res;
            })}
            className="inline-flex items-center gap-2 rounded-md border border-red-500/40 px-3 py-1.5 text-xs font-medium hover:bg-red-500/10"
          >
            {busy === "retry" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Buscar de novo
          </button>
        </div>
      )}

      {/* Recomendação proativa (aeroportos alternativos) */}
      {recomendacao && detail.quotes.length > 0 && (
        <div className="flex items-start gap-2.5 rounded-lg border border-teal-500/30 bg-teal-500/5 p-3.5 text-sm text-teal-800 dark:text-teal-200">
          <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" />
          <span>{recomendacao}</span>
        </div>
      )}

      {/* Os 3 orçamentos */}
      {detail.quotes.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {(["carro", "onibus", "aviao"] as ViagemModal[]).map((modal) => {
            const quote = detail.quotes.find((q) => q.modal === modal);
            return (
              <QuoteCard
                key={modal}
                modal={modal}
                quote={quote ?? null}
                isBest={quote != null && quote.total === melhor}
                isChosen={quote != null && quote.id === detail.chosen_quote_id}
                canChoose={isAprovador && detail.status === "cotado"}
                busy={busy}
                onChoose={(q) => run(`choose-${q.id}`, () => escolherOpcao(detail.id, q.id))}
              />
            );
          })}
        </div>
      )}

      {error && <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">{error}</div>}

      {/* Ações do aprovador / solicitante */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {["buscando", "cotado", "erro"].includes(detail.status) && (
          <button
            type="button"
            onClick={() => run("cancel", () => cancelarRequisicao(detail.id))}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-md border border-border px-4 py-2 text-sm text-ink-secondary hover:bg-surface-2 disabled:opacity-50"
          >
            {busy === "cancel" && <Loader2 className="h-4 w-4 animate-spin" />} Cancelar viagem
          </button>
        )}
        {isAprovador && detail.status === "cotado" && (
          <button
            type="button"
            onClick={() => setRejectOpen(true)}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-md border border-red-500/50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-500/10 disabled:opacity-50 dark:text-red-400"
          >
            <XCircle className="h-4 w-4" /> Rejeitar
          </button>
        )}
        {isAprovador && detail.status === "aprovado" && (
          <button
            type="button"
            onClick={() => run("book", () => reservarViagem(detail.id))}
            disabled={busy !== null}
            className="inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {busy === "book" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Fechar reserva{chosen ? ` — ${MODAL_META[chosen.modal].label} ${fmtBRL(chosen.total)}` : ""}
          </button>
        )}
      </div>

      {/* Reservada — resumo */}
      {detail.status === "reservado" && chosen && (
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-sm">
          <p className="font-medium text-emerald-700 dark:text-emerald-300">
            Reserva fechada: {chosen.titulo ?? MODAL_META[chosen.modal].label} — {fmtBRL(chosen.total)}
          </p>
          <p className="mt-1 text-ink-muted">
            O solicitante foi notificado com o roteiro{chosen.booking_link ? " e o link de compra" : ""}.
          </p>
          {chosen.booking_link && (
            <a href={chosen.booking_link} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-sm font-medium text-teal-600 underline dark:text-teal-400">
              Abrir link de compra <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      )}

      {/* Histórico de preço (monitoramento) */}
      {detail.snapshots.length > 3 && (
        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink-primary">
            <TrendingDown className="h-4 w-4 text-teal-500" /> Histórico de preço
          </h2>
          <div className="mt-2 max-h-48 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-ink-muted">
                  <th className="py-1 pr-3 font-medium">Quando</th>
                  <th className="py-1 pr-3 font-medium">Modal</th>
                  <th className="py-1 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {detail.snapshots.map((s, i) => (
                  <tr key={i} className="border-t border-border/60 text-ink-secondary">
                    <td className="py-1 pr-3">{new Date(s.captured_at).toLocaleString("pt-BR")}</td>
                    <td className="py-1 pr-3">{MODAL_META[s.modal].label}</td>
                    <td className="py-1 text-right tabular-nums">{fmtBRL(s.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Timeline */}
      {detail.history.length > 0 && (
        <div className="rounded-lg border border-border bg-surface-1 p-4">
          <h2 className="text-sm font-semibold text-ink-primary">Histórico</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-secondary">
            {detail.history.map((h, i) => (
              <li key={i} className="flex flex-wrap gap-1.5">
                <span className="text-ink-muted">{new Date(h.created_at).toLocaleString("pt-BR")}</span>
                <span className="font-medium">{h.action}</span>
                {h.user_name && <span className="text-ink-muted">por {h.user_name}</span>}
                {h.comment && <span>— {h.comment}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Modal de rejeição */}
      {rejectOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-lg border border-border bg-surface-1 p-4 shadow-xl">
            <h3 className="text-sm font-semibold text-ink-primary">Rejeitar viagem</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder="Motivo da rejeição…"
              className="mt-3 w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-sm text-ink-primary outline-none focus:ring-2 focus:ring-red-500/40"
            />
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={() => setRejectOpen(false)} className="rounded-md border border-border px-3 py-1.5 text-sm text-ink-secondary hover:bg-surface-2">
                Voltar
              </button>
              <button
                type="button"
                disabled={!rejectReason.trim() || busy !== null}
                onClick={() =>
                  run("reject", async () => {
                    const res = await rejeitarRequisicao(detail.id, rejectReason);
                    if (!("error" in res)) setRejectOpen(false);
                    return res;
                  })
                }
                className="inline-flex items-center gap-2 rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {busy === "reject" && <Loader2 className="h-4 w-4 animate-spin" />} Rejeitar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function QuoteCard({
  modal,
  quote,
  isBest,
  isChosen,
  canChoose,
  busy,
  onChoose,
}: {
  modal: ViagemModal;
  quote: ViagemQuoteRow | null;
  isBest: boolean;
  isChosen: boolean;
  canChoose: boolean;
  busy: string | null;
  onChoose: (q: ViagemQuoteRow) => void;
}) {
  const { label, Icon } = MODAL_META[modal];

  if (!quote) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-surface-1 p-6 text-center text-sm text-ink-muted">
        <Icon className="h-6 w-6" />
        <span className="font-medium">{label}</span>
        <span className="text-xs">Sem opção viável nesta rota.</span>
      </div>
    );
  }

  // Linhas detalhadas (gasolina, pedágio, uber↔aeroporto…) vindas do cálculo;
  // fallback pro breakdown por coluna se não houver.
  const linhas = (quote.detalhes?.linhas as Array<{ label: string; valor: number }> | undefined) ?? null;
  const rows: Array<[string, number]> = linhas
    ? linhas.map((l) => [l.label, l.valor] as [string, number])
    : [
        ["Transporte", quote.custo_transporte],
        ["Hospedagem", quote.custo_hospedagem],
        ["Traslados", quote.custo_traslados],
        ["Alimentação", quote.custo_alimentacao],
        ["Taxas", quote.custo_taxas],
      ];

  const alternativas =
    (quote.detalhes?.alternativas as
      | Array<{ iata: string; voo_total: number; transfer_total: number; total_porta_a_porta: number; preco_real: boolean; escolhida: boolean }>
      | undefined) ?? null;
  const fontes = (quote.detalhes?.fontes as string[] | undefined) ?? [];

  return (
    <div
      className={`relative flex flex-col rounded-lg border p-4 ${
        isChosen
          ? "border-teal-500 bg-teal-500/5 ring-1 ring-teal-500"
          : isBest
            ? "border-emerald-500/50 bg-surface-1"
            : "border-border bg-surface-1"
      }`}
    >
      {(isChosen || isBest) && (
        <span
          className={`absolute -top-2.5 left-3 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
            isChosen ? "bg-teal-600 text-white" : "bg-emerald-600 text-white"
          }`}
        >
          {isChosen ? "Escolhida" : "Mais barata"}
        </span>
      )}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 text-teal-600 dark:text-teal-400" />
          <span className="text-sm font-semibold text-ink-primary">{label}</span>
        </div>
        <ProviderBadge provider={quote.provider} />
      </div>
      {quote.titulo && <p className="mt-1 text-xs text-ink-muted">{quote.titulo}</p>}

      <div className="mt-3 space-y-1">
        {rows.filter(([, v]) => v > 0).map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2 text-xs text-ink-secondary">
            <span>{k}</span>
            <span className="shrink-0 tabular-nums">{fmtBRL(v)}</span>
          </div>
        ))}
      </div>

      {alternativas && alternativas.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-xs font-medium text-teal-600 hover:underline dark:text-teal-400">
            Comparar aeroportos de saída ({alternativas.length})
          </summary>
          <table className="mt-2 w-full text-[11px]">
            <thead>
              <tr className="text-left text-ink-muted">
                <th className="py-0.5 pr-2 font-medium">Saída</th>
                <th className="py-0.5 pr-2 text-right font-medium">Voo</th>
                <th className="py-0.5 pr-2 text-right font-medium">Chegar lá</th>
                <th className="py-0.5 text-right font-medium">Porta-a-porta</th>
              </tr>
            </thead>
            <tbody>
              {alternativas.map((alt) => (
                <tr key={alt.iata} className={`border-t border-border/50 ${alt.escolhida ? "font-semibold text-ink-primary" : "text-ink-secondary"}`}>
                  <td className="py-1 pr-2">
                    {alt.iata}
                    {alt.escolhida && " ✓"}
                    {!alt.preco_real && <span className="ml-1 text-[9px] text-amber-500">est.</span>}
                  </td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtBRL(alt.voo_total)}</td>
                  <td className="py-1 pr-2 text-right tabular-nums">{fmtBRL(alt.transfer_total)}</td>
                  <td className="py-1 text-right tabular-nums">{fmtBRL(alt.total_porta_a_porta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}

      <div className="mt-3 border-t border-border pt-2 text-right">
        <span className="text-[10px] uppercase text-ink-muted">Total porta-a-porta</span>
        <div className="text-xl font-bold tabular-nums text-ink-primary">{fmtBRL(quote.total)}</div>
      </div>

      {fontes.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-[11px] text-ink-muted hover:text-ink-secondary">
            Fontes consultadas ({fontes.length})
          </summary>
          <ul className="mt-1 space-y-0.5">
            {fontes.slice(0, 6).map((f) => (
              <li key={f} className="truncate">
                <a href={f} target="_blank" rel="noreferrer" className="text-[11px] text-teal-600 hover:underline dark:text-teal-400">
                  {f.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
                </a>
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mt-3 flex flex-col gap-2">
        {quote.booking_link && (
          <a
            href={quote.booking_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-ink-secondary hover:bg-surface-2"
          >
            Ver opções de compra <ExternalLink className="h-3 w-3" />
          </a>
        )}
        {canChoose && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => onChoose(quote)}
            className="inline-flex items-center justify-center gap-2 rounded-md bg-teal-600 px-3 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
          >
            {busy === `choose-${quote.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Escolher esta opção
          </button>
        )}
      </div>
    </div>
  );
}

const PROVIDER_BADGE: Record<string, { label: string; cls: string; title: string }> = {
  estimativa: {
    label: "estimativa",
    cls: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
    title: "Preço estimado pela IA — confirme no fechamento",
  },
  calculado: {
    label: "calculado",
    cls: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
    title: "Custo calculado (distância, consumo, preço atual da gasolina e pedágios)",
  },
  web: {
    label: "pesquisado",
    cls: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
    title: "Preço pesquisado na web agora (Google Flights, companhias, ClickBus)",
  },
  amadeus: {
    label: "amadeus",
    cls: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    title: "Preço real do provedor Amadeus",
  },
};

function ProviderBadge({ provider }: { provider: string }) {
  const meta = PROVIDER_BADGE[provider] ?? PROVIDER_BADGE.estimativa;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${meta.cls}`} title={meta.title}>
      {meta.label}
    </span>
  );
}
