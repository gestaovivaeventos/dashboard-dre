import type { CreateRequestInput } from "@/lib/ctrl/actions/requests";
import type { CtrlUserContext } from "@/lib/ctrl/auth";
import type { CtrlRequestStatus } from "@/lib/supabase/types";

// Regras da API externa sobre requisições — o que a TELA garante pelas opções
// que oferece e a action de criação não confere, porque nunca precisou. Puro e
// testado: a action continua sendo a dona da regra de negócio; aqui só se fecha
// o que uma chamada direta conseguiria passar.

const PAYMENT_METHODS = [
  "boleto", "pix", "pix_copia_cola", "transferencia", "cartao_credito", "cartao_prepago", "dinheiro",
] as const;

/** Respostas de "o fornecedor emite nota fiscal?" — as mesmas do formulário do Compras. */
const EMITE_NF = ["sim", "sim_apos_pagamento", "nao"] as const;

/** Campos que a API aceita na criação. O resto do corpo é ignorado. */
const ALLOWED_FIELDS = [
  "title", "description", "sector_id", "expense_type_id", "supplier_id", "amount",
  "due_date", "reference_month", "reference_year", "payment_method", "justification",
  "observations", "supplier_issues_invoice", "invoice_number",
  "bank_name", "bank_agency", "bank_account", "bank_account_digit", "bank_cpf_cnpj",
  "pix_key", "pix_key_type", "favorecido", "barcode",
  "installments", "is_recurring", "recurrence_months",
  "attachment_path", "invoice_attachment_path", "extra_attachment_paths",
  "needs_credit_card", "currency", "usd_amount", "usd_brl_rate", "iof_rate",
] as const satisfies readonly (keyof CreateRequestInput)[];

export type ParsedCreate = { ok: true; input: CreateRequestInput } | { ok: false; error: string };

function attachmentPaths(input: CreateRequestInput): string[] {
  return [
    input.attachment_path,
    input.invoice_attachment_path,
    ...(input.extra_attachment_paths ?? []),
  ].filter((p): p is string => typeof p === "string" && p.length > 0);
}

export function parseCreateRequest(body: unknown, ctx: CtrlUserContext): ParsedCreate {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Corpo da requisição inválido." };
  }
  const raw = body as Record<string, unknown>;

  // Fronteira com o hubfeat: despesa de EVENTO segue no fluxo próprio de lá.
  if (raw.event_id != null && raw.event_id !== "") {
    return { ok: false, error: "Despesa vinculada a evento deve ser lançada no fluxo de pagamentos do hubfeat." };
  }
  // Rateio fica fora da v1: a Feat tem um setor só, e o rateio tem fluxo de
  // aprovação próprio que a tela do hubfeat não acompanha.
  if (raw.is_rateio) return { ok: false, error: "Rateio entre setores não é aceito pela API." };

  const input: Record<string, unknown> = {};
  for (const key of ALLOWED_FIELDS) if (key in raw) input[key] = raw[key];
  const data = input as unknown as CreateRequestInput;

  if (typeof data.title !== "string" || !data.title.trim()) return { ok: false, error: "Informe o título." };
  if (typeof data.sector_id !== "string" || !data.sector_id) return { ok: false, error: "Informe o setor." };
  if (typeof data.amount !== "number" || !Number.isFinite(data.amount)) {
    return { ok: false, error: "Informe o valor como número." };
  }
  if (!Number.isInteger(data.reference_month) || !Number.isInteger(data.reference_year)) {
    return { ok: false, error: "Informe mês e ano de referência." };
  }
  if (!PAYMENT_METHODS.includes(data.payment_method as (typeof PAYMENT_METHODS)[number])) {
    return { ok: false, error: `Forma de pagamento inválida. Use: ${PAYMENT_METHODS.join(", ")}.` };
  }
  // Obrigatórios no formulário do Compras (validados só na tela até aqui).
  if (typeof data.expense_type_id !== "string" || !data.expense_type_id) {
    return { ok: false, error: "Selecione o tipo de despesa." };
  }
  if (typeof data.supplier_id !== "string" || !data.supplier_id) {
    return { ok: false, error: "Selecione um fornecedor." };
  }
  if (!EMITE_NF.includes(data.supplier_issues_invoice as (typeof EMITE_NF)[number])) {
    return { ok: false, error: `Informe se o fornecedor emite nota fiscal: ${EMITE_NF.join(", ")}.` };
  }
  if (data.payment_method === "boleto" && !data.attachment_path) {
    return { ok: false, error: "Anexe o boleto antes de enviar." };
  }
  if (data.supplier_issues_invoice === "sim" && !data.invoice_attachment_path) {
    return { ok: false, error: "O fornecedor emite nota fiscal — anexe a nota fiscal antes de enviar." };
  }
  if (data.payment_method === "pix_copia_cola" && !data.pix_key?.trim()) {
    return { ok: false, error: "Cole o código PIX copia e cola antes de enviar." };
  }
  if (data.extra_attachment_paths != null && !Array.isArray(data.extra_attachment_paths)) {
    return { ok: false, error: "extra_attachment_paths deve ser uma lista." };
  }

  // A tela só oferece os setores vinculados ao usuário; a action confere só a empresa.
  if (!ctx.ctrlRoles.includes("admin") && !ctx.sectorIds.includes(data.sector_id)) {
    return { ok: false, error: "Você não está vinculado a este setor." };
  }

  // Anexo só do próprio usuário: o path é a chave da URL assinada, e aceitar o
  // de outra pessoa daria acesso ao arquivo dela pela requisição.
  if (attachmentPaths(data).some((p) => !isOwnAttachmentPath(p, ctx.id))) {
    return { ok: false, error: "Anexo inválido: use o caminho devolvido por POST /anexos." };
  }

  return { ok: true, input: data };
}

