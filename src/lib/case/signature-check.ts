// Pré-requisitos para enviar o contrato à ClickSign. Fonte única: o formulário
// barra antes de salvar e o servidor repete a trava em prepareForSignature (actions/stages.ts).
// Quem assina pelo cliente é o responsável legal (pessoa física) — a ClickSign
// recusa razão social ("CELEBRATE EVENTOS LTDA") e CNPJ no lugar do CPF.

const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

export interface SignatureClientData {
  email: string | null | undefined;
  resp_legal: string | null | undefined;
  cpf_resp_legal: string | null | undefined;
}

// "ME"/"SA" sem pontuação ficam de fora: colidem com sobrenomes (Sá).
const COMPANY_SUFFIX = /(\b(ltda|eireli|epp)\.?|\bs\.a\.?|\bs\/a)$/i;

/** Nome e sobrenome de pessoa, sem números, símbolos ou sufixo de empresa. */
export function isPersonName(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return n.split(/\s+/).length >= 2 && !/[\d()\[\]\/\\@#$%&*]/.test(n) && !COMPANY_SUFFIX.test(n);
}

export function isValidCpf(value: string | null | undefined): boolean {
  const d = onlyDigits(value);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const digit = (len: number) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
    const r = (sum * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return digit(9) === Number(d[9]) && digit(10) === Number(d[10]);
}

/** O que falta no cadastro do cliente para a assinatura (vazio = pode enviar). */
export function clientSignatureIssues(c: SignatureClientData): string[] {
  const issues: string[] = [];
  if (!(c.resp_legal ?? "").trim()) issues.push("responsável legal (nome completo de quem assina)");
  else if (!isPersonName(c.resp_legal)) issues.push("responsável legal com nome e sobrenome de pessoa física (não a razão social)");
  if (!onlyDigits(c.cpf_resp_legal)) issues.push("CPF do responsável legal");
  else if (!isValidCpf(c.cpf_resp_legal)) issues.push("CPF do responsável legal válido");
  if (!(c.email ?? "").trim()) issues.push("e-mail do cliente para receber a assinatura");
  return issues;
}

export function clientSignatureMessage(issues: string[]): string {
  return `Antes de enviar para assinatura, complete o cadastro do cliente: ${issues.join("; ")}.`;
}
