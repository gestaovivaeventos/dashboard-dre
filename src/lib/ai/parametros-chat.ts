// Os parâmetros do /chat/completions que mudam de nome conforme o modelo.
//
// A OpenAI trocou `max_tokens` por `max_completion_tokens` nas famílias novas
// (o-series, gpt-5, gpt-6, Luna) e passou a recusar a antiga com HTTP 400. O
// DeepSeek e a camada de compatibilidade do Gemini continuam com `max_tokens`.
// Como o painel deixa cadastrar QUALQUER modelo, o código não tem como ter uma
// lista completa — e foi exatamente isso que quebrou ao trocar o modelo para
// `gpt-6-luna` em 30/09/2026:
//
//   "Unsupported parameter: 'max_tokens' is not supported with this model.
//    Use 'max_completion_tokens' instead."
//
// Por isso aqui há DUAS camadas: um palpite pelo nome do modelo e, acima dele,
// uma correção pela resposta da API. O palpite erra com modelo novo que eu não
// conheço; a correção não erra, porque lê o que o provedor respondeu.
//
// Módulo PURO (testado).

/** Modelos que exigem `max_completion_tokens` — palpite pelo nome. */
export function usaMaxCompletionTokens(model: string | null | undefined): boolean {
  const m = (model ?? "").trim().toLowerCase();
  if (!m) return false;
  // Só vale para a OpenAI: DeepSeek e Gemini-compat seguem com max_tokens.
  if (/^deepseek|^gemini|^models\//.test(m)) return false;
  // o1/o3/o4…, gpt-5 em diante, e os nomes de codinome (luna) que vêm com eles.
  return /^o\d/.test(m) || /^gpt-([5-9]|\d{2,})/.test(m) || m.includes("luna");
}

/** O par nome→valor do teto, pronto para entrar no corpo da requisição. */
export function tetoDeTokens(model: string | null | undefined, teto: number): Record<string, number> {
  return usaMaxCompletionTokens(model) ? { max_completion_tokens: teto } : { max_tokens: teto };
}

/**
 * Modelos de raciocínio da OpenAI recusam `temperature` diferente de 1.
 *
 * Mandar `temperature: 0` neles devolve 400 do mesmo naipe do `max_tokens`.
 * Como o projeto pede temperatura baixa em tudo (relatório, OCR, extração), o
 * caminho é OMITIR o parâmetro nesses modelos em vez de brigar com a API — o
 * default deles já é determinístico o bastante para JSON.
 */
export function aceitaTemperatura(model: string | null | undefined): boolean {
  return !usaMaxCompletionTokens(model);
}

export interface CorpoChat {
  [k: string]: unknown;
}

/**
 * Monta os parâmetros variáveis de uma chamada de chat.
 *
 * Quem chama junta isto ao resto do corpo (model, messages, response_format…).
 */
export function parametrosChat(
  model: string | null | undefined,
  opts: { teto: number; temperatura?: number },
): CorpoChat {
  return {
    ...tetoDeTokens(model, opts.teto),
    ...(aceitaTemperatura(model) && opts.temperatura != null
      ? { temperature: opts.temperatura }
      : {}),
  };
}

/**
 * A resposta 400 está reclamando de um parâmetro que dá para corrigir sozinho?
 *
 * Devolve o corpo AJUSTADO para uma segunda tentativa, ou `null` quando o erro
 * é outro (aí não adianta repetir). É esta camada que salva o modelo novo que
 * o palpite acima não conhece — a API diz qual é o nome certo, e nós obedecemos
 * em vez de adivinhar.
 */
export function corrigirCorpoPelaResposta(
  corpo: CorpoChat,
  mensagemDeErro: string,
): CorpoChat | null {
  const msg = (mensagemDeErro ?? "").toLowerCase();
  let mudou = false;
  const novo: CorpoChat = { ...corpo };

  // Desambigua pelo que está NO CORPO, não pela mensagem: as duas direções
  // citam "max_completion_tokens" (uma como o certo, outra como o recusado), e
  // "max_completion_tokens" não contém a substring "max_tokens" — casar por
  // texto erra o caminho inverso.
  const citaTeto = msg.includes("max_tokens") || msg.includes("max_completion_tokens");
  if (citaTeto && "max_tokens" in novo) {
    novo.max_completion_tokens = novo.max_tokens;
    delete novo.max_tokens;
    mudou = true;
  } else if (citaTeto && "max_completion_tokens" in novo) {
    novo.max_tokens = novo.max_completion_tokens;
    delete novo.max_completion_tokens;
    mudou = true;
  }

  // Modelo que só aceita a temperatura padrão: some com o parâmetro.
  if (msg.includes("temperature") && "temperature" in novo) {
    delete novo.temperature;
    mudou = true;
  }

  return mudou ? novo : null;
}

/**
 * Opções de `generateObject` / `generateText` do Vercel AI SDK.
 *
 * O SDK monta a requisição por conta própria e, para um modelo que a VERSÃO
 * instalada dele não conhece, manda `max_tokens` — que as famílias novas
 * recusam. Medido em 30/09/2026 contra a API real com `gpt-6-luna`: passar
 * `maxOutputTokens` derrubava a chamada com "Unsupported parameter:
 * 'max_tokens'", e `temperature` era recusada à parte. Sem os dois, o
 * structured output funciona normalmente.
 *
 * Por isso este atalho OMITE os dois nas famílias novas, em vez de traduzir:
 * não há como reescrever o corpo que o SDK monta, e subir a versão do SDK só
 * por isso traria mudança de comportamento em todo o resto.
 *
 * O que se perde ao omitir o teto: nada de garantia de custo — o modelo já tem
 * o teto dele. O teto existia para o DeepSeek em `json_object`, que gera muito
 * mais token para o mesmo conteúdo, e ali ele continua valendo.
 */
export function opcoesSdk(
  model: string | null | undefined,
  opts: { temperature?: number; maxOutputTokens?: number },
): { temperature?: number; maxOutputTokens?: number } {
  if (usaMaxCompletionTokens(model)) return {};
  return {
    ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
    ...(opts.maxOutputTokens != null ? { maxOutputTokens: opts.maxOutputTokens } : {}),
  };
}