/**
 * Caminho exatamente no formato que POST /anexos gera: `<userId>/<timestamp>-<nome>`.
 * Validação estrutural, não por prefixo: "u1/../u2/x" começa com "u1/" e apontaria
 * para o arquivo de outra pessoa.
 */
export function isOwnAttachmentPath(path: string, userId: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
  const match = /^([0-9a-f-]{36})\/\d{10,}-([\w.-]{1,120})$/i.exec(path);
  return Boolean(match && match[1] === userId && !match[2].includes(".."));
}

/** Nome de arquivo seguro para o path no bucket (mesma regra do upload da tela). */
export function safeFileName(name: string): string {
  const cleaned = name
    .replace(/[^\w.\-]+/g, "_")
    .replace(/\.{2,}/g, ".")
    .replace(/^[_.]+|_+$/g, "");
  return cleaned.slice(-120) || "arquivo";
}

export type Etapa =
  | "em_aprovacao"
  | "aguardando_sua_resposta"
  | "aprovada"
  | "enviada_para_pagamento"
  | "paga"
  | "reprovada"
  | "cancelada";

export const ETAPA_LABEL: Record<Etapa, string> = {
  em_aprovacao: "Em aprovação",
  aguardando_sua_resposta: "Aguardando sua resposta",
  aprovada: "Aprovada",
  enviada_para_pagamento: "Enviada para pagamento",
  paga: "Paga",
  reprovada: "Reprovada",
  cancelada: "Cancelada",
};

/**
 * Situação da requisição na língua de quem pediu. O hubfeat não acompanha as
 * etapas internas (nível 2 × 3, homologação de fornecedor), só o que importa
 * para o solicitante — em especial "aguardando sua resposta", que é quando a
 * requisição trava se ninguém responder.
 */
export function etapaDaRequisicao(req: {
  status: CtrlRequestStatus;
  omie_paid_at: string | null;
  omie_launch_status: string | null;
}): Etapa {
  if (req.omie_paid_at) return "paga";
  switch (req.status) {
    case "pendente":
    case "pendente_diretor":
    case "aguardando_aprovacao_fornecedor":
      return "em_aprovacao";
    case "aguardando_complementacao":
    case "info_pagamento_pendente":
      return "aguardando_sua_resposta";
    case "aprovado":
      return req.omie_launch_status ? "enviada_para_pagamento" : "aprovada";
    case "agendado":
      return "enviada_para_pagamento";
    case "rejeitado":
      return "reprovada";
    case "estornado":
    case "inativado_csc":
      return "cancelada";
  }
}

/** Qual resposta a requisição espera do solicitante, se alguma. */
export function respostaPendente(status: CtrlRequestStatus): "complemento" | "info_pagamento" | null {
  if (status === "aguardando_complementacao") return "complemento";
  if (status === "info_pagamento_pendente") return "info_pagamento";
  return null;
}
