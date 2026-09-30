// Os parâmetros que mudam de nome conforme o modelo.
//
// O caso real: trocar o modelo para `gpt-6-luna` derrubou o teste de conexão do
// painel com "Unsupported parameter: 'max_tokens'". O palpite pelo nome resolve
// o que dá para prever; a correção pela resposta resolve o resto — e é ela que
// importa, porque o painel deixa cadastrar qualquer modelo.

import test from "node:test";
import assert from "node:assert/strict";

import {
  aceitaTemperatura,
  corrigirCorpoPelaResposta,
  opcoesSdk,
  parametrosChat,
  tetoDeTokens,
  usaMaxCompletionTokens,
} from "./parametros-chat";

test("as famílias novas da OpenAI usam max_completion_tokens", () => {
  for (const m of ["gpt-6-luna", "gpt-5.6-luna", "gpt-5-mini", "gpt-5", "o1", "o3-mini", "o4"]) {
    assert.equal(usaMaxCompletionTokens(m), true, m);
  }
});

test("as antigas e os outros provedores seguem com max_tokens", () => {
  for (const m of ["gpt-4o", "gpt-4o-mini", "gpt-4.1", "deepseek-chat", "deepseek-v4-flash", "gemini-3.8-flash", ""]) {
    assert.equal(usaMaxCompletionTokens(m), false, m);
  }
});

test("o nome do teto sai pronto para o corpo", () => {
  assert.deepEqual(tetoDeTokens("gpt-4o-mini", 8192), { max_tokens: 8192 });
  assert.deepEqual(tetoDeTokens("gpt-6-luna", 8192), { max_completion_tokens: 8192 });
});

test("modelo de raciocínio NÃO recebe temperature", () => {
  // Mandar temperature: 0 neles devolve 400 do mesmo naipe do max_tokens.
  assert.equal(aceitaTemperatura("gpt-6-luna"), false);
  assert.equal(aceitaTemperatura("gpt-4o-mini"), true);
  assert.deepEqual(parametrosChat("gpt-6-luna", { teto: 100, temperatura: 0 }), {
    max_completion_tokens: 100,
  });
  assert.deepEqual(parametrosChat("gpt-4o-mini", { teto: 100, temperatura: 0 }), {
    max_tokens: 100,
    temperature: 0,
  });
});

test("a MENSAGEM REAL da OpenAI corrige o corpo", () => {
  const erro =
    "Unsupported parameter: 'max_tokens' is not supported with this model. " +
    "Use 'max_completion_tokens' instead.";
  const corrigido = corrigirCorpoPelaResposta({ model: "x", max_tokens: 5, temperature: 0 }, erro);
  assert.deepEqual(corrigido, { model: "x", max_completion_tokens: 5, temperature: 0 });
});

test("corrige também o caminho INVERSO", () => {
  // Provedor que só conhece o nome antigo (ou um palpite errado para mais).
  const corrigido = corrigirCorpoPelaResposta(
    { model: "x", max_completion_tokens: 5 },
    "Unrecognized request argument supplied: max_completion_tokens",
  );
  assert.deepEqual(corrigido, { model: "x", max_tokens: 5 });
});

test("temperature não suportada é REMOVIDA, não zerada", () => {
  const corrigido = corrigirCorpoPelaResposta(
    { model: "x", max_completion_tokens: 5, temperature: 0 },
    "Unsupported value: 'temperature' does not support 0 with this model.",
  );
  assert.deepEqual(corrigido, { model: "x", max_completion_tokens: 5 });
});

test("erro de OUTRA natureza não vira nova tentativa", () => {
  // Repetir com o mesmo corpo só gastaria tempo e crédito.
  for (const erro of [
    "You have no credits remaining.",
    "Incorrect API key provided.",
    "The model `gpt-9-inexistente` does not exist.",
  ]) {
    assert.equal(corrigirCorpoPelaResposta({ model: "x", max_tokens: 5 }, erro), null, erro);
  }
});

test("não inventa correção quando o parâmetro citado nem está no corpo", () => {
  assert.equal(
    corrigirCorpoPelaResposta({ model: "x" }, "Use 'max_completion_tokens' instead."),
    null,
  );
});

test("o SDK não recebe teto nem temperature nas famílias novas", () => {
  // Medido contra a API: com `maxOutputTokens` o SDK manda `max_tokens` e o
  // gpt-6-luna recusa; `temperature` é recusada à parte. Sem os dois, funciona.
  assert.deepEqual(opcoesSdk("gpt-6-luna", { temperature: 0.2, maxOutputTokens: 16000 }), {});
  assert.deepEqual(opcoesSdk("gpt-5-mini", { temperature: 0, maxOutputTokens: 4000 }), {});
});

test("o SDK segue recebendo os dois nos modelos antigos e no DeepSeek", () => {
  // O teto importa no DeepSeek, que em json_object gera muito mais token.
  assert.deepEqual(opcoesSdk("gpt-4o-mini", { temperature: 0.2, maxOutputTokens: 16000 }), {
    temperature: 0.2,
    maxOutputTokens: 16000,
  });
  assert.deepEqual(opcoesSdk("deepseek-v4-flash", { temperature: 0, maxOutputTokens: 8192 }), {
    temperature: 0,
    maxOutputTokens: 8192,
  });
});

test("opção ausente não vira undefined explícito", () => {
  assert.deepEqual(opcoesSdk("gpt-4o", {}), {});
  assert.deepEqual(opcoesSdk("gpt-4o", { temperature: 0 }), { temperature: 0 });
});
