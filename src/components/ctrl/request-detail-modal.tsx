"use client";

import { useEffect, useState } from "react";
import { Download, ExternalLink, FileText, Loader2, Paperclip, X } from "lucide-react";

import { ApprovalHistory } from "@/components/ctrl/approval-history";
import { SupplierNotApprovedBadge } from "@/components/ctrl/supplier-status-badge";
import {
  getRequestExtraAttachments,
  type RequestExtraAttachment,
} from "@/lib/ctrl/actions/requests";
import { formatDateTimeBR, formatDayBR } from "@/lib/ctrl/datetime";

// ── Tipos compartilhados ──────────────────────────────────────────────────────

export type Supplier = {
  name: string;
  cnpj_cpf: string | null;
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  // Status de homologação (ctrl_suppliers.status). Opcional porque nem toda
  // consulta traz a coluna; quando ausente, o selo de "não homologado" não é
  // exibido — a trava de verdade é do servidor.
  status?: string | null;
};

export type NamedRef = { name: string } | { name: string }[] | null;

// Parcela de um rateio: um setor com seu valor e o status da aprovação dele.
export type RateioPortion = {
  sector_id: string;
  amount: number;
  status?: string | null;
  approval_tier?: string | null;
  ctrl_sectors?: NamedRef;
};
export type UserRef =
  | { name: string | null; email: string | null }
  | Array<{ name: string | null; email: string | null }>
  | null;

// Conjunto de campos de uma requisição usado pelo modal de detalhes (e pela
// tabela de contas a pagar). Compartilhado entre as duas telas.
export type RequestDetail = {
  id: string;
  request_number: number;
  title: string;
  description?: string | null;
  amount: number;
  due_date: string | null;
  reference_month?: number | null;
  reference_year?: number | null;
  status: string;
  paying_company?: string | null;
  paying_company_id?: string | null;
  omie_launch_status?: string | null;
  omie_contapagar_codigo?: number | null;
  omie_launch_error?: string | null;
  sent_to_payment_at?: string | null;
  // Preenchido quando o título foi efetivamente PAGO (baixado) no Omie.
  omie_paid_at?: string | null;
  // Compra em dólar: origem em USD + câmbio + IOF (amount continua em BRL).
  usd_amount?: number | null;
  usd_brl_rate?: number | null;
  iof_rate?: number | null;
  // Categoria Omie (prévia do mapeamento do tipo de despesa) — resolvida no
  // servidor para exibição no Contas a Pagar. Não é coluna da tabela.
  categoria?: string | null;
  payment_method?: string | null;
  installment_number?: number | null;
  installment_total?: number | null;
  needs_credit_card?: boolean | null;
  justification?: string | null;
  observations?: string | null;
  barcode?: string | null;
  pix_key?: string | null;
  pix_key_type?: string | null;
  bank_name?: string | null;
  bank_agency?: string | null;
  bank_account?: string | null;
  bank_account_digit?: string | null;
  bank_cpf_cnpj?: string | null;
  favorecido?: string | null;
  supplier_issues_invoice?: string | null;
  invoice_number?: string | null;
  attachment_path?: string | null;
  // Anexos diversos (contrato, cupom fiscal, pedido, nota, etc.). Só os paths
  // vêm na linha; as URLs assinadas são resolvidas sob demanda no modal.
  extra_attachment_paths?: string[] | null;
  created_at?: string | null;
  approved_at?: string | null;
  // IDs crus dos vínculos — usados pelo form de edição administrativa.
  sector_id?: string | null;
  expense_type_id?: string | null;
  event_id?: string | null;
  // Rateio entre setores: quando true, o valor é dividido entre as parcelas de
  // ctrl_request_sectors (cada uma com seu setor, valor e aprovação própria).
  is_rateio?: boolean | null;
  ctrl_request_sectors?: RateioPortion[] | null;
  ctrl_suppliers: Supplier | Supplier[] | null;
  ctrl_expense_types: NamedRef;
  ctrl_sectors?: NamedRef;
  ctrl_events?: NamedRef;
  creator?: UserRef;
  approver?: UserRef;
};

// ── Resolvers de joins do Supabase (objeto ou array) ──────────────────────────

export function resolveNamed(raw: NamedRef): string | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0]?.name ?? null;
  return raw.name ?? null;
}

export function resolveUser(
  raw: UserRef,
): { name: string | null; email: string | null } | null {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw[0] ?? null;
  return raw;
}

