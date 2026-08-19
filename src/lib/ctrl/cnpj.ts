// Tratamento de documento (CNPJ/CPF) do módulo Compras — fonte única usada pelo
// formulário de cadastro, pelas server actions e pelo envio ao Omie.
//
// CNPJ ALFANUMÉRICO — Receita Federal, vigente a partir de julho/2026. O número
// mantém as 14 posições, mas as 12 primeiras passam a aceitar letras (A-Z) além
// de dígitos; as 2 últimas (dígitos verificadores) continuam SEMPRE numéricas. O
// CPF segue 100% numérico (11 dígitos).
//
// IMPORTANTE: não use `replace(/\D/g, "")` em documento — isso descarta as
// letras do CNPJ alfanumérico e corrompe o número. Use `normalizeDoc`.

export const CNPJ_LENGTH = 14;
export const CPF_LENGTH = 11;

/**
 * Normaliza um documento para comparação/armazenamento/envio: caixa alta e
 * apenas caracteres alfanuméricos (remove pontos, barra, traço e espaços).
 * Preserva as letras do CNPJ alfanumérico.
 */
export function normalizeDoc(value: string | null | undefined): string {
  return (value ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Limpa e limita um CNPJ ao formato válido: 14 posições, sendo as 12 primeiras
 * alfanuméricas e as 2 últimas numéricas.
 */
export function cleanCnpj(value: string | null | undefined): string {
  const raw = normalizeDoc(value);
  const chars: string[] = [];
  for (const ch of raw) {
    if (chars.length >= CNPJ_LENGTH) break;
    // As 2 últimas posições (dígitos verificadores) só aceitam número.
    if (chars.length >= 12 && !(ch >= "0" && ch <= "9")) continue;
    chars.push(ch);
  }
  return chars.join("");
}

/** Aplica a máscara visual NN.NNN.NNN/NNNN-DD (alfanumérico ou numérico). */
export function maskCnpj(value: string | null | undefined): string {
  const c = cleanCnpj(value);
  let out = c.slice(0, 2);
  if (c.length > 2) out += `.${c.slice(2, 5)}`;
  if (c.length > 5) out += `.${c.slice(5, 8)}`;
  if (c.length > 8) out += `/${c.slice(8, 12)}`;
  if (c.length > 12) out += `-${c.slice(12, 14)}`;
  return out;
}

/** true quando o CNPJ tem as 14 posições completas. */
export function cnpjIsComplete(value: string | null | undefined): boolean {
  return cleanCnpj(value).length === CNPJ_LENGTH;
}
