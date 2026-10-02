// =============================================================================
// Falhas do provedor de IA, em português e acionáveis.
//
// ── Por que existe ────────────────────────────────────────────────────────
// A mensagem crua da API é em inglês, técnica, e às vezes some no caminho. As
// três que de fato acontecem neste projeto têm causa e CONSERTO diferentes, e
// quem está na tela precisa saber qual é:
//
//   • sem crédito       → alguém recarrega a conta. Já derrubou o ditado em
//                         30/09/2026 e o agente de viagem em 02/10/2026, as duas
//                         vezes como "parou de responder" sem explicação;
//   • chave inválida    → alguém corrige no painel de IA;
//   • parâmetro recusado→ é defeito NOSSO (ver `parametros-chat.ts`), não da conta.
//
// Confundir as três faz procurar no lugar errado — e a primeira é a única em que
// não há nada a fazer no código.
//
// Módulo PURO e testado.
// =============================================================================

export const SEM_CREDITO =
  "A conta da OpenAI está sem crédito, então a IA não responde. " +
  "Recarregue em platform.openai.com › Billing e tente de novo.";

export const CHAVE_INVALIDA =
  "A chave da OpenAI foi recusada. Confira a chave no Painel Administrador › IA.";

export const LIMITE_DE_USO =
  "O provedor de IA recusou por limite de uso (muitas chamadas em pouco tempo). " +
  "Espere alguns segundos e tente de novo.";

/**
 * Traduz a falha do provedor, ou devolve `null` quando não reconhece.
 *
 * `null` é deliberado: mensagem desconhecida vai CRUA para a tela em vez de virar
 * um "erro inesperado" genérico. A mensagem técnica é feia, mas diz algo; a
 * genérica não diz nada e manda a pessoa abrir um chamado.
 */
export function motivoAmigavel(bruto: string | null | undefined): string | null {
  const m = (bruto ?? "").toLowerCase();
  if (!m) return null;

  // Sem crédito vem como 429 com código próprio — e é a PRIMEIRA a conferir,
  // porque também casa com "rate limit" em algumas respostas.
  if (m.includes("credit_balance_exhausted") || m.includes("no credits remaining")) {
    return SEM_CREDITO;
  }
  if (m.includes("insufficient_quota") || m.includes("exceeded your current quota")) {
    return SEM_CREDITO;
  }
  if (m.includes("invalid_api_key") || m.includes("incorrect api key")) {
    return CHAVE_INVALIDA;
  }
  if (m.includes("rate limit") || m.includes("rate_limit_exceeded")) {
    return LIMITE_DE_USO;
  }
  return null;
}

/** A mensagem para a tela: a tradução quando existe, o original quando não. */
export function mensagemDeFalha(bruto: string | null | undefined): string {
  return motivoAmigavel(bruto) ?? (bruto ?? "").trim() ?? "";
}