export function resolveSupplier(raw: Supplier | Supplier[] | null): Supplier | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  boleto: "Boleto",
  pix: "PIX",
  pix_copia_cola: "PIX Copia e Cola",
  transferencia: "Transferência",
  cartao_credito: "Cartão de Crédito",
  cartao_prepago: "Cartão Pré-Pago",
  dinheiro: "Dinheiro",
};

// Rótulo e cor do status de cada parcela do rateio (aprovação por setor).
export const RATEIO_STATUS_META: Record<string, { label: string; className: string }> = {
  pendente: { label: "Aguardando Gerente", className: "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300" },
  pendente_diretor: { label: "Aguardando Diretor", className: "bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300" },
  aprovado: { label: "Aprovado", className: "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300" },
  rejeitado: { label: "Rejeitado", className: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300" },
};

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

export const fmt = new Intl.NumberFormat("pt-BR", {
  style: "decimal",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function formatIssuesInvoice(value: string | null | undefined): string {
  if (!value) return "—";
  if (value === "sim") return "Sim";
  if (value === "sim_apos_pagamento") return "Sim, após o pagamento";
  if (value === "nao") return "Não";
  if (value === "nao_sei") return "Não sei";
  return value;
}

// ── Modal de detalhes ─────────────────────────────────────────────────────────

export function RequestDetailModal({
  req,
  onClose,
  onOpenAttachment,
  attachmentLoading,
  showApprovalHistory = false,
}: {
  req: RequestDetail;
  onClose: () => void;
  onOpenAttachment: (id: string) => void;
  attachmentLoading: boolean;
  // Exibe a seção "Histórico de aprovações" (etapas gerente/diretor a partir de
  // ctrl_history). Ativada na tela de Contas a Pagar; nas Requisições o modal
  // segue sem essa seção.
  showApprovalHistory?: boolean;
}) {
  const sup = resolveSupplier(req.ctrl_suppliers);
  const sector = resolveNamed(req.ctrl_sectors ?? null);
  const rateio =
    req.is_rateio && Array.isArray(req.ctrl_request_sectors) && req.ctrl_request_sectors.length > 0
      ? req.ctrl_request_sectors.map((p) => ({
          name: resolveNamed(p.ctrl_sectors ?? null) ?? "Setor",
          amount: Number(p.amount),
          status: p.status ?? null,
        }))
      : null;
  const expenseType = resolveNamed(req.ctrl_expense_types);
  const event = resolveNamed(req.ctrl_events ?? null);
  const creator = resolveUser(req.creator ?? null);
  const approver = resolveUser(req.approver ?? null);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="my-10 w-full max-w-3xl rounded-xl border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b px-6 py-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-muted-foreground">#{req.request_number}</p>
            <h3 className="font-semibold leading-tight">{req.title}</h3>
            {req.installment_number && req.installment_total && req.installment_total > 1 && (
              <p className="mt-1 text-xs text-muted-foreground">
                Parcela {req.installment_number}/{req.installment_total}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto bg-muted/20 px-6 py-5 space-y-4">
          {/* Anexo em destaque */}
          {req.attachment_path ? (
            <button
              type="button"
              onClick={() => onOpenAttachment(req.id)}
              disabled={attachmentLoading}
              className="flex w-full items-center gap-3 rounded-lg border bg-background px-4 py-3 text-sm font-medium transition-colors hover:bg-muted disabled:opacity-60"
            >
              {attachmentLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              ) : (
                <Paperclip className="h-4 w-4 text-primary" />
              )}
              <span>Abrir anexo</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {attachmentLoading ? "Gerando link..." : "Nova aba"}
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
              <Paperclip className="h-4 w-4" />
              Esta requisição não possui anexo.
            </div>
          )}

          {/* Anexos diversos (contrato, cupom fiscal, pedido, nota, etc.) */}
          <ExtraAttachments
            requestId={req.id}
            count={req.extra_attachment_paths?.length ?? 0}
          />

          {/* Resumo */}
          <Section title="Resumo">
            <DetailField label="Valor" value={fmt.format(Number(req.amount))} />
            {req.usd_amount != null && (
              <DetailField
                label="Compra em dólar"
                value={`US$ ${fmt.format(Number(req.usd_amount))} · câmbio R$ ${fmt.format(
                  Number(req.usd_brl_rate ?? 0),
                )} · IOF ${String(req.iof_rate ?? 0).replace(".", ",")}%`}
                fullWidth
              />
            )}
            <DetailField
              label="Vencimento"
              value={formatDayBR(req.due_date)}
            />
            <DetailField
              label="Competência"
              value={
                req.reference_month && req.reference_year
                  ? `${MONTHS[req.reference_month - 1]} / ${req.reference_year}`
                  : "—"
              }
            />
            <DetailField
              label="Setor"
              value={rateio ? `Rateio · ${rateio.length} setores` : sector ?? "—"}
            />
            <DetailField label="Tipo de Despesa" value={expenseType ?? "—"} />
            <DetailField label="Evento" value={event ?? "Nenhum evento"} />
            <DetailField
              label="Método de pagamento"
              value={req.payment_method ? PAYMENT_METHOD_LABEL[req.payment_method] ?? req.payment_method : "—"}
            />
          </Section>

          {/* Rateio entre setores — cada parcela com seu valor e o status da
              aprovação daquele setor. A requisição só fica aprovada quando todas. */}
          {rateio && (
            <Section title="Rateio entre setores" twoCol={false}>
              <div className="overflow-hidden rounded-md border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left text-xs font-semibold">
                      <th className="px-3 py-2">Setor</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2 text-right">Aprovação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rateio.map((p, i) => {
                      const meta = p.status ? RATEIO_STATUS_META[p.status] : null;
                      return (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-2">{p.name}</td>
                          <td className="px-3 py-2 text-right font-mono">{fmt.format(p.amount)}</td>
                          <td className="px-3 py-2 text-right">
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                meta?.className ?? "bg-gray-100 text-gray-800"
                              }`}
                            >
                              {meta?.label ?? p.status ?? "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-muted/30 font-semibold">
                      <td className="px-3 py-2">Total</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {fmt.format(Number(req.amount))}
                      </td>
                      <td className="px-3 py-2" />
                    </tr>
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          {/* Descrição / observações / justificativa */}
          {(req.description || req.observations || req.justification) && (
            <Section title="Descrição e observações" twoCol={false}>
              {req.description && <DetailField label="Descrição" value={req.description} fullWidth />}
              {req.justification && <DetailField label="Justificativa" value={req.justification} fullWidth />}
              {req.observations && <DetailField label="Observações" value={req.observations} fullWidth />}
            </Section>
          )}

          {/* Fornecedor + dados de pagamento */}
          <Section title="Fornecedor / Pagamento">
            <div className="space-y-0.5">
              <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Fornecedor
              </dt>
              <dd className="flex flex-wrap items-center gap-2 text-sm">
                <span>{sup?.name ?? req.favorecido ?? "—"}</span>
                <SupplierNotApprovedBadge status={sup?.status} />
              </dd>
            </div>
            <DetailField label="CNPJ/CPF" value={sup?.cnpj_cpf ?? req.bank_cpf_cnpj ?? "—"} mono />
            <DetailField label="Emite nota fiscal?" value={formatIssuesInvoice(req.supplier_issues_invoice)} />
            {req.invoice_number && (
              <DetailField label="Número da nota fiscal" value={req.invoice_number} mono />
            )}
            {req.payment_method === "pix" && (
              <>
                <DetailField label="Tipo Chave PIX" value={req.pix_key_type ?? "—"} />
                <DetailField label="Chave PIX" value={sup?.chave_pix ?? req.pix_key ?? "—"} mono fullWidth />
              </>
            )}
            {req.payment_method === "transferencia" && (
              <>
                <DetailField label="Banco" value={sup?.banco ?? req.bank_name ?? "—"} />
                <DetailField label="Agência" value={sup?.agencia ?? req.bank_agency ?? "—"} mono />
                <DetailField label="Conta" value={sup?.conta_corrente ?? req.bank_account ?? "—"} mono />
                <DetailField label="Dígito" value={req.bank_account_digit ?? "—"} mono />
              </>
            )}
            {req.payment_method === "boleto" && (
              <DetailField label="Linha digitável / Código de barras" value={req.barcode ?? "—"} mono fullWidth />
            )}
            {req.payment_method === "cartao_credito" && (
              <>
                <DetailField label="Parcelas" value={String(req.installment_total ?? 1)} />
                <DetailField
                  label="Precisa do cartão físico?"
                  value={
                    req.needs_credit_card == null
                      ? "—"
                      : req.needs_credit_card
                      ? "Sim"
                      : "Não"
                  }
                />
              </>
            )}
          </Section>

          {/* Trilha de aprovação / envio */}
          <Section title="Histórico">
            <DetailField
              label="Criado por"
              value={creator?.name ?? creator?.email ?? "—"}
            />
            <DetailField
              label="Criado em"
              value={formatDateTimeBR(req.created_at)}
            />
            {req.approved_at && (
              <DetailField
                label="Aprovado por"
                value={
                  (approver?.name ?? approver?.email ?? "—") +
                  " · " +
                  formatDateTimeBR(req.approved_at)
                }
                fullWidth
              />
            )}
            {req.sent_to_payment_at && (
              <DetailField
                label="Enviado para pagamento"
                value={
                  formatDateTimeBR(req.sent_to_payment_at) +
                  (req.paying_company ? ` · ${req.paying_company}` : "")
                }
                fullWidth
              />
            )}
            {req.omie_paid_at && (
              <DetailField
                label="Pago no Omie"
                value={formatDateTimeBR(req.omie_paid_at)}
                fullWidth
              />
            )}
          </Section>

          {/* Histórico de aprovações (etapas gerente/diretor) — persistente em
              ctrl_history. Renderizado só quando a tela solicita (Contas a Pagar). */}
          {showApprovalHistory && (
            <Section title="Histórico de aprovações" twoCol={false}>
              <ApprovalHistory requestId={req.id} showTitle={false} />
            </Section>
          )}
        </div>

        <div className="border-t px-6 py-3 flex justify-end gap-2">
          <a
            href={`/api/ctrl/requests/${req.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-violet-200 bg-violet-50 px-4 py-2 text-sm font-medium text-violet-700 hover:bg-violet-100 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300"
          >
            <Download className="h-4 w-4" />
            Baixar PDF
          </a>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

// Lista os anexos diversos de uma requisição com links de download (URLs
// assinadas resolvidas sob demanda). Reutilizada pelo modal compartilhado
// (Requisições / Contas a Pagar) e pelo modal de detalhe das Aprovações, para
// que aprovador e contas a pagar confiram os documentos antes do envio à Omie.
// `count` (nº de paths na linha) evita a chamada quando não há anexos.
export function ExtraAttachments({
  requestId,
  count,
}: {
  requestId: string;
  count: number;
}) {
  const [items, setItems] = useState<RequestExtraAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (count <= 0) return;
    let active = true;
    setLoading(true);
    setError(null);
    getRequestExtraAttachments(requestId).then((res) => {
      if (!active) return;
      setLoading(false);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setItems(res.attachments);
    });
    return () => {
      active = false;
    };
  }, [requestId, count]);

  if (count <= 0) return null;

  return (
    <div className="rounded-lg border bg-background">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <Paperclip className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">Anexos ({count})</h4>
      </div>
      <div className="p-3">
        {loading ? (
          <p className="flex items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Gerando links…
          </p>
        ) : error ? (
          <p className="px-1 py-1 text-xs text-destructive">{error}</p>
        ) : (
          <ul className="space-y-1.5">
            {items.map((att, i) => (
              <li key={`${att.url}-${i}`}>
                <a
                  href={att.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium transition-colors hover:bg-muted"
                >
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">{att.name}</span>
                  <ExternalLink className="ml-auto h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  twoCol = true,
}: {
  title: string;
  children: React.ReactNode;
  twoCol?: boolean;
}) {
  return (
    <section className="rounded-lg border bg-background shadow-sm">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <FileText className="h-4 w-4 text-primary" />
        <h4 className="text-sm font-semibold">{title}</h4>
      </header>
      <dl
        className={
          twoCol
            ? "grid grid-cols-1 gap-x-4 gap-y-3 p-4 sm:grid-cols-2 text-sm"
            : "p-4 space-y-3 text-sm"
        }
      >
        {children}
      </dl>
    </section>
  );
}

function DetailField({
  label,
  value,
  mono,
  fullWidth,
}: {
  label: string;
  value: string;
  mono?: boolean;
  fullWidth?: boolean;
}) {
  return (
    <div className={`space-y-0.5 ${fullWidth ? "sm:col-span-2" : ""}`}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className={mono ? "font-mono text-sm break-all" : "text-sm whitespace-pre-wrap"}>
        {value || "—"}
      </dd>
    </div>
  );
}
