// =============================================================================
// Canal de STATUS dentro do stream de texto do agente.
//
// ── O problema que isto resolve ────────────────────────────────────────────
// Quando o agente chama `buscar_precos`, a busca na web leva dezenas de segundos
// e o `textStream` do SDK fica em SILÊNCIO TOTAL — nenhum token sai até o modelo
// voltar a escrever. Para quem olha a tela isso é indistinguível de travado, e
// foi exatamente o que aconteceu no primeiro uso real (02/10/2026): mensagem
// enviada, nada de volta.
//
// Então o servidor escreve marcas de status no MESMO stream, e a tela as mostra
// como linha de progresso ("pesquisando preços…").
//
// ── Por que NUL e não `[[STATUS]]` ────────────────────────────────────────
// O cliente corta o texto exibível no primeiro `[[` (é assim que o cartão
// `[[VIAGEM]]` e o `[[FECHAR]]` não piscam na tela). Uma marca `[[…]]` enviada
// ANTES da resposta esconderia a resposta inteira. `\u0000` não aparece em prosa
// nem em JSON de LLM, então serve de envelope sem colidir com nada.
//
// Módulo PURO e testado.
// =============================================================================

const NUL = "\u0000";

/** Envelope de uma marca de status, pronto para ir ao stream. */
export function marcarStatus(texto: string): string {
  // Sem NUL dentro do texto, senão o envelope se parte e o resto da mensagem
  // vira status.
  return `${NUL}${texto.replace(/\u0000/g, " ").trim()}${NUL}`;
}

/**
 * Separa as marcas de status do texto que o usuário lê.
 *
 * Roda sobre texto PARCIAL do streaming, como `extrairCartaoViagem`: um envelope
 * pela metade (NUL de abertura sem o de fechamento) é tratado como status em
 * andamento — ele NÃO pode vazar para o texto, nem mesmo por um quadro.
 *
 * `status` é a ÚLTIMA marca vista: elas descrevem o passo atual, não um
 * histórico.
 */
export function separarStatus(bruto: string): { texto: string; status: string | null } {
  if (!bruto.includes(NUL)) return { texto: bruto, status: null };

  const partes = bruto.split(NUL);
  let texto = "";
  let status: string | null = null;

  // Índice par = fora do envelope (texto); ímpar = dentro (status).
  for (let i = 0; i < partes.length; i += 1) {
    if (i % 2 === 0) {
      texto += partes[i];
      continue;
    }
    const s = partes[i].trim();
    // Envelope incompleto (último pedaço, sem NUL de fechamento): ainda é
    // status — e some do texto de qualquer modo.
    if (s !== "") status = s;
  }

  return { texto, status };
}
