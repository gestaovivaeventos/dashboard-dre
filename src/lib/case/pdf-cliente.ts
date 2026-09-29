// Dados do contratante que vão no PDF do contrato. Por padrão são os do
// cadastro do cliente (o mesmo que vai à Omie); o contrato pode trazer outros
// (`case_contracts.pdf_cliente`), usados SÓ no PDF — Omie, projeto, observação
// e assinatura continuam lendo o cadastro.

import type { CasePdfCliente } from "@/lib/case/types";

interface ClienteCadastro {
  name?: string | null;
  cnpj_cpf?: string | null;
  resp_legal?: string | null;
  cpf_resp_legal?: string | null;
  endereco?: string | null;
  cidade_estado?: string | null;
  cep?: string | null;
}

export interface PdfClienteData {
  fundo: string;
  cnpj: string | null;
  respLegal: string | null;
  cpfResp: string | null;
  endereco: string | null;
  cidadeEstado: string | null;
  cep: string | null;
}

const limpo = (s: string | null | undefined) => (s ?? "").trim() || null;

/** Normaliza o que veio do formulário: sem nome, não há dados próprios (null = usa o cadastro). */
export function normalizePdfCliente(v: CasePdfCliente | null | undefined): CasePdfCliente | null {
  if (!v || !limpo(v.name)) return null;
  return {
    name: limpo(v.name)!,
    cnpj_cpf: limpo(v.cnpj_cpf),
    resp_legal: limpo(v.resp_legal),
    cpf_resp_legal: limpo(v.cpf_resp_legal),
    endereco: limpo(v.endereco),
    cidade_estado: limpo(v.cidade_estado),
    cep: limpo(v.cep),
  };
}

/**
 * Dados próprios substituem o cadastro POR INTEIRO, sem misturar campo a campo:
 * campo deixado em branco sai em branco, senão o PDF juntaria o nome de um
 * contratante com o CNPJ/endereço de outro.
 */
export function pdfClienteData(cadastro: ClienteCadastro | null | undefined, proprio: unknown): PdfClienteData {
  const p = normalizePdfCliente(proprio as CasePdfCliente | null);
  const src: ClienteCadastro = p ?? cadastro ?? {};
  return {
    fundo: src.name ?? "",
    cnpj: src.cnpj_cpf ?? null,
    respLegal: src.resp_legal ?? null,
    cpfResp: src.cpf_resp_legal ?? null,
    endereco: src.endereco ?? null,
    cidadeEstado: src.cidade_estado ?? null,
    cep: src.cep ?? null,
  };
}
