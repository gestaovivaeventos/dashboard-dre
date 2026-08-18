"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Paperclip, X } from "lucide-react";

import {
  approveRequest,
  rejectRequest,
  batchApproveRequests,
  getRequestAttachmentUrl,
} from "@/lib/ctrl/actions/requests";
import { InfoThreadModal } from "@/components/ctrl/payment-info-thread-modal";
import { ApprovalHistory, type PendingStage } from "@/components/ctrl/approval-history";
import { ExtraAttachments } from "@/components/ctrl/request-detail-modal";
import { SupplierNotApprovedBadge } from "@/components/ctrl/supplier-status-badge";
import { ExcelHeaderCell, useExcelTable, type ExcelColumn } from "@/components/ctrl/excel-table";
import { isForcedDirectorRouting } from "@/lib/ctrl/routing";
import { formatDateBR, formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";

type Req = {
  id: string;
  request_number: number;
  title: string;
  amount: number;
  status: string;
  // Etapa de origem guardada quando entra em complementação (gerente/diretor),
  // usada para decidir a aprovação de dentro da própria aba de Complementação.
  complement_return_status?: string | null;
  approval_tier: string | null;
  sector_id?: string | null;
  description: string | null;
  justification: string | null;
  observations: string | null;
  payment_method: string | null;
  due_date: string | null;
  created_at: string;
  created_by: string;
  // Preenchido quando o título foi efetivamente PAGO (baixado) no Omie — vira o
  // status "Pago", sobrepondo "Enviado Pgto" (igual à tela de Requisições).
  omie_paid_at?: string | null;
  // Anexo principal (boleto/nota/contrato) + anexos diversos — o aprovador
  // precisa ver o documento antes de aprovar.
  attachment_path?: string | null;
  extra_attachment_paths?: string[] | null;
  favorecido?: string | null;
  ctrl_sectors?: { name: string } | { name: string }[] | null;
  ctrl_expense_types?: { name: string } | { name: string }[] | null;
  ctrl_events?: { name: string } | { name: string }[] | null;
  // `status` = homologação do fornecedor (ctrl_suppliers.status). Opcional: sem
  // o campo o selo de "não homologado" simplesmente não aparece.
  ctrl_suppliers?: { name: string; status?: string | null } | null;
  creator?: { name: string | null; email: string } | null;
  approver?: { name: string | null } | null;
  // Rateio entre setores (aprovação própria de cada setor).
  is_rateio?: boolean | null;
  ctrl_request_sectors?: Array<{
    sector_id: string;
    amount: number;
    status: string;
    approval_tier: string;
    ctrl_sectors?: { name: string } | { name: string }[] | null;
  }> | null;
};

// Rótulo curto do status da parcela de rateio (por setor).
const RATEIO_SECTOR_STATUS: Record<string, string> = {
  pendente: "aguardando gerente",
  pendente_diretor: "aguardando diretor",
  aprovado: "aprovado",
  rejeitado: "rejeitado",
};

type Tab = "pendente" | "aguardando_complementacao" | "aprovado" | "rejeitado";

// A aba "Aprovadas" reúne todo o histórico do que passou pela aprovação: a que
// ainda aguarda envio (aprovado) e as que já seguiram para o Contas a Pagar
// (agendado / info pendente). Todas foram aprovadas.
const APPROVED_HISTORY = new Set(["aprovado", "agendado", "info_pagamento_pendente"]);

const TAB_LABELS: Record<Tab, string> = {
  pendente: "Pendentes",
  aguardando_complementacao: "Complementação",
  aprovado: "Aprovadas",
  rejeitado: "Rejeitadas",
};

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  pendente:                    { label: "Aguardando Gerente", cls: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300" },
  pendente_diretor:            { label: "Aguardando Diretor", cls: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-300" },
  aprovado:                    { label: "Aprovado",        cls: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300" },
  rejeitado:                   { label: "Rejeitado",       cls: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300" },
  aguardando_complementacao:   { label: "Complementação",  cls: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300" },
  agendado:                    { label: "Enviado Pgto",    cls: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300" },
  info_pagamento_pendente:     { label: "Info pendente",   cls: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300" },
};

// "Pago" (título baixado no Omie) sobrepõe o rótulo do status (a requisição segue
// com status 'agendado' por baixo). Mesmo critério da tela de Requisições.
const PAGO_BADGE = { label: "Pago", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300" };
const isPaid = (r: Req) => Boolean(r.omie_paid_at);

const PAYMENT_LABELS: Record<string, string> = {
  boleto: "Boleto", pix: "PIX", transferencia: "Transferência",
  cartao_credito: "Cartão de Crédito", cartao_prepago: "Cartão Pré-Pago", dinheiro: "Dinheiro",
};

const fmt = new Intl.NumberFormat("pt-BR", { style: "decimal", minimumFractionDigits: 2, maximumFractionDigits: 2 });

function resolve<T>(v: T | T[] | null | undefined): T | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

interface Props {
  requests: Req[];
  ctrlRoles: string[];
  // Setores pelos quais o diretor é responsável (user_sectors). Não filtram a
  // visibilidade (o diretor vê tudo) — servem para separar visualmente "seu
  // setor" das demais requisições na tela.
  ownSectorIds?: string[];
  // Liga o destaque "Do seu setor" mesmo fora do perfil diretor (ex.: admin que
  // também é diretor de aprovação de setores específicos — override por e-mail no
  // servidor). Quando true, `ownSectorIds` já vem resolvido para esses setores.
  forceSectorGroups?: boolean;
  // Setores em que o usuário pode APROVAR, quando a alçada é menor que a
  // visibilidade (visão completa do módulo — ver @/lib/ctrl/full-view). null =
  // sem restrição: a alçada é a de sempre. É só UI — a trava é no servidor.
  actionSectorIds?: string[] | null;
  // Ids de requisições em complementação aguardando análise do aprovador
  // (último turno foi resposta do solicitante). Alimenta o alerta da aba.
  awaitingApproverIds?: string[];
}

export function AprovacoesClient({ requests, ctrlRoles, ownSectorIds = [], forceSectorGroups = false, actionSectorIds = null, awaitingApproverIds = [] }: Props) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<Tab>("pendente");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState<{ req: Req; mode: "reject" | "detail" } | null>(null);
  // Conversa de complementação (pedir info / responder) — thread completa.
  const [threadModal, setThreadModal] = useState<{ req: Req; mode: "ask" | "answer" } | null>(null);
  const [textInput, setTextInput] = useState("");
  const [feedback, setFeedback] = useState<{ msg: string; ok: boolean } | null>(null);
  const [isPending, startTransition] = useTransition();

  const hasRole = (...roles: string[]) => ctrlRoles.some((r) => roles.includes(r));
  const canApprove = hasRole("gerente", "diretor", "csc", "admin");

  const awaitingSet = new Set(awaitingApproverIds);

  // Setores tocados pela requisição: o próprio, ou os das parcelas no rateio
  // (cada parcela tem sua etapa de aprovação, no orçamento do SEU setor).
  const sectorsOf = (r: Req): string[] =>
    r.is_rateio && r.ctrl_request_sectors?.length
      ? r.ctrl_request_sectors.map((p) => p.sector_id)
      : r.sector_id
      ? [r.sector_id]
      : [];

  // Alçada menor que a visibilidade (visão completa do módulo): só pode agir nas
  // requisições que tocam um setor dele. Sem restrição => tudo que ele vê.
  const actionSectorSet = actionSectorIds ? new Set(actionSectorIds) : null;
  const inActionScope = (r: Req) =>
    !actionSectorSet || sectorsOf(r).some((s) => actionSectorSet.has(s));

  // Etapa atual da requisição e se o usuário pode agir nela.
  // pendente → etapa do gerente (gerente/diretor/csc/admin podem aprovar);
  // pendente_diretor → etapa do diretor (só diretor/csc/admin).
  // aguardando_complementacao → o aprovador decide aqui mesmo, usando a etapa de
  // origem (complement_return_status) para saber quem pode aprovar.
  const isPendingStatus = (s: string) => s === "pendente" || s === "pendente_diretor";
  const canActOn = (r: Req) => {
    if (!inActionScope(r)) return false;
    const stage =
      r.status === "aguardando_complementacao"
        ? r.complement_return_status ?? "pendente"
        : r.status;
    return stage === "pendente_diretor"
      ? hasRole("diretor", "csc", "admin")
      : stage === "pendente"
      ? canApprove
      : false;
  };

  // Aba "Pendentes" agrupa as duas etapas de pendência; "Aprovadas" reúne todo o
  // histórico (aprovado + enviadas ao pagamento); as demais casam o status exato.
  const filteredRequests =
    activeTab === "pendente"
      ? requests.filter((r) => isPendingStatus(r.status))
      : activeTab === "aprovado"
      ? requests.filter((r) => APPROVED_HISTORY.has(r.status))
      : requests.filter((r) => r.status === activeTab);

  // Cabeçalho estilo Excel (ordenar + filtrar por valores), igual ao de Requisições.
  const columns = useMemo<ExcelColumn<Req>[]>(
    () => [
      { key: "numero", type: "number", getValue: (r) => r.request_number, label: (r) => `#${r.request_number}` },
      { key: "requisicao", type: "text", getValue: (r) => r.title },
      {
        key: "fornecedor",
        type: "text",
        getValue: (r) => resolve(r.ctrl_suppliers)?.name ?? r.favorecido ?? "",
      },
      {
        key: "setor",
        type: "text",
        getValue: (r) =>
          r.is_rateio
            ? `Rateio (${r.ctrl_request_sectors?.length ?? 0} setores)`
            : resolve(r.ctrl_sectors)?.name ?? "",
      },
      { key: "valor", type: "number", getValue: (r) => r.amount, label: (r) => fmt.format(r.amount) },
      { key: "vencimento", type: "date", getValue: (r) => r.due_date ?? null, label: (r) => formatDayBR(r.due_date) },
      { key: "criado", type: "date", getValue: (r) => r.created_at ?? null, label: (r) => formatDateBR(r.created_at) },
      {
        key: "solicitante",
        type: "text",
        getValue: (r) => (r.creator ? r.creator.name ?? r.creator.email : ""),
      },
    ],
    [],
  );
  const { rows: tabRequests, headerProps, hasFilters, clearAll } = useExcelTable(filteredRequests, columns);

  // Diretor (ou responsável marcado via override) com setores vinculados: separa
  // visualmente as requisições do(s) setor(es) sob sua responsabilidade das
  // demais. Ele vê TODAS de qualquer forma (visão global no getRequests) — a
  // separação é só de leitura.
  const ownSectorSet = new Set(ownSectorIds);
  const groupByOwnSector =
    (hasRole("diretor") || forceSectorGroups) && ownSectorSet.size > 0;
  // Quem tem alçada menor que a visibilidade (visão completa do módulo) conta o
  // rateio pelos setores das PARCELAS: a parcela que cai no setor dele depende
  // da sua aprovação, e pelo `sector_id` ela ficaria escondida em "Demais
  // setores" — justamente o que a separação existe para evitar. Para o diretor,
  // o agrupamento segue como sempre foi (só o setor primário).
  const isOwnSector = (r: Req) =>
    groupByOwnSector &&
    (actionSectorSet
      ? sectorsOf(r).some((s) => ownSectorSet.has(s))
      : !!r.sector_id && ownSectorSet.has(r.sector_id));
  const mineRows = groupByOwnSector ? tabRequests.filter(isOwnSector) : [];
  const otherRows = groupByOwnSector
    ? tabRequests.filter((r) => !isOwnSector(r))
    : tabRequests;
  // Diretor/responsável sempre vê as duas seções — mesmo que uma esteja vazia —
  // para deixar claro quando não há nada do seu setor a aprovar (a seção vazia
  // ganha uma mensagem de aviso). O bloco só aparece quando o tab tem alguma
  // requisição (fora daqui já há o vazio "Nenhuma requisição nesta categoria").
  const showSectorGroups = groupByOwnSector;
  const showCheckboxCol = activeTab === "pendente" && canApprove;
  // Colunas fixas: #, Requisição, Fornecedor, Setor, Valor, Vencimento, Criado,
  // Solicitante, Anexos, Ações = 10 (+ checkbox quando na aba Pendentes).
  const colCount = (showCheckboxCol ? 1 : 0) + 10;

  const pendentes = requests.filter((r) => isPendingStatus(r.status));
  // Só dá pra selecionar/aprovar em lote as que o usuário pode agir nesta etapa.
  // "Selecionar todas" respeita os filtros do cabeçalho: só as visíveis (tabRequests).
  const visibleActionable =
    activeTab === "pendente" ? tabRequests.filter(canActOn) : [];
  const allSelected =
    visibleActionable.length > 0 &&
    visibleActionable.every((r) => selected.has(r.id));

  const counts: Record<Tab, number> = {
    pendente: pendentes.length,
    aguardando_complementacao: requests.filter((r) => r.status === "aguardando_complementacao").length,
    aprovado: requests.filter((r) => APPROVED_HISTORY.has(r.status)).length,
    rejeitado: requests.filter((r) => r.status === "rejeitado").length,
  };

  function notify(msg: string, ok = true) {
    setFeedback({ msg, ok });
    setTimeout(() => setFeedback(null), 4000);
  }

  // Abre o anexo principal (boleto/nota/contrato) em nova aba, via URL assinada.
  async function openAttachment(requestId: string) {
    const res = await getRequestAttachmentUrl(requestId);
    if (res && "url" in res && res.url) {
      window.open(res.url, "_blank", "noopener,noreferrer");
    } else if (res && "error" in res && res.error) {
      notify(res.error, false);
    }
  }

  function toggleSelect(id: string) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }

  function openModal(req: Req, mode: "reject" | "detail") {
    setTextInput("");
    setModal({ req, mode });
  }

  function closeModal() {
    setModal(null);
    setTextInput("");
  }

  function handleAction(fn: () => Promise<unknown>) {
    startTransition(async () => {
      const res = await fn() as { ok?: boolean; error?: string } | undefined;
      if (res && "error" in res && res.error) { notify(res.error, false); }
      else { closeModal(); notify("Ação realizada com sucesso."); setSelected(new Set()); router.refresh(); }
    });
  }

  function handleBatchApprove() {
    handleAction(() => batchApproveRequests(Array.from(selected)));
  }

  return (
    <div className="space-y-4">
      {/* Feedback */}
      {feedback && (
        <div className={`rounded-md px-4 py-2 text-sm ${feedback.ok ? "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300" : "bg-destructive/10 text-destructive"}`}>
          {feedback.msg}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/40 p-1 overflow-x-auto">
        {(Object.keys(TAB_LABELS) as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => { setActiveTab(tab); setSelected(new Set()); }}
            className={`flex-1 min-w-max rounded-md px-3 py-1.5 text-sm font-medium transition-colors whitespace-nowrap ${
              activeTab === tab
                ? "bg-background shadow text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {TAB_LABELS[tab]}
            {tab === "aguardando_complementacao" && awaitingApproverIds.length > 0 ? (
              // Alerta: há resposta(s) do solicitante aguardando análise.
              <span
                className="ml-1.5 inline-flex items-center gap-1 rounded-full bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300"
                title="Há novas respostas aguardando sua análise"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                {awaitingApproverIds.length}
              </span>
            ) : counts[tab] > 0 ? (
              <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs ${activeTab === tab ? "bg-violet-100 text-violet-700" : "bg-muted text-muted-foreground"}`}>
                {counts[tab]}
              </span>
            ) : null}
          </button>
        ))}
      </div>

      {/* Batch actions bar (pendentes) */}
      {activeTab === "pendente" && canApprove && pendentes.length > 0 && (
        <div className="flex items-center gap-3 rounded-lg border bg-muted/30 px-4 py-2">
          <label className="flex items-center gap-2 cursor-pointer text-sm">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(visibleActionable.map((r) => r.id)))}
              className="h-4 w-4 rounded border-gray-300"
            />
            Selecionar todas
          </label>
          {selected.size > 0 && (
            <>
              <span className="text-sm text-muted-foreground">{selected.size} selecionada(s)</span>
              <button
                onClick={handleBatchApprove}
                disabled={isPending}
                className="ml-auto rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              >
                {isPending ? "Aprovando..." : `Aprovar selecionadas (${selected.size})`}
              </button>
            </>
          )}
        </div>
      )}

      {/* Barra de filtros ativos (cabeçalho estilo Excel) */}
      {hasFilters && (
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>
            {tabRequests.length} de {filteredRequests.length} requisição{filteredRequests.length === 1 ? "" : "ões"}
          </span>
          <button
            type="button"
            onClick={clearAll}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-2.5 py-1 font-medium hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
            Limpar filtros
          </button>
        </div>
      )}

      {/* Request table */}
      {tabRequests.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {filteredRequests.length > 0
            ? "Nenhuma requisição para os filtros atuais."
            : "Nenhuma requisição nesta categoria."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                {activeTab === "pendente" && canApprove && <th className="w-10 px-3 py-2" />}
                <th className="px-3 py-2"><ExcelHeaderCell label="#" {...headerProps("numero")} /></th>
                <th className="px-3 py-2"><ExcelHeaderCell label="Requisição" {...headerProps("requisicao")} /></th>
                <th className="px-3 py-2"><ExcelHeaderCell label="Fornecedor" {...headerProps("fornecedor")} /></th>
                <th className="px-3 py-2"><ExcelHeaderCell label="Setor" {...headerProps("setor")} /></th>
                <th className="px-3 py-2"><ExcelHeaderCell label="Valor" align="right" {...headerProps("valor")} /></th>
                <th className="px-3 py-2"><ExcelHeaderCell label="Vencimento" {...headerProps("vencimento")} /></th>
                <th className="px-3 py-2"><ExcelHeaderCell label="Criado em" {...headerProps("criado")} /></th>
                <th className="px-3 py-2"><ExcelHeaderCell label="Solicitante" menuSide="right" {...headerProps("solicitante")} /></th>
                <th className="px-3 py-2 font-medium uppercase tracking-wide text-muted-foreground">Anexos</th>
                <th className="px-3 py-2 font-medium text-right uppercase tracking-wide">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(() => {
              const renderRow = (req: Req) => {
                const sector = resolve(req.ctrl_sectors);
                const supplier = resolve(req.ctrl_suppliers);
                const actionable = canActOn(req);
                const canSelectThis = activeTab === "pendente" && actionable;
                // Roteado ao diretor por regra (setor Diretoria / solicitante
                // especial) — não é "fora do orçamento".
                const isForcedDirector = isForcedDirectorRouting({
                  sector_id: req.sector_id,
                  created_by: req.created_by,
                });
                // "Fora do orçamento" só quando o nível 3 vem do orçamento, não
                // do roteamento forçado (cobre também dados antigos, cujo tier
                // foi marcado nível 3 pela regra de setor).
                const isOverBudget = req.approval_tier === "nivel_3" && !isForcedDirector;
                const isSelected = canSelectThis && selected.has(req.id);

                return (
                  <tr
                    key={req.id}
                    className={`align-top transition-colors ${isSelected ? "bg-violet-50 dark:bg-violet-950/20" : "hover:bg-muted/20"} ${showSectorGroups && isOwnSector(req) ? "shadow-[inset_3px_0_0_#8b5cf6]" : ""}`}
                  >
                    {activeTab === "pendente" && canApprove && (
                      <td className="px-3 py-3">
                        {canSelectThis && (
                          <input
                            type="checkbox"
                            checked={selected.has(req.id)}
                            onChange={() => toggleSelect(req.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        )}
                      </td>
                    )}
                    <td className="px-3 py-3 font-mono text-xs text-muted-foreground whitespace-nowrap">#{req.request_number}</td>
                    <td className="px-3 py-3 min-w-[200px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{req.title}</span>
                        {(() => { const b = isPaid(req) ? PAGO_BADGE : STATUS_BADGE[req.status]; return b ? <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.label}</span> : null; })()}
                        {isOverBudget && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30">
                            Fora do orçamento
                          </span>
                        )}
                        {isForcedDirector && (
                          <span className="inline-flex rounded-full px-2 py-0.5 text-xs font-semibold bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300">
                            Direto ao Diretor
                          </span>
                        )}
                        {awaitingSet.has(req.id) && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-900/40 dark:text-red-300">
                            <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" />
                            Nova resposta
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                      <span className="inline-flex flex-wrap items-center gap-1.5">
                        {supplier?.name || req.favorecido || "—"}
                        {supplier ? <SupplierNotApprovedBadge status={supplier.status} /> : null}
                      </span>
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {req.is_rateio ? (
                        <span
                          className="inline-flex items-center rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-800 dark:bg-violet-950/40 dark:text-violet-300"
                          title={(req.ctrl_request_sectors ?? [])
                            .map((s) => `${resolve(s.ctrl_sectors)?.name ?? "Setor"}: ${fmt.format(Number(s.amount))} (${RATEIO_SECTOR_STATUS[s.status] ?? s.status})`)
                            .join(" · ")}
                        >
                          Rateio ({req.ctrl_request_sectors?.length ?? 0} setores)
                        </span>
                      ) : (
                        sector?.name ?? "—"
                      )}
                    </td>
                    <td className="px-3 py-3 text-right whitespace-nowrap tabular-nums">{fmt.format(req.amount)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">
                      {formatDayBR(req.due_date)}
                    </td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{formatDateBR(req.created_at)}</td>
                    <td className="px-3 py-3 whitespace-nowrap text-muted-foreground">{req.creator ? (req.creator.name ?? req.creator.email) : "—"}</td>
                    <td className="px-3 py-3 whitespace-nowrap">
                      {req.attachment_path ? (
                        <button
                          type="button"
                          onClick={() => openAttachment(req.id)}
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                          title="Abrir o anexo principal (boleto/nota/contrato)"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          Anexo
                        </button>
                      ) : (req.extra_attachment_paths?.length ?? 0) > 0 ? (
                        <button
                          type="button"
                          onClick={() => openModal(req, "detail")}
                          className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                          title="Ver anexos nos detalhes"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          Anexos
                        </button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex shrink-0 flex-wrap justify-end gap-2">
                        <button
                          onClick={() => openModal(req, "detail")}
                          className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted transition-colors"
                        >
                          Detalhes
                        </button>

                        {/* Approver actions on pendente / pendente_diretor */}
                        {actionable && (
                          <>
                            <button
                              onClick={() => handleAction(() => approveRequest(req.id))}
                              disabled={isPending}
                              className="rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                            >
                              Aprovar
                            </button>
                            <button
                              onClick={() => setThreadModal({ req, mode: "ask" })}
                              className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                            >
                              Pedir Info
                            </button>
                            <button
                              onClick={() => openModal(req, "reject")}
                              className="rounded-md bg-red-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                            >
                              Rejeitar
                            </button>
                          </>
                        )}

                        {/* Não-aprovador (ex.: o próprio solicitante) responde aqui;
                            o aprovador decide via Aprovar/Rejeitar/Pedir Info acima. */}
                        {req.status === "aguardando_complementacao" && !actionable && inActionScope(req) && (
                          <button
                            onClick={() => setThreadModal({ req, mode: "answer" })}
                            className="rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 transition-colors"
                          >
                            Responder
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              };

              const emptyGroupRow = (message: string) => (
                <tr>
                  <td colSpan={colCount} className="px-4 py-4 text-center text-xs text-muted-foreground">
                    {message}
                  </td>
                </tr>
              );

              if (showSectorGroups) {
                return (
                  <>
                    <SectorGroupHeader label="Do seu setor" count={mineRows.length} tone="own" colCount={colCount} />
                    {mineRows.length > 0
                      ? mineRows.map(renderRow)
                      : emptyGroupRow("Nenhuma requisição do seu setor nesta categoria.")}
                    <SectorGroupHeader label="Demais setores" count={otherRows.length} tone="other" colCount={colCount} />
                    {otherRows.length > 0
                      ? otherRows.map(renderRow)
                      : emptyGroupRow("Nenhuma requisição dos demais setores nesta categoria.")}
                  </>
                );
              }
              return tabRequests.map(renderRow);
              })()}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border bg-background shadow-lg">
            {/* Modal header */}
            <div className="border-b px-6 py-4 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">
                  {modal.mode === "detail" && `Requisição #${modal.req.request_number}`}
                  {modal.mode === "reject" && "Rejeitar Requisição"}
                </h3>
                <p className="text-sm text-muted-foreground">{modal.req.title}</p>
              </div>
              <button onClick={closeModal} className="text-muted-foreground hover:text-foreground text-xl leading-none">&times;</button>
            </div>

            {/* Modal body */}
            <div className="px-6 py-4 space-y-4 max-h-[60vh] overflow-y-auto">
              {/* Detail view */}
              {modal.mode === "detail" && (
                <div className="space-y-3 text-sm">
                  <Row label="Valor" value={fmt.format(modal.req.amount)} />
                  <Row label="Status" value={isPaid(modal.req) ? "Pago" : STATUS_BADGE[modal.req.status]?.label ?? modal.req.status} />
                  {modal.req.is_rateio && (modal.req.ctrl_request_sectors?.length ?? 0) > 0 ? (
                    <div>
                      <p className="text-muted-foreground">Rateio por setor</p>
                      <div className="mt-1 space-y-1 rounded-md border bg-muted/10 p-2">
                        {(modal.req.ctrl_request_sectors ?? []).map((s, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 text-xs">
                            <span className="font-medium">{resolve(s.ctrl_sectors)?.name ?? "Setor"}</span>
                            <span className="tabular-nums">{fmt.format(Number(s.amount))}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 ${
                                s.status === "aprovado"
                                  ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300"
                                  : s.status === "rejeitado"
                                  ? "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300"
                                  : "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300"
                              }`}
                            >
                              {RATEIO_SECTOR_STATUS[s.status] ?? s.status}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    modal.req.ctrl_sectors && <Row label="Setor" value={resolve(modal.req.ctrl_sectors)?.name ?? "—"} />
                  )}
                  {modal.req.ctrl_expense_types && <Row label="Tipo" value={resolve(modal.req.ctrl_expense_types)?.name ?? "—"} />}
                  <Row label="Evento" value={resolve(modal.req.ctrl_events)?.name ?? "Nenhum evento"} />
                  {modal.req.ctrl_suppliers && (
                    <div className="flex gap-2">
                      <span className="shrink-0 w-36 text-muted-foreground">Fornecedor:</span>
                      <span className="flex flex-wrap items-center gap-1.5 font-medium break-words">
                        {resolve(modal.req.ctrl_suppliers)?.name ?? "—"}
                        <SupplierNotApprovedBadge
                          status={resolve(modal.req.ctrl_suppliers)?.status}
                        />
                      </span>
                    </div>
                  )}
                  {modal.req.payment_method && <Row label="Pagamento" value={PAYMENT_LABELS[modal.req.payment_method] ?? modal.req.payment_method} />}
                  {modal.req.due_date && <Row label="Vencimento" value={formatDayBR(modal.req.due_date)} />}
                  {modal.req.approval_tier && (
                    <Row
                      label="Nível de aprovação"
                      value={
                        isForcedDirectorRouting({
                          sector_id: modal.req.sector_id,
                          created_by: modal.req.created_by,
                        })
                          ? "Diretor (direto — regra do setor)"
                          : modal.req.approval_tier === "nivel_3"
                            ? "Diretor (fora do orçamento)"
                            : "Gerente (nível 2)"
                      }
                    />
                  )}
                  {modal.req.creator && <Row label="Solicitante" value={modal.req.creator.name ?? modal.req.creator.email} />}
                  {modal.req.description && <Row label="Descrição" value={modal.req.description} />}
                  {modal.req.justification && <Row label="Justificativa" value={modal.req.justification} />}
                  {modal.req.observations && <Row label="Observações" value={modal.req.observations} />}
                  <Row label="Criado em" value={formatDateTimeBR(modal.req.created_at)} />

                  {/* Anexos diversos — para o aprovador conferir os documentos
                      antes de aprovar/enviar à Omie. */}
                  <ExtraAttachments
                    requestId={modal.req.id}
                    count={modal.req.extra_attachment_paths?.length ?? 0}
                  />

                  <div className="border-t pt-4 mt-4">
                    <ApprovalHistory requestId={modal.req.id} pending={pendingStage(modal.req)} />
                  </div>
                </div>
              )}

              {/* Reject */}
              {modal.mode === "reject" && (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Informe o motivo da rejeição (obrigatório):
                  </p>
                  <textarea
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    rows={4}
                    placeholder="Ex: Despesa não autorizada no orçamento..."
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none ring-offset-background focus:ring-2 focus:ring-ring focus:ring-offset-2 resize-none"
                  />
                </div>
              )}
            </div>

            {/* Modal footer */}
            <div className="border-t px-6 py-4 flex justify-end gap-3">
              <button onClick={closeModal} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors">
                Fechar
              </button>
              {modal.mode === "reject" && (
                <button
                  onClick={() => handleAction(() => rejectRequest(modal.req.id, textInput))}
                  disabled={isPending || !textInput.trim()}
                  className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
                >
                  {isPending ? "Rejeitando..." : "Confirmar Rejeição"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Conversa de complementação — histórico completo + pedir/responder */}
      {threadModal && (
        <InfoThreadModal
          variant="complement"
          mode={threadModal.mode}
          requestId={threadModal.req.id}
          requestNumber={threadModal.req.request_number}
          requestTitle={threadModal.req.title}
          onClose={() => setThreadModal(null)}
          onSubmitted={() => {
            const wasAsk = threadModal.mode === "ask";
            setThreadModal(null);
            notify(wasAsk ? "Pergunta enviada ao solicitante." : "Resposta enviada.");
            setSelected(new Set());
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

// Cabeçalho de seção na tabela de aprovações — separa "Do seu setor" das
// "Demais setores" para o diretor. Linha discreta que ocupa toda a largura.
function SectorGroupHeader({
  label,
  count,
  tone,
  colCount,
}: {
  label: string;
  count: number;
  tone: "own" | "other";
  colCount: number;
}) {
  return (
    <tr className="bg-muted/50">
      <td
        colSpan={colCount}
        className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          <span
            className={`h-2 w-2 rounded-full ${tone === "own" ? "bg-violet-500" : "bg-muted-foreground/40"}`}
          />
          {label}
          <span className="font-normal normal-case text-muted-foreground/70">· {count}</span>
        </span>
      </td>
    </tr>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="shrink-0 w-36 text-muted-foreground">{label}:</span>
      <span className="font-medium break-words">{value}</span>
    </div>
  );
}

// Etapa que ainda aguarda decisão, derivada do status atual da requisição.
// aguardando_complementacao usa a etapa de origem guardada (mesma lógica de
// canActOn). Retorna null quando não há etapa pendente (aprovado/rejeitado/etc).
function pendingStage(req: Req): PendingStage {
  const stage =
    req.status === "aguardando_complementacao"
      ? req.complement_return_status ?? "pendente"
      : req.status;
  if (stage === "pendente") return "gerente";
  if (stage === "pendente_diretor") return "diretor";
  return null;
}
