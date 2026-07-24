// Validação do nome do fornecedor (razão social e nome fantasia).
//
// A Omie rejeita acentos e cedilha no cadastro de cliente/fornecedor, então
// barramos isso antes de salvar. A mensagem distingue os dois casos porque o
// usuário costuma corrigir cada um de forma diferente.

/**
 * Retorna a mensagem de erro quando o nome contém acento ou cedilha; `null`
 * quando está válido para a Omie. A cedilha é checada primeiro por ter mensagem
 * própria (o NFD do "ç" também produz um sinal diacrítico combinante).
 */
export function omieNameError(value: string): string | null {
  if (/[çÇ]/.test(value)) {
    return "O nome do fornecedor não pode conter ç.";
  }
  // NFD separa a letra base do acento (ex.: "á" → "a" + U+0301). Qualquer marca
  // combinante na faixa U+0300–U+036F significa que havia acento no nome.
  const decomposed = value.normalize("NFD");
  for (let i = 0; i < decomposed.length; i++) {
    const code = decomposed.charCodeAt(i);
    if (code >= 0x0300 && code <= 0x036f) {
      return "O nome do fornecedor não pode conter acento.";
    }
  }
  return null;
}
