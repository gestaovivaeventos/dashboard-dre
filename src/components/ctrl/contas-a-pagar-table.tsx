"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { CornerUpLeft, Eye, Loader2, MessageCircle, Pencil, RefreshCw, Search, X } from "lucide-react";

import {
  enqueueSendToPayment,
  requeueRequestToOmie,
  previewPrevisaoMatches,
  returnRequestToRequisicoes,
  getRequestAttachmentUrl,
  type PrevisaoMatch,
} from "@/lib/ctrl/actions/requests";
import { resyncContaPagar } from "@/lib/ctrl/actions/contapagar-launch";
import { PaymentInfoThreadModal } from "@/components/ctrl/payment-info-thread-modal";
import { EditExpenseRoutingModal } from "@/components/ctrl/edit-expense-routing-modal";
import {
  RequestDetailModal,
  resolveSupplier,
  fmt,
  type Supplier,
  type RequestDetail,
} from "@/components/ctrl/request-detail-modal";
import { ExcelHeaderCell, useExcelTable, type ExcelColumn } from "@/components/ctrl/excel-table";
import { useRouter } from "next/navigation";

export type ContasRequest = RequestDetail;

type Tab = "aprovado" | "info_pagamento_pendente" | "agendado";

const TAB_LABELS: Record<Tab, string> = {
  aprovado: "Aguardando Envio",
  info_pagamento_pendente: "Info Pendente",
  agendado: "Enviados",
};

// O envio ao Omie é assíncrono: `enqueueSendToPayment` só enfileira e o cron
// `/api/cron/omie-launch-queue` lança uma requisição por empresa pagadora por
// minuto (a Omie bloqueia por duplicidade chamadas repetidas dentro de ~40s).
// Enquanto está na fila, a requisição continua nesta aba marcada como
// "Enviando ao Omie".
const RITMO_ENVIO_MINUTOS = 1;
/** Enquanto houver requisições na fila, recarrega a lista para acompanhar. */
const POLL_FILA_MS = 20_000;

/** Requisição aprovada aguardando o worker lançar no Omie. */
const naFila = (r: ContasRequest) =>
  r.status === "aprovado" && r.omie_launch_status === "pendente";

/** Requisição aprovada cujo lançamento falhou — dá para recolocar na fila. */
const falhouNoEnvio = (r: ContasRequest) =>
  r.status === "aprovado" && r.omie_launch_status === "erro";

function formatarDuracao(minutos: number) {
  if (minutos < 1) return "menos de 1 min";
  if (minutos < 60) return `${minutos} min`;
  const h = Math.floor(minutos / 60);
  const m = minutos % 60;
  return m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}

interface Props {
  requests: ContasRequest[];
  ctrlRoles: string[];
  companies: { id: string; name: string }[];
  // Cadastros para o modal de correção de setor/tipo (só carregados quando o
  // usuário pode editar). Vazios para quem não pode.
  sectors: { id: string; name: string }[];
  expenseTypes: { id: string; name: string }[];
}

function PaymentInfo({ supplier }: { supplier: Supplier | null }) {
  if (!supplier) return <span className="text-xs text-muted-foreground">Sem fornecedor</span>;
  if (supplier.chave_pix) {
    return (
      <div>
        <p className="text-xs font-medium text-green-700 dark:text-green-400">PIX</p>
        <p className="text-xs font-mono text-muted-foreground break-all">{supplier.chave_pix}</p>
      </div>
    );
  }
  if (supplier.banco) {
    return (
      <div>
        <p className="text-xs text-muted-foreground">
          {supplier.banco}{supplier.agencia ? ` · Ag. ${supplier.agencia}` : ""}
        </p>
        <p className="text-xs font-mono text-muted-foreground">CC {supplier.conta_corrente ?? "—"}</p>
        {supplier.titular_banco && <p className="text-xs text-muted-foreground">{supplier.titular_banco}</p>}
      </div>
    );
  }
  return <span className="text-xs text-muted-foreground">Dados não informados</span>;
}

