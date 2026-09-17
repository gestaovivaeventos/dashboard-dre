// Dados fixos do CONTRATADO (CS Agência) e da assinatura. Configuráveis por env,
// com os defaults oficiais da agência.

export const CONTRATADO = {
  razao: process.env.CASE_CONTRATADO_RAZAO ?? "CS AGÊNCIA DE SHOWS E EVENTOS LTDA",
  cnpj: process.env.CASE_CONTRATADO_CNPJ ?? "30.595.153/0001-90",
  endereco:
    process.env.CASE_CONTRATADO_ENDERECO ??
    "Avenida Independência, 928 - Sala 1610 – Independência",
  cidadeEstado: process.env.CASE_CONTRATADO_CIDADE_ESTADO ?? "Taubaté / SP",
  cep: process.env.CASE_CONTRATADO_CEP ?? "12.031-001",
} as const;

export const DADOS_BANCARIOS = {
  favorecido: process.env.CASE_BANCO_FAVORECIDO ?? "CS Agência de Shows",
  banco: process.env.CASE_BANCO_NOME ?? "Banco do Brasil",
  agencia: process.env.CASE_BANCO_AGENCIA ?? "0024-8",
  conta: process.env.CASE_BANCO_CONTA ?? "1.002.018-7",
  cnpj: process.env.CASE_BANCO_CNPJ ?? "30.595.153/0001-90",
  pix: process.env.CASE_BANCO_PIX ?? "30.595.153/0001-90",
} as const;

/** Foro de eleição e cidade da assinatura (bate com a cláusula 13). */
export const FORO = process.env.CASE_FORO ?? "Comarca de Juiz de Fora/MG";
export const CIDADE_ASSINATURA = process.env.CASE_CIDADE_ASSINATURA ?? "Juiz de Fora";

/** Signatário do CONTRATADO (CS Agência) — assina todo contrato pelo ClickSign. */
export const CONTRATADO_SIGNER = {
  name: process.env.CASE_CONTRATADO_SIGNER_NAME ?? "Pedro Guimarães Leo",
  email: process.env.CASE_CONTRATADO_SIGNER_EMAIL ?? "pedro@caseshows.com.br",
  cpf: process.env.CASE_CONTRATADO_SIGNER_CPF ?? "084.243.096-26",
} as const;

/**
 * Quem aprova (ou devolve) contrato Case antes da ClickSign — regra nominal,
 * registrada em user-exceptions.ts. Nenhum contrato vai à ClickSign sem o aval
 * de um deles, e todos recebem o aviso por e-mail e o contador no menu.
 * Aprovar não é assinar: quem assina pela CS Agência continua sendo só o
 * CONTRATADO_SIGNER, por último, depois do cliente e da testemunha.
 * Constante fixa (sem env) porque também é lida no client.
 */
export const CASE_CONTRACT_APPROVER_EMAILS = [
  "pedro@caseshows.com.br",
  "marcelo@quokka.net.br",
] as const;

export function isCaseContractApprover(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  return CASE_CONTRACT_APPROVER_EMAILS.some((a) => a === e);
}
