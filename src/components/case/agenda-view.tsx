"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Clock, MapPin, User, FileDown, FileText, PenLine, Loader2, AlertTriangle, CheckCircle2, Paperclip, Receipt } from "lucide-react";

import { getContractAttachmentUrl, getSaleContractUrl, getContratoComprovantes } from "@/lib/case/actions/contracts";
import { useToast } from "@/components/ui/toaster";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { AgendaContract } from "@/lib/case/queries";
import type { CaseContractStatus } from "@/lib/case/types";

const fmt = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const brl = (v: number) => `R$ ${fmt.format(v)}`;

const STATUS_LABEL: Record<CaseContractStatus, string> = {
  rascunho: "Rascunho",
  aguardando_assinatura: "Aguardando assinatura",
  assinado: "Assinado",
  lancado: "Lançado",
  parcial: "Parcial",
  erro: "Erro",
  cancelado: "Cancelado",
};

// Cada status tem cor própria (borda esquerda do card + pill).
const STATUS_COLOR: Record<CaseContractStatus, { border: string; pill: string; dot: string }> = {
  rascunho: { border: "border-l-slate-400", pill: "bg-slate-500/15 text-slate-600 dark:text-slate-300", dot: "bg-slate-400" },
  aguardando_assinatura: { border: "border-l-blue-500", pill: "bg-blue-500/15 text-blue-700 dark:text-blue-300", dot: "bg-blue-500" },
  assinado: { border: "border-l-violet-500", pill: "bg-violet-500/15 text-violet-700 dark:text-violet-300", dot: "bg-violet-500" },
  lancado: { border: "border-l-emerald-500", pill: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
  parcial: { border: "border-l-amber-500", pill: "bg-amber-500/15 text-amber-700 dark:text-amber-300", dot: "bg-amber-500" },
  erro: { border: "border-l-red-500", pill: "bg-red-500/15 text-red-700 dark:text-red-300", dot: "bg-red-500" },
  cancelado: { border: "border-l-zinc-400", pill: "bg-zinc-500/15 text-zinc-500", dot: "bg-zinc-400" },
};

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

function dateBR(d: string | null): string {
  if (!d) return "Sem data";
  const [y, m, day] = d.slice(0, 10).split("-");
  return `${day}/${m}/${y}`;
}

function monthKey(d: string | null): string {
  return d ? d.slice(0, 7) : "9999-99";
}

function monthLabel(key: string): string {
  if (key === "9999-99") return "Sem data de evento";
  const [y, m] = key.split("-");
  return `${MESES[Number(m) - 1]} de ${y}`;
}

function pagamentoStatus(c: AgendaContract): { dot: string; label: string } {
  if (c.temErro) return { dot: "bg-red-500", label: "erro" };
  if (c.titles.length === 0) return { dot: "bg-slate-300 dark:bg-slate-600", label: "sem títulos" };
  const total = c.aReceberTotal + c.aPagarTotal;
  const pago = c.aReceberPago + c.aPagarPago;
  if (total > 0 && pago >= total - 0.005) return { dot: "bg-emerald-500", label: "quitado" };
  if (pago > 0) return { dot: "bg-amber-500", label: "parcial" };
  return { dot: "bg-sky-500", label: "a pagar" };
}

function DownloadButtons({ c }: { c: AgendaContract }) {
  const { showToast } = useToast();
  const [loading, setLoading] = useState<null | "art" | "venda">(null);

  async function open(kind: "art" | "venda") {
    setLoading(kind);
    try {
      const res = kind === "art" ? await getContractAttachmentUrl(c.id) : await getSaleContractUrl(c.id);
      if ("error" in res) showToast({ variant: "destructive", title: res.error });
      else window.open(res.url, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(null);
    }
  }

  const btn = "inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-ink-secondary hover:bg-surface-2 disabled:opacity-50";

  return (
    <div className="flex flex-wrap gap-2">
      {c.has_sale_contract && (
        <button type="button" className={btn} disabled={loading !== null} onClick={() => open("venda")}>
          {loading === "venda" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileDown className="h-3.5 w-3.5" />}
          Contrato de venda
        </button>
      )}
      {c.has_attachment && (
        <button type="button" className={btn} disabled={loading !== null} onClick={() => open("art")}>
          {loading === "art" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
          Contrato do artista
        </button>
      )}
      {c.status === "aguardando_assinatura" && c.sign_url && (
        <a href={c.sign_url} target="_blank" rel="noopener noreferrer" className={`${btn} border-blue-500/40 text-blue-600 dark:text-blue-400`}>
          <PenLine className="h-3.5 w-3.5" /> Link de assinatura
        </a>
      )}
      {!c.has_sale_contract && !c.has_attachment && !(c.status === "aguardando_assinatura" && c.sign_url) && (
        <span className="text-xs text-ink-muted">Nenhum contrato disponível para download.</span>
      )}
    </div>
  );
}

function InfoRow({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 text-sm text-ink-secondary">
      <span className="mt-0.5 shrink-0 text-ink-muted">{icon}</span>
      <span className="min-w-0">{children}</span>
    </div>
  );
}

function PagamentoBar({ label, total, pago }: { label: string; total: number; pago: number }) {
  const pct = total > 0 ? Math.min(100, (pago / total) * 100) : 0;
  const quitado = total > 0 && pago >= total - 0.005;
  return (
    <div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-ink-muted">{label}</span>
        <span className="tabular-nums text-ink-secondary">
          {brl(pago)} <span className="text-ink-muted">/ {brl(total)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-2">
        <div className={`h-1.5 rounded-full ${quitado ? "bg-emerald-500" : "bg-sky-500"}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** Card compacto e clicável. */
function CompactCard({ c, onOpen }: { c: AgendaContract; onOpen: () => void }) {
  const color = STATUS_COLOR[c.status] ?? STATUS_COLOR.rascunho;
  const pag = pagamentoStatus(c);
  const atracoes = c.atracoes.length > 0 ? c.atracoes.join(", ") : c.band_name;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full flex-col gap-1.5 rounded-lg border border-border border-l-4 ${color.border} bg-surface-1 p-3 text-left transition-colors hover:bg-surface-2/50`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-medium text-ink-muted">NP {c.contract_number}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${color.pill}`}>{STATUS_LABEL[c.status]}</span>
      </div>
      <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-ink-primary" title={c.event_name ?? undefined}>
        {c.event_name || c.client_name}
      </h3>
      <div className="flex items-center gap-1.5 text-xs text-ink-secondary">
        <CalendarDays className="h-3.5 w-3.5 text-ink-muted" />
        {dateBR(c.event_date)}
        {c.show_time ? <span className="text-ink-muted">· {c.show_time}</span> : null}
      </div>
      <div className="truncate text-xs text-ink-muted" title={atracoes}>
        {atracoes}
      </div>
      <div className="mt-1 flex items-center justify-between border-t border-border pt-1.5">
        <span className="text-xs font-semibold tabular-nums text-ink-primary">{brl(c.valor_total)}</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-ink-muted">
          <span className={`inline-block h-2 w-2 rounded-full ${pag.dot}`} /> {pag.label}
        </span>
      </div>
    </button>
  );
}

/** Modal com todas as informações do contrato. */
function DetalheModal({ c, onClose }: { c: AgendaContract | null; onClose: () => void }) {
  const open = c !== null;
  const color = c ? STATUS_COLOR[c.status] ?? STATUS_COLOR.rascunho : STATUS_COLOR.rascunho;
  const { showToast } = useToast();

  // Comprovantes (anexos Omie) por titleId — carregados sob demanda.
  const [comprovantes, setComprovantes] = useState<Record<string, Array<{ nome: string; url: string }>> | null>(null);
  const [loadingComp, setLoadingComp] = useState(false);

  useEffect(() => {
    setComprovantes(null);
    setLoadingComp(false);
  }, [c?.id]);

  const temTitulosLancados = Boolean(c?.titles.some((t) => t.omie_codigo));

  async function carregarComprovantes() {
    if (!c) return;
    setLoadingComp(true);
    const res = await getContratoComprovantes(c.id);
    setLoadingComp(false);
    if ("error" in res) {
      showToast({ variant: "destructive", title: res.error });
      return;
    }
    const map: Record<string, Array<{ nome: string; url: string }>> = {};
    for (const t of res.titulos) map[t.titleId] = t.anexos;
    setComprovantes(map);
    if (res.titulos.length === 0) {
      showToast({ title: "Nenhum comprovante anexado no Omie para este contrato." });
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
        {c && (
          <>
            <DialogHeader className={`border-b border-border border-l-4 ${color.border} space-y-1 p-5 pr-10`}>
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-ink-muted">NP {c.contract_number}</span>
                <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${color.pill}`}>{STATUS_LABEL[c.status]}</span>
              </div>
              <DialogTitle className="text-base text-ink-primary">{c.event_name || c.client_name}</DialogTitle>
            </DialogHeader>

            <div className="space-y-4 p-5">
              {/* Evento */}
              <section className="space-y-1.5">
                <InfoRow icon={<CalendarDays className="h-4 w-4" />}>
                  {dateBR(c.event_date)}
                  {c.show_time ? <span className="text-ink-muted"> · <Clock className="inline h-3.5 w-3.5" /> {c.show_time}</span> : null}
                </InfoRow>
                <InfoRow icon={<User className="h-4 w-4" />}>{c.atracoes.length > 0 ? c.atracoes.join(", ") : c.band_name}</InfoRow>
                {(c.local_name || c.local_city) && (
                  <InfoRow icon={<MapPin className="h-4 w-4" />}>
                    {[c.local_name, c.local_city].filter(Boolean).join(" — ")}
                    {c.local_address ? <span className="block text-xs text-ink-muted">{c.local_address}</span> : null}
                  </InfoRow>
                )}
              </section>

              {/* Contratante */}
              <section className="rounded-md bg-surface-2/50 p-3">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Contratante</div>
                <div className="mt-1 text-sm font-medium text-ink-primary">{c.client_name}</div>
                <div className="mt-0.5 space-y-0.5 text-xs text-ink-secondary">
                  {c.client_doc && <div>{c.client_pf ? "CPF" : "CNPJ"}: {c.client_doc}</div>}
                  {c.client_resp_legal && <div>Resp. legal: {c.client_resp_legal}</div>}
                  {c.client_email && <div className="break-all">{c.client_email}</div>}
                  {c.client_phone && <div>{c.client_phone}</div>}
                  {(c.client_endereco || c.client_cidade_estado) && (
                    <div className="text-ink-muted">{[c.client_endereco, c.client_cidade_estado].filter(Boolean).join(", ")}</div>
                  )}
                </div>
              </section>

              {/* Valores */}
              <section className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-md border border-border py-2">
                  <div className="text-[10px] uppercase text-ink-muted">Total</div>
                  <div className="text-sm font-semibold tabular-nums text-ink-primary">{brl(c.valor_total)}</div>
                </div>
                <div className="rounded-md border border-border py-2">
                  <div className="text-[10px] uppercase text-ink-muted">Custódia</div>
                  <div className="text-sm font-semibold tabular-nums text-amber-600 dark:text-amber-400">{brl(c.valor_custodia)}</div>
                </div>
                <div className="rounded-md border border-border py-2">
                  <div className="text-[10px] uppercase text-ink-muted">BV/Serviços</div>
                  <div className="text-sm font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{brl(c.valor_servicos)}</div>
                </div>
              </section>

              {/* Pagamentos Omie */}
              <section>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Pagamentos (Omie)</span>
                  <div className="flex items-center gap-2">
                    {c.temErro ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-red-500">
                        <AlertTriangle className="h-3.5 w-3.5" /> com erro
                      </span>
                    ) : c.titles.length > 0 && c.aReceberPago + c.aPagarPago >= c.aReceberTotal + c.aPagarTotal - 0.005 ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        <CheckCircle2 className="h-3.5 w-3.5" /> quitado
                      </span>
                    ) : null}
                    {temTitulosLancados && comprovantes === null && (
                      <button
                        type="button"
                        onClick={carregarComprovantes}
                        disabled={loadingComp}
                        className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] font-medium text-ink-secondary hover:bg-surface-2 disabled:opacity-50"
                      >
                        {loadingComp ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Receipt className="h-3.5 w-3.5" />}
                        {loadingComp ? "Buscando…" : "Comprovantes"}
                      </button>
                    )}
                  </div>
                </div>
                {c.titles.length === 0 ? (
                  <p className="text-xs text-ink-muted">Sem títulos lançados no Omie.</p>
                ) : (
                  <div className="space-y-2">
                    {c.aReceberTotal > 0 && <PagamentoBar label="A receber" total={c.aReceberTotal} pago={c.aReceberPago} />}
                    {c.aPagarTotal > 0 && <PagamentoBar label="A pagar (custódia)" total={c.aPagarTotal} pago={c.aPagarPago} />}
                    <ul className="mt-1.5 space-y-1.5">
                      {c.titles.map((t) => {
                        const comps = comprovantes?.[t.id] ?? [];
                        return (
                          <li key={t.id} className="text-xs">
                            <div className="flex items-center justify-between gap-2">
                              <span className="min-w-0 truncate text-ink-secondary" title={t.descricao}>
                                {t.pago ? "✅" : t.status === "erro" ? "⚠️" : t.status === "lancado" ? "🔵" : "⚪️"} {t.descricao}
                                {t.vencimento ? <span className="text-ink-muted"> · {dateBR(t.vencimento)}</span> : null}
                                {t.omie_codigo ? <span className="text-ink-muted"> · #{t.omie_codigo}</span> : null}
                              </span>
                              <span className="shrink-0 tabular-nums text-ink-secondary">{brl(t.valor)}</span>
                            </div>
                            {comps.length > 0 && (
                              <div className="mt-1 flex flex-wrap gap-1.5 pl-5">
                                {comps.map((a, j) => (
                                  <a
                                    key={j}
                                    href={a.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded border border-border bg-surface-2/50 px-1.5 py-0.5 text-[11px] text-ink-secondary hover:bg-surface-2"
                                    title={a.nome}
                                  >
                                    <Paperclip className="h-3 w-3" />
                                    <span className="max-w-[160px] truncate">{a.nome}</span>
                                  </a>
                                ))}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {comprovantes !== null && (
                      <p className="text-[11px] text-ink-muted">
                        {Object.keys(comprovantes).length === 0
                          ? "Nenhum comprovante anexado no Omie."
                          : "Comprovantes carregados do Omie (links válidos por alguns minutos)."}
                      </p>
                    )}
                  </div>
                )}
              </section>

              {/* Downloads */}
              <section className="border-t border-border pt-4">
                <DownloadButtons c={c} />
              </section>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function AgendaView({ contracts }: { contracts: AgendaContract[] }) {
  const [filter, setFilter] = useState<CaseContractStatus | "todos">("todos");
  const [selected, setSelected] = useState<AgendaContract | null>(null);

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of contracts) m.set(c.status, (m.get(c.status) ?? 0) + 1);
    return m;
  }, [contracts]);

  const filtered = filter === "todos" ? contracts : contracts.filter((c) => c.status === filter);

  const groups = useMemo(() => {
    const m = new Map<string, AgendaContract[]>();
    for (const c of filtered) {
      const k = monthKey(c.event_date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(c);
    }
    return Array.from(m.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const statusesPresent = (Object.keys(STATUS_LABEL) as CaseContractStatus[]).filter((s) => counts.has(s));

  const chip = (active: boolean) =>
    `rounded-full px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-ink-primary text-surface-1" : "border border-border text-ink-secondary hover:bg-surface-2"}`;

  return (
    <div className="space-y-6">
      {/* Filtro por status */}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={chip(filter === "todos")} onClick={() => setFilter("todos")}>
          Todos ({contracts.length})
        </button>
        {statusesPresent.map((s) => (
          <button key={s} type="button" className={chip(filter === s)} onClick={() => setFilter(s)}>
            <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${STATUS_COLOR[s].dot}`} />
            {STATUS_LABEL[s]} ({counts.get(s)})
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface-1 p-6 text-sm text-ink-muted">Nenhum contrato para este filtro.</p>
      ) : (
        groups.map(([key, items]) => (
          <div key={key}>
            <h2 className="mb-3 text-sm font-semibold capitalize text-ink-secondary">
              {monthLabel(key)} <span className="font-normal text-ink-muted">· {items.length}</span>
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
              {items.map((c) => (
                <CompactCard key={c.id} c={c} onOpen={() => setSelected(c)} />
              ))}
            </div>
          </div>
        ))
      )}

      <DetalheModal c={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