export function ContasAPagarTable({ requests, ctrlRoles, companies, sectors, expenseTypes }: Props) {
  const router = useRouter();

  const [activeTab, setActiveTab] = useState<Tab>("aprovado");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [payingCompanyId, setPayingCompanyId] = useState("");
  const [showEnviarModal, setShowEnviarModal] = useState(false);
  const [previsaoPreview, setPrevisaoPreview] = useState<PrevisaoMatch[] | null>(null);
  // requestId -> decisão escolhida no diálogo
  const [previsaoDecisoes, setPrevisaoDecisoes] = useState<Record<string, number | "novo">>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [isPending, startTransition] = useTransition();

  // Requisições que o worker ainda vai lançar no Omie.
  const fila = useMemo(() => requests.filter(naFila), [requests]);

  // Enquanto houver fila, recarrega sozinho para o usuário ver o lote andando.
  // Não precisa manter a tela aberta — é só acompanhamento.
  useEffect(() => {
    if (fila.length === 0) return;
    const t = setInterval(() => router.refresh(), POLL_FILA_MS);
    return () => clearInterval(t);
  }, [fila.length, router]);

  // Detail modal — opened by "Detalhes" button in any row.
  const [detail, setDetail] = useState<ContasRequest | null>(null);
  const [attachmentLoading, setAttachmentLoading] = useState(false);

  // Modal de correção de setor/tipo (perfil Contas a Pagar / admin).
  const [editRouting, setEditRouting] = useState<ContasRequest | null>(null);
  const canEditRouting = ctrlRoles.some((r) => ["contas_a_pagar", "admin"].includes(r));

  // Modal de thread de info — aberto pelo botao "Pedir info" / "Continuar conversa".
  const [infoModal, setInfoModal] = useState<{
    req: ContasRequest;
    mode: "ask" | "view";
  } | null>(null);

  const canAskInfo = ctrlRoles.some((r) => ["contas_a_pagar", "csc", "admin"].includes(r));

  // Devolver p/ requisições (volta à aprovação; exclui o título no Omie se já enviada).
  const canReturn = ctrlRoles.some((r) => ["contas_a_pagar", "csc", "admin"].includes(r));
  const [returnModal, setReturnModal] = useState<ContasRequest | null>(null);
  const [returnReason, setReturnReason] = useState("");

  function handleDevolver() {
    if (!returnModal || !returnReason.trim()) return;
    const num = returnModal.request_number;
    startTransition(async () => {
      const result = await returnRequestToRequisicoes(returnModal.id, returnReason);
      if (result && "error" in result) {
        notify(String((result as { error: string }).error), false);
      } else {
        setReturnModal(null);
        setReturnReason("");
        setSelected(new Set());
        notify(`Requisição #${num} devolvida para requisições.`);
        router.refresh();
      }
    });
  }

  const canSendToPayment = ctrlRoles.some((r) =>
    ["gerente", "diretor", "csc", "contas_a_pagar", "admin"].includes(r),
  );

  // Só faz sentido devolver o que ainda está no fluxo de pagamento, não foi pago
  // e não está na fila (devolver no meio deixaria o worker lançando algo que já
  // voltou para aprovação).
  const canReturnRow = (r: ContasRequest) =>
    canReturn &&
    !r.omie_paid_at &&
    !naFila(r) &&
    ["aprovado", "info_pagamento_pendente", "agendado"].includes(r.status);

  async function openAttachment(requestId: string) {
    setAttachmentLoading(true);
    try {
      const result = await getRequestAttachmentUrl(requestId);
      if ("error" in result && result.error) {
        notify(result.error, false);
        return;
      }
      // Open in new tab — Supabase signed URLs go directly to the file.
      if ("url" in result && result.url) {
        window.open(result.url, "_blank", "noopener,noreferrer");
      }
    } finally {
      setAttachmentLoading(false);
    }
  }

  // Sempre ordenado pelo nº da requisição, do maior para o menor. A busca filtra
  // por nome do fornecedor, título ou nº da requisição (case-insensitive).
  const tabRequests = useMemo(() => {
    const term = search.trim().toLowerCase();
    const termDigits = term.replace(/\D/g, "");
    return requests
      .filter((r) => r.status === activeTab)
      .filter((r) => {
        if (!term) return true;
        const sup = resolveSupplier(r.ctrl_suppliers);
        if (sup?.name && sup.name.toLowerCase().includes(term)) return true;
        if (r.title.toLowerCase().includes(term)) return true;
        if (termDigits && String(r.request_number).startsWith(termDigits)) return true;
        return false;
      })
      .sort((a, b) => b.request_number - a.request_number);
  }, [requests, activeTab, search]);

  // Colunas do cabeçalho estilo Excel (ordenar + filtrar por valores). A última
  // coluna muda conforme a aba (vencimento / empresa pagadora / inativação).
  const columns = useMemo<ExcelColumn<ContasRequest>[]>(() => {
    const base: ExcelColumn<ContasRequest>[] = [
      { key: "requisicao", type: "text", getValue: (r) => r.title },
      {
        key: "fornecedor",
        type: "text",
        getValue: (r) => resolveSupplier(r.ctrl_suppliers)?.name ?? "",
      },
      {
        key: "valor",
        type: "number",
        getValue: (r) => Number(r.amount),
        label: (r) => fmt.format(Number(r.amount)),
      },
    ];
    if (activeTab === "agendado") {
      base.push({ key: "empresa", type: "text", getValue: (r) => r.paying_company ?? "" });
    } else {
      base.push({
        key: "vencimento",
        type: "date",
        getValue: (r) => r.due_date ?? null,
        label: (r) =>
          r.due_date
            ? new Intl.DateTimeFormat("pt-BR").format(new Date(r.due_date + "T00:00:00"))
            : "—",
      });
    }
    return base;
  }, [activeTab]);

  const { rows: displayed, headerProps, hasFilters, clearAll } = useExcelTable(tabRequests, columns);

  const selecionaveis = displayed.filter((r) => !naFila(r));
  const allSelected = selecionaveis.length > 0 && selecionaveis.every((r) => selected.has(r.id));

  const counts: Record<Tab, number> = {
    aprovado: requests.filter((r) => r.status === "aprovado").length,
    info_pagamento_pendente: requests.filter((r) => r.status === "info_pagamento_pendente").length,
    agendado: requests.filter((r) => r.status === "agendado").length,
  };

  function toggleAll() {
    // "Selecionar todas" ignora o que já está na fila do Omie.
    setSelected(
      allSelected ? new Set() : new Set(displayed.filter((r) => !naFila(r)).map((r) => r.id)),
    );
  }

  function toggle(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function notify(msg: string, ok = true, ms = 4000) {
    if (ok) setSuccess(msg); else setError(msg);
    setTimeout(() => { setSuccess(null); setError(null); }, ms);
  }

  /**
   * Só ENFILEIRA o lote — o lançamento no Omie fica com o cron
   * (`/api/cron/omie-launch-queue`), que solta uma requisição por empresa
   * pagadora por minuto. O usuário pode fechar a tela: as requisições ficam
   * nesta aba marcadas como "Enviando ao Omie" até o worker lançar.
   */
  function executarEnvio(decisoes?: Record<string, number | "novo">) {
    const ids = Array.from(selected);
    const companyId = payingCompanyId;
    if (ids.length === 0 || !companyId) return;

    startTransition(async () => {
      const result = await enqueueSendToPayment(ids, companyId, decisoes);
      if ("error" in result) {
        notify(String(result.error), false, 10000);
        return;
      }

      setSelected(new Set());
      setPayingCompanyId("");
      setShowEnviarModal(false);
      setPrevisaoPreview(null);
      setPrevisaoDecisoes({});
      router.refresh();
      notify(
        `${result.enfileiradas} requisição(ões) na fila de envio ao Omie. ` +
          `O envio acontece em segundo plano (cerca de 1 por minuto) — ` +
          `você pode fechar esta tela.`,
        true,
        10000,
      );
    });
  }

  function handleEnviar() {
    if (selected.size === 0 || !payingCompanyId) return;
    startTransition(async () => {
      const preview = await previewPrevisaoMatches(Array.from(selected), payingCompanyId);
      if ("error" in preview) {
        notify(preview.error, false);
        return;
      }
      const comPrevisao = preview.matches.filter((m) => m.previsao);
      if (comPrevisao.length === 0) {
        executarEnvio();
        return;
      }
      const iniciais: Record<string, number | "novo"> = {};
      for (const m of comPrevisao) iniciais[m.requestId] = m.previsao!.codigo;
      setPrevisaoDecisoes(iniciais);
      setPrevisaoPreview(comPrevisao);
      setShowEnviarModal(false);
    });
  }

  const totalSelected = tabRequests
    .filter((r) => selected.has(r.id))
    .reduce((s, r) => s + Number(r.amount), 0);

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {error && <div className="rounded-md bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</div>}
      {success && <div className="rounded-md bg-green-50 px-4 py-2 text-sm text-green-800 dark:bg-green-950/30 dark:text-green-300">{success}</div>}

      {/* Fila de envio ao Omie — drenada pelo cron, não depende desta tela */}
      {fila.length > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-violet-200 bg-violet-50 px-4 py-3 dark:border-violet-900 dark:bg-violet-950/30">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-violet-600 dark:text-violet-400" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium text-violet-900 dark:text-violet-200">
              Enviando {fila.length} requisição(ões) ao Omie...
            </p>
            <p className="mt-0.5 text-xs text-violet-700 dark:text-violet-300">
              O envio roda em segundo plano, cerca de 1 por minuto (a Omie bloqueia lançamentos
              muito próximos). Previsão de término: ~{formatarDuracao(fila.length * RITMO_ENVIO_MINUTOS)}.
              Você pode fechar esta tela — a lista se atualiza sozinha enquanto estiver aberta.
            </p>
          </div>
          <button
            type="button"
            onClick={() => router.refresh()}
            className="shrink-0 rounded-md border border-violet-300 bg-background px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-800 dark:text-violet-300 dark:hover:bg-violet-950"
          >
            Atualizar
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSelected(new Set()); }}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              activeTab === tab ? "bg-background shadow text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[tab]}
            {counts[tab] > 0 && (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${activeTab === tab ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                {counts[tab]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Busca */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por fornecedor, título ou nº..."
            className="w-full rounded-md border bg-background py-2 pl-9 pr-9 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Limpar busca"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {hasFilters && (
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        )}
      </div>

      {/* Content */}
      {displayed.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {search.trim() || hasFilters
            ? "Nenhuma requisição encontrada para a busca/filtros atuais."
            : "Nenhuma requisição nesta categoria."}
        </div>
      ) : (
        <div className="rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                {activeTab === "aprovado" && (
                  <th className="w-10 px-4 py-3">
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} className="h-4 w-4 rounded border-gray-300" />
                  </th>
                )}
                <th className="px-4 py-3"><ExcelHeaderCell label="Requisição" {...headerProps("requisicao")} /></th>
                <th className="px-4 py-3"><ExcelHeaderCell label="Fornecedor" {...headerProps("fornecedor")} /></th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">Dados de Pagamento</th>
                <th className="px-4 py-3"><ExcelHeaderCell label="Valor" align="right" {...headerProps("valor")} /></th>
                <th className="px-4 py-3">
                  {activeTab === "agendado" ? (
                    <ExcelHeaderCell label="Empresa / Enviado em" menuSide="right" {...headerProps("empresa")} />
                  ) : (
                    <ExcelHeaderCell label="Vencimento" menuSide="right" {...headerProps("vencimento")} />
                  )}
                </th>
                <th className="w-20 px-4 py-3 text-right font-medium text-muted-foreground"></th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {displayed.map((req) => {
                const sup = resolveSupplier(req.ctrl_suppliers);
                const isSelected = selected.has(req.id);
                // Na fila do Omie: não pode ser reenviada nem mexida até o worker concluir.
                const enfileirada = naFila(req);
                const clickable = activeTab === "aprovado" && !enfileirada;

                return (
                  <tr
                    key={req.id}
                    onClick={clickable ? () => toggle(req.id) : undefined}
                    className={`transition-colors ${clickable ? "cursor-pointer" : ""} ${isSelected ? "bg-violet-50 dark:bg-violet-950/30" : "hover:bg-muted/20"}`}
                  >
                    {activeTab === "aprovado" && (
                      <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          disabled={enfileirada}
                          onChange={() => toggle(req.id)}
                          className="h-4 w-4 rounded border-gray-300 disabled:opacity-40"
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <p className="font-medium line-clamp-1">{req.title}</p>
                      <p className="text-xs text-muted-foreground">#{req.request_number}</p>
                    </td>
                    <td className="px-4 py-3">
                      {sup ? (
                        <div>
                          <p className="font-medium">{sup.name}</p>
                          {sup.cnpj_cpf && <p className="text-xs text-muted-foreground">{sup.cnpj_cpf}</p>}
                        </div>
                      ) : <span className="text-xs text-muted-foreground">—</span>}
                    </td>
                    <td className="px-4 py-3"><PaymentInfo supplier={sup} /></td>
                    <td className="px-4 py-3 text-right font-medium">{fmt.format(Number(req.amount))}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {activeTab === "aprovado" && (
                        <div className="space-y-1">
                          <p>
                            {req.due_date
                              ? new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00"))
                              : "—"}
                          </p>
                          {enfileirada && (
                            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800 dark:bg-violet-950/40 dark:text-violet-300">
                              <Loader2 className="h-3 w-3 animate-spin" /> Enviando ao Omie
                            </span>
                          )}
                          {falhouNoEnvio(req) && (
                            <span
                              title={req.omie_launch_error ?? undefined}
                              className="inline-flex w-fit cursor-help items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950/40 dark:text-red-300"
                            >
                              Falha no envio ao Omie
                            </span>
                          )}
                        </div>
                      )}
                      {activeTab === "info_pagamento_pendente" && (
                        <div className="flex flex-col gap-1">
                          {req.due_date && (
                            <p>{new Intl.DateTimeFormat("pt-BR").format(new Date(req.due_date + "T00:00:00"))}</p>
                          )}
                          <span className="inline-flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                            <MessageCircle className="h-3 w-3" /> Aguardando resposta
                          </span>
                        </div>
                      )}
                      {activeTab === "agendado" && (
                        <div className="space-y-1">
                          {req.paying_company && <p className="font-medium text-sky-600">{req.paying_company}</p>}
                          {req.sent_to_payment_at && <p>{new Intl.DateTimeFormat("pt-BR").format(new Date(req.sent_to_payment_at))}</p>}
                          <OmieLaunchBadge
                            status={req.omie_launch_status}
                            error={req.omie_launch_error}
                            lancado={Boolean(req.omie_contapagar_codigo)}
                          />
                        </div>
                      )}
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          onClick={() => setDetail(req)}
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                        >
                          <Eye className="h-3.5 w-3.5" />
                          Detalhes
                        </button>
                        {canEditRouting && req.status === "aprovado" && !enfileirada && !req.omie_contapagar_codigo && (
                          <button
                            type="button"
                            onClick={() => setEditRouting(req)}
                            className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs font-medium text-sky-700 hover:bg-sky-100 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-300"
                            title="Corrigir setor, tipo de despesa ou método de pagamento antes do envio"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            Editar
                          </button>
                        )}
                        {canAskInfo && (req.status === "aprovado" || req.status === "info_pagamento_pendente") && (
                          <button
                            type="button"
                            onClick={() => setInfoModal({ req, mode: "ask" })}
                            className="inline-flex items-center gap-1 rounded-md border border-violet-200 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
                            title={req.status === "info_pagamento_pendente" ? "Continuar conversa" : "Pedir info ao solicitante"}
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            {req.status === "info_pagamento_pendente" ? "Continuar" : "Pedir info"}
                          </button>
                        )}
                        {/* Falhou na fila: volta para a fila, mantendo o espaçamento. */}
                        {falhouNoEnvio(req) && canSendToPayment && (
                          <RequeueButton requestId={req.id} onDone={() => router.refresh()} />
                        )}
                        {/* Falha no Omie ou lote antigo que ficou sem lançamento. */}
                        {activeTab === "agendado" &&
                          (req.omie_launch_status === "erro" || !req.omie_contapagar_codigo) &&
                          ctrlRoles.some((r) => ["contas_a_pagar", "csc", "admin"].includes(r)) && (
                          <ResyncButton requestId={req.id} onDone={() => router.refresh()} />
                        )}
                        {canReturnRow(req) && (
                          <button
                            type="button"
                            onClick={() => {
                              setReturnReason("");
                              setReturnModal(req);
                            }}
                            className="inline-flex items-center gap-1 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-100 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
                            title="Devolver para requisições (volta à aprovação; edição/exclusão liberadas)"
                          >
                            <CornerUpLeft className="h-3.5 w-3.5" />
                            Devolver
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Action bar — Aprovadas */}
      {activeTab === "aprovado" && displayed.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-4 py-3">
          {selected.size > 0 ? (
            <span className="text-sm text-muted-foreground">{selected.size} selecionada(s) · {fmt.format(totalSelected)}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Selecione as requisições para enviar ao pagamento.</span>
          )}
          <button
            onClick={() => setShowEnviarModal(true)}
            disabled={selected.size === 0 || isPending}
            className="ml-auto rounded-md bg-violet-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {`Enviar para Pagamento${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </button>
        </div>
      )}

      {/* Modal — Enviar para pagamento */}
      {showEnviarModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Enviar {selected.size} Requisição(ões) para Pagamento</h3>
            </div>
            <div className="px-6 py-4 space-y-4">
              {/* Resumo */}
              <div className="rounded-lg bg-muted/40 px-4 py-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Requisições:</span>
                  <span className="font-medium">{selected.size}</span>
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-muted-foreground">Total:</span>
                  <span className="font-bold text-violet-600">{fmt.format(totalSelected)}</span>
                </div>
                {selected.size > 1 && (
                  <div className="flex justify-between mt-1">
                    <span className="text-muted-foreground">Envio concluído em:</span>
                    <span className="font-medium">
                      ~{formatarDuracao(selected.size * RITMO_ENVIO_MINUTOS)}
                    </span>
                  </div>
                )}
              </div>

              <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                O lançamento no Omie roda em segundo plano, cerca de 1 requisição por minuto (a
                Omie bloqueia lançamentos muito próximos). Você não precisa deixar a tela aberta —
                as requisições ficam marcadas como &quot;Enviando ao Omie&quot; até serem lançadas.
              </p>

              {/* Select empresa pagadora */}
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Empresa Pagadora <span className="text-destructive">*</span>
                </label>
                <select
                  value={payingCompanyId}
                  onChange={(e) => setPayingCompanyId(e.target.value)}
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">Selecione a empresa pagadora</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                {companies.length === 0 && (
                  <p className="text-xs text-destructive">Nenhuma empresa com conexão Omie configurada.</p>
                )}
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => { setShowEnviarModal(false); setPayingCompanyId(""); }}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleEnviar}
                disabled={isPending || !payingCompanyId}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isPending ? "Verificando previsões..." : "Confirmar Envio"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Diálogo — Confirmar edição de previsões */}
      {previsaoPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-2xl rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">Previsões encontradas no Omie</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Para estes fornecedores existe uma previsão vencendo no mês. Escolha
                editar a previsão (atualiza valor, vencimento e demais campos) ou criar
                um título novo.
              </p>
            </div>
            <div className="max-h-[60vh] overflow-y-auto px-6 py-4 space-y-3">
              {previsaoPreview.map((m) => {
                const decisao = previsaoDecisoes[m.requestId];
                const editar = typeof decisao === "number";
                return (
                  <div key={m.requestId} className="rounded-lg border px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <p className="font-medium">
                          #{m.requestNumber} — {m.supplierName}
                        </p>
                        <p className="text-muted-foreground">
                          Previsão vence {m.previsao!.vencimento} · valor atual{" "}
                          {fmt.format(m.previsao!.valorAtual)} → novo {fmt.format(m.amount)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1 rounded-md border p-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            setPrevisaoDecisoes((p) => ({ ...p, [m.requestId]: m.previsao!.codigo }))
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            editar ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          Editar previsão
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setPrevisaoDecisoes((p) => ({ ...p, [m.requestId]: "novo" }))
                          }
                          className={`rounded px-2 py-1 text-xs font-medium ${
                            !editar ? "bg-violet-600 text-white" : "text-muted-foreground hover:bg-muted"
                          }`}
                        >
                          Criar novo
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setPrevisaoPreview(null);
                  setPrevisaoDecisoes({});
                }}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={() => executarEnvio(previsaoDecisoes)}
                disabled={isPending}
                className="rounded-md bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
              >
                {isPending ? "Enfileirando..." : "Confirmar e enviar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Devolver para requisições modal */}
      {returnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border bg-background shadow-lg">
            <div className="border-b px-6 py-4">
              <h3 className="font-semibold">
                Devolver requisição #{returnModal.request_number} para requisições
              </h3>
            </div>
            <div className="px-6 py-4 space-y-3">
              <p className="text-sm text-muted-foreground">
                A requisição volta para a aprovação e poderá ser editada, reaprovada
                ou excluída. O valor deixa de contar como realizado no orçamento.
              </p>
              {returnModal.omie_contapagar_codigo != null && (
                <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                  Esta requisição já foi enviada ao Omie. Ao devolver, o título será
                  <strong> excluído do Omie</strong> (se ainda não estiver pago).
                </div>
              )}
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Motivo da devolução <span className="text-destructive">*</span>
                </label>
                <textarea
                  value={returnReason}
                  onChange={(e) => setReturnReason(e.target.value)}
                  rows={3}
                  placeholder="Ex: valor incorreto, precisa reaprovar..."
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring resize-none"
                />
              </div>
            </div>
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button
                onClick={() => {
                  setReturnModal(null);
                  setReturnReason("");
                }}
                disabled={isPending}
                className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleDevolver}
                disabled={isPending || !returnReason.trim()}
                className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CornerUpLeft className="h-4 w-4" />}
                Devolver
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Detail modal */}
      {detail && (
        <RequestDetailModal
          req={detail}
          onClose={() => setDetail(null)}
          onOpenAttachment={openAttachment}
          attachmentLoading={attachmentLoading}
          showApprovalHistory
        />
      )}

      {/* Editar setor/tipo/método (setor|tipo retorna à aprovação; só método fica) */}
      {editRouting && (
        <EditExpenseRoutingModal
          req={editRouting}
          sectors={sectors}
          expenseTypes={expenseTypes}
          onClose={() => setEditRouting(null)}
          onSaved={() => {
            setEditRouting(null);
            notify("Requisição atualizada.");
            router.refresh();
          }}
        />
      )}

      {/* Payment info thread modal */}
      {infoModal && (
        <PaymentInfoThreadModal
          requestId={infoModal.req.id}
          requestNumber={infoModal.req.request_number}
          requestTitle={infoModal.req.title}
          mode={infoModal.mode}
          onClose={() => setInfoModal(null)}
          onSubmitted={() => router.refresh()}
        />
      )}
    </div>
  );
}

// ── Omie launch badge ────────────────────────────────────────────────────────

function OmieLaunchBadge({
  status,
  error,
  lancado,
}: {
  status?: string | null;
  error?: string | null;
  /** Já tem título no Omie. Sem status e sem título = lote interrompido antes desta. */
  lancado?: boolean;
}) {
  if (!status) {
    if (lancado) return null;
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">
        Aguardando envio ao Omie
      </span>
    );
  }
  if (status === "recebido") {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-green-800 dark:bg-green-950/40 dark:text-green-300">
        Recebido (Omie)
      </span>
    );
  }
  if (status === "lancado") {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
        Lançado (Omie)
      </span>
    );
  }
  if (status === "previsao_editada") {
    return (
      <span className="inline-flex w-fit items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        Previsão editada
      </span>
    );
  }
  if (status === "erro") {
    return (
      <span
        title={error ?? undefined}
        className="inline-flex w-fit cursor-help items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-red-800 dark:bg-red-950/40 dark:text-red-300"
      >
        Falha Omie
      </span>
    );
  }
  return null;
}

// ── Requeue button ────────────────────────────────────────────────────────────
// Requisição que falhou no lançamento volta para a fila (não chama a Omie aqui:
// quem lança é o cron, respeitando o espaçamento anti-duplicidade).

function RequeueButton({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleRequeue(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await requeueRequestToOmie(requestId);
      if ("error" in result) {
        setFeedback(`Erro: ${result.error}`);
      } else {
        setFeedback("Na fila");
        onDone();
      }
      setTimeout(() => setFeedback(null), 4000);
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleRequeue}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300"
        title="Recolocar na fila de envio ao Omie"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Tentar enviar de novo
      </button>
      {feedback && <p className="text-[10px] text-muted-foreground">{feedback}</p>}
    </div>
  );
}

// ── Resync button ─────────────────────────────────────────────────────────────

function ResyncButton({ requestId, onDone }: { requestId: string; onDone: () => void }) {
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  function handleResync(e: React.MouseEvent) {
    e.stopPropagation();
    startTransition(async () => {
      const result = await resyncContaPagar(requestId);
      if ("error" in result) {
        setFeedback(`Erro: ${result.error}`);
      } else {
        setFeedback(`OK (${result.status})`);
        onDone();
      }
      setTimeout(() => setFeedback(null), 4000);
    });
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      <button
        type="button"
        onClick={handleResync}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-md border border-orange-200 bg-orange-50 px-2.5 py-1 text-xs font-medium text-orange-700 hover:bg-orange-100 disabled:opacity-50 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300"
      >
        {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        Reenviar ao Omie
      </button>
      {feedback && <p className="text-[10px] text-muted-foreground">{feedback}</p>}
    </div>
  );
}
