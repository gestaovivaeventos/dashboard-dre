// Falhas do provedor de IA.
//
// As três que acontecem de verdade neste projeto têm CONSERTO diferente, e o
// defeito que estes testes impedem é confundi-las — mandar alguém conferir a
// chave quando o problema é saldo faz procurar no lugar errado.

import test from "node:test";
import assert from "node:assert/strict";

import { CHAVE_INVALIDA, LIMITE_DE_USO, SEM_CREDITO, mensagemDeFalha, motivoAmigavel } from "./erros";

test("sem crédito é reconhecido nas formas que a OpenAI usa", () => {
  // Foi este erro que derrubou o ditado em 30/09/2026 e o agente de viagem em
  // 02/10/2026 — nas duas vezes como "parou de responder", sem explicação.
  const brutos = [
    "You have no credits remaining. Add credits to continue using the API",
    'AI_APICallError: 429 {"error":{"code":"credit_balance_exhausted"}}',
    "You exceeded your current quota, please check your plan and billing details",
    "insufficient_quota",
  ];
  for (const b of brutos) {
    assert.equal(motivoAmigavel(b), SEM_CREDITO, b.slice(0, 40));
  }
});

test("sem crédito VENCE 'rate limit' — os dois vêm como 429", () => {
  // A resposta de saldo esgotado às vezes traz as duas expressões. Casar em
  // "rate limit" primeiro mandaria a pessoa esperar por algo que não passa.
  const bruto = "429 Too Many Requests — rate limit? no credits remaining";
  assert.equal(motivoAmigavel(bruto), SEM_CREDITO);
});

test("chave inválida e limite de uso são distinguidos", () => {
  assert.equal(motivoAmigavel("Incorrect API key provided: sk-xxx"), CHAVE_INVALIDA);
  assert.equal(motivoAmigavel('{"code":"invalid_api_key"}'), CHAVE_INVALIDA);
  assert.equal(motivoAmigavel("Rate limit reached for gpt-4o-mini"), LIMITE_DE_USO);
});

test("mensagem desconhecida vai CRUA, não vira 'erro inesperado'", () => {
  // A técnica é feia mas diz algo; a genérica não diz nada e manda abrir chamado.
  const bruto = "Unsupported parameter: 'max_tokens' is not supported with this model";
  assert.equal(motivoAmigavel(bruto), null);
  assert.equal(mensagemDeFalha(bruto), bruto);
});

test("vazio não inventa mensagem", () => {
  assert.equal(motivoAmigavel(""), null);
  assert.equal(motivoAmigavel(null), null);
  assert.equal(motivoAmigavel(undefined), null);
  assert.equal(mensagemDeFalha(null), "");
});
