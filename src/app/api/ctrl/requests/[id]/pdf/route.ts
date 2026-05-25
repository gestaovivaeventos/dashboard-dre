import PDFDocument from "pdfkit";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { requireCtrlRole } from "@/lib/ctrl/auth";

const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  boleto: "Boleto",
  pix: "PIX",
  transferencia: "Transferência",
  cartao_credito: "Cartão de Crédito",
  dinheiro: "Dinheiro",
};

const STATUS_LABEL: Record<string, string> = {
  rascunho: "Rascunho",
  em_aprovacao: "Em aprovação",
  aprovado: "Aprovado — aguardando envio",
  info_pagamento_pendente: "Aguardando info do solicitante",
  agendado: "Enviado para pagamento",
  inativado_csc: "Inativado pelo CSC",
  recusado: "Recusado",
};

const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  // Datas puras (yyyy-mm-dd) sem timezone: usa noon UTC pra evitar shift.
  const d = value.length === 10 ? new Date(value + "T12:00:00Z") : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR").format(d);
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("pt-BR");
}

function resolveOne<T extends Record<string, unknown>>(raw: T | T[] | null | undefined): T | null {
  if (!raw) return null;
  return Array.isArray(raw) ? (raw[0] ?? null) : raw;
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  // Acesso: mesma matriz de quem pode ver detalhe da requisição.
  const ctx = await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
  ).catch(() => null);
  if (!ctx) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: req, error } = await supabase
    .from("ctrl_requests")
    .select(
      `*, ctrl_sectors(name), ctrl_expense_types(name),
       ctrl_suppliers(name, cnpj_cpf, chave_pix, banco, agencia, conta_corrente, titular_banco),
       creator:users!ctrl_requests_created_by_fkey(name, email),
       approver:users!ctrl_requests_approved_by_fkey(name, email)`,
    )
    .eq("id", params.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!req) return NextResponse.json({ error: "Requisição não encontrada." }, { status: 404 });

  // Visibilidade adicional: solicitante puro só pode baixar a propria.
  const hasBroadVisibility = ctx.ctrlRoles.some((r) =>
    ["gerente", "diretor", "csc", "admin", "contas_a_pagar"].includes(r),
  );
  if (!hasBroadVisibility && req.created_by !== ctx.id) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const sup = resolveOne(req.ctrl_suppliers as Record<string, unknown> | Record<string, unknown>[] | null);
  const sector = resolveOne(req.ctrl_sectors as { name: string } | { name: string }[] | null);
  const expenseType = resolveOne(req.ctrl_expense_types as { name: string } | { name: string }[] | null);
  const creator = resolveOne(req.creator as { name: string | null; email: string | null } | Array<{ name: string | null; email: string | null }> | null);
  const approver = resolveOne(req.approver as { name: string | null; email: string | null } | Array<{ name: string | null; email: string | null }> | null);

  const doc = new PDFDocument({ margin: 48, size: "A4" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk as Buffer));

  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  // ── Header ────────────────────────────────────────────────────────────────
  doc.fillColor("#000").font("Helvetica-Bold").fontSize(16).text("Requisição de Pagamento");
  doc.font("Helvetica").fontSize(10).fillColor("#666")
    .text(`Nº ${req.request_number}  ·  Status: ${STATUS_LABEL[req.status as string] ?? req.status}`);
  doc.moveDown(0.5);
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(String(req.title ?? ""));
  if (req.installment_number && req.installment_total && Number(req.installment_total) > 1) {
    doc.font("Helvetica").fontSize(9).fillColor("#666")
      .text(`Parcela ${req.installment_number}/${req.installment_total}`);
  }
  doc.moveDown(0.8);

  // ── Helpers ───────────────────────────────────────────────────────────────
  function sectionTitle(title: string) {
    doc.moveDown(0.5);
    doc.font("Helvetica-Bold").fontSize(11).fillColor("#4c1d95").text(title);
    doc.moveTo(doc.x, doc.y + 2).lineTo(doc.page.width - doc.page.margins.right, doc.y + 2)
      .strokeColor("#ddd").lineWidth(0.5).stroke();
    doc.moveDown(0.4);
  }

  function field(label: string, value: string | null | undefined) {
    const safe = value && String(value).trim().length > 0 ? String(value) : "—";
    const labelWidth = 150;
    const startX = doc.page.margins.left;
    const valueX = startX + labelWidth;
    const valueWidth = doc.page.width - doc.page.margins.right - valueX;

    const y0 = doc.y;
    doc.font("Helvetica").fontSize(9).fillColor("#666").text(label, startX, y0, { width: labelWidth });
    doc.font("Helvetica").fontSize(10).fillColor("#000").text(safe, valueX, y0, { width: valueWidth });
    const y1 = doc.y;
    doc.x = startX;
    doc.y = Math.max(y0 + 14, y1 + 2);
  }

  // ── Resumo ────────────────────────────────────────────────────────────────
  sectionTitle("Resumo");
  field("Valor", fmtBRL.format(Number(req.amount ?? 0)));
  field("Vencimento", fmtDate(req.due_date as string | null));
  field(
    "Competência",
    req.reference_month && req.reference_year
      ? `${MONTHS[(req.reference_month as number) - 1]} / ${req.reference_year}`
      : "—",
  );
  field("Setor", sector?.name ?? "—");
  field("Tipo de Despesa", expenseType?.name ?? "—");
  field(
    "Método de Pagamento",
    req.payment_method ? (PAYMENT_METHOD_LABEL[req.payment_method as string] ?? String(req.payment_method)) : "—",
  );
  if (req.paying_company) field("Empresa Pagadora", String(req.paying_company));

  // ── Descrição / Justificativa / Observações ───────────────────────────────
  if (req.description || req.justification || req.observations) {
    sectionTitle("Descrição e Observações");
    if (req.description) field("Descrição", String(req.description));
    if (req.justification) field("Justificativa", String(req.justification));
    if (req.observations) field("Observações", String(req.observations));
  }

  // ── Fornecedor / Pagamento ────────────────────────────────────────────────
  sectionTitle("Fornecedor / Pagamento");
  field("Fornecedor", (sup?.name as string) ?? (req.favorecido as string) ?? "—");
  field("CNPJ/CPF", (sup?.cnpj_cpf as string) ?? (req.bank_cpf_cnpj as string) ?? "—");
  field("Emite nota fiscal?", formatIssuesInvoice(req.supplier_issues_invoice as string | null));

  if (req.payment_method === "pix") {
    field("Tipo Chave PIX", (req.pix_key_type as string) ?? "—");
    field("Chave PIX", (sup?.chave_pix as string) ?? (req.pix_key as string) ?? "—");
  }
  if (req.payment_method === "transferencia") {
    field("Banco", (sup?.banco as string) ?? (req.bank_name as string) ?? "—");
    field("Agência", (sup?.agencia as string) ?? (req.bank_agency as string) ?? "—");
    field("Conta", (sup?.conta_corrente as string) ?? (req.bank_account as string) ?? "—");
    field("Dígito", (req.bank_account_digit as string) ?? "—");
  }
  if (req.payment_method === "boleto") {
    field("Linha digitável / Código de barras", (req.barcode as string) ?? "—");
  }
  if (req.payment_method === "cartao_credito") {
    field("Parcelas", String(req.installment_total ?? 1));
    field(
      "Precisa do cartão físico?",
      req.needs_credit_card == null ? "—" : req.needs_credit_card ? "Sim" : "Não",
    );
  }

  // ── Histórico ─────────────────────────────────────────────────────────────
  sectionTitle("Histórico");
  field("Criado por", creator?.name ?? creator?.email ?? "—");
  field("Criado em", fmtDateTime(req.created_at as string | null));
  if (req.approved_at) {
    field(
      "Aprovado por",
      `${approver?.name ?? approver?.email ?? "—"} · ${fmtDateTime(req.approved_at as string | null)}`,
    );
  }
  if (req.sent_to_payment_at) {
    field(
      "Enviado para pagamento",
      `${fmtDateTime(req.sent_to_payment_at as string | null)}${req.paying_company ? ` · ${req.paying_company}` : ""}`,
    );
  }
  if (req.inactivated_at) {
    field(
      "Inativado em",
      `${fmtDateTime(req.inactivated_at as string | null)}${req.inactivation_reason ? ` · ${req.inactivation_reason}` : ""}`,
    );
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  doc.moveDown(1.5);
  doc.font("Helvetica").fontSize(8).fillColor("#999")
    .text(`Gerado em ${new Date().toLocaleString("pt-BR")} · Control Hub`, { align: "center" });

  doc.end();
  const buffer = await done;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="requisicao-${req.request_number}.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}

function formatIssuesInvoice(value: string | null): string {
  if (!value) return "—";
  if (value === "sim") return "Sim";
  if (value === "nao") return "Não";
  if (value === "nao_sei") return "Não sei";
  return value;
}
