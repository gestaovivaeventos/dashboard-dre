// Endereço do fornecedor brasileiro.
//
// A Omie exige endereço no cadastro de cliente/fornecedor: a tela dela abre
// pedindo CEP + número e preenche o resto (logradouro, bairro, cidade, UF).
// Reproduzimos o mesmo fluxo aqui — o usuário digita o CEP, buscamos os dados
// e ele completa o número/complemento.
//
// Módulo neutro (sem "use client"/"use server"): as máscaras e a validação
// rodam no formulário e também nas server actions; só `lookupCep` depende de
// rede e é chamada a partir do navegador.

export const UFS_BR = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS",
  "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC",
  "SP", "SE", "TO",
] as const;

/** Só os dígitos do CEP (máx. 8). */
export function cepDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "").slice(0, 8);
}

/** Máscara visual "00000-000" — não bloqueia digitação livre. */
export function maskCep(value: string): string {
  const d = cepDigits(value);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

export function isValidCep(value: string | null | undefined): boolean {
  return cepDigits(value).length === 8;
}

/** Campos de endereço compartilhados entre formulário, action e payload Omie. */
export interface EnderecoFields {
  cep?: string | null;
  endereco?: string | null;
  endereco_numero?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  complemento?: string | null;
}

/** True quando o usuário já mexeu em algum campo do endereço. */
export function hasAnyEndereco(e: EnderecoFields): boolean {
  return [e.cep, e.endereco, e.endereco_numero, e.bairro, e.cidade, e.estado].some(
    (v) => !!v?.trim(),
  );
}

/**
 * Campos obrigatórios que faltam. Complemento é opcional (nem todo endereço
 * tem). A ordem é a de leitura na tela, pra mensagem de erro fazer sentido.
 */
export function enderecoMissing(e: EnderecoFields): string[] {
  const missing: string[] = [];
  if (!isValidCep(e.cep)) missing.push("CEP");
  if (!e.endereco?.trim()) missing.push("Endereço");
  if (!e.endereco_numero?.trim()) missing.push("Número");
  if (!e.bairro?.trim()) missing.push("Bairro");
  if (!e.cidade?.trim()) missing.push("Cidade");
  if (!e.estado?.trim()) missing.push("Estado");
  return missing;
}

/**
 * A Omie grava a cidade com a UF entre parênteses ("Juiz de Fora (MG)") — é o
 * formato que a própria tela dela mostra. Mantemos o que já vier no padrão.
 */
export function cidadeParaOmie(
  cidade: string | null | undefined,
  uf: string | null | undefined,
): string {
  const nome = (cidade ?? "").trim();
  if (!nome) return "";
  const sigla = (uf ?? "").trim().toUpperCase();
  if (!sigla || nome.includes("(")) return nome;
  return `${nome} (${sigla})`;
}

export interface CepLookupResult {
  endereco: string;
  bairro: string;
  cidade: string;
  estado: string;
  complemento: string;
}

/**
 * Busca o endereço pelo CEP (ViaCEP). Retorna null quando o CEP é inválido,
 * não existe ou o serviço está fora — nesse caso o usuário preenche à mão, a
 * busca é uma conveniência e nunca trava o cadastro.
 */
export async function lookupCep(cep: string): Promise<CepLookupResult | null> {
  const digits = cepDigits(cep);
  if (digits.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
    if (!res.ok) return null;
    const data = (await res.json()) as Record<string, unknown>;
    // CEP inexistente vem como { erro: true } (ou "true", conforme a versão).
    if (data.erro) return null;
    const cidade = String(data.localidade ?? "").trim();
    if (!cidade) return null;
    return {
      endereco: String(data.logradouro ?? "").trim(),
      bairro: String(data.bairro ?? "").trim(),
      cidade,
      estado: String(data.uf ?? "").trim().toUpperCase(),
      complemento: String(data.complemento ?? "").trim(),
    };
  } catch {
    return null;
  }
}
