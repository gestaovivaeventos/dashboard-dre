// Ditado por voz: formato do arquivo, vocabulário, consumo e a regra de nunca
// apagar o que o gestor já digitou.

import test from "node:test";
import assert from "node:assert/strict";

import {
  anexarTranscricao,
  escolherFormatoGravacao,
  extensaoDoAudio,
  montarDicaTranscricao,
  usoDaTranscricao,
} from "./transcricao";

test("extensão vem do mime, ignorando os codecs", () => {
  assert.equal(extensaoDoAudio("audio/webm;codecs=opus"), "webm");
  assert.equal(extensaoDoAudio("audio/mp4"), "mp4"); // Safari / iPhone
  assert.equal(extensaoDoAudio("AUDIO/OGG; codecs=opus"), "ogg");
  assert.equal(extensaoDoAudio("audio/x-m4a"), "m4a");
});

test("formato que a API não aceita devolve null", () => {
  assert.equal(extensaoDoAudio("audio/flac-x"), null);
  assert.equal(extensaoDoAudio(""), null);
  assert.equal(extensaoDoAudio(null), null);
});

test("gravação prefere webm/opus e cai para mp4 no Safari", () => {
  assert.equal(escolherFormatoGravacao(() => true), "audio/webm;codecs=opus");
  assert.equal(escolherFormatoGravacao((m) => m === "audio/mp4"), "audio/mp4");
  assert.equal(escolherFormatoGravacao(() => false), "");
});

test("a dica MANDA transcrever literalmente — é a regra principal dela", () => {
  // `gpt-4o-mini-transcribe` é um modelo de linguagem ouvindo, e o `prompt`
  // funciona como instrução. Medido contra a API em 01/10/2026: sem isto,
  // "quinze mil duzentos e cinquenta e sete reais e quarenta e três centavos"
  // voltou como "Ficou R$ 15.257,43." — o modelo reescreve.
  const dica = montarDicaTranscricao({ categoria: "Marketing" });
  assert.match(dica, /PALAVRA POR PALAVRA/);
  assert.match(dica, /não corrija a gramática/i);
  assert.match(dica, /não remova repetições/i);
  assert.match(dica, /nunca o que faria sentido/i);
});

test("a dica NÃO descreve o assunto — só lista termos", () => {
  // Descrever o contexto ("conversa sobre o orçamento anual…") convidaria o
  // modelo a encaixar a fala no tema. Os termos ajudam a GRAFAR nome próprio.
  const dica = montarDicaTranscricao({
    categoria: "Marketing",
    setor: "Comercial",
    grupos: ["Mídia paga", "Mídia paga", "  Eventos  ", ""],
  });
  assert.doesNotMatch(dica, /conversa sobre|orçamento anual/i);
  assert.match(dica, /Termos que podem aparecer: Marketing, Comercial, Mídia paga, Eventos\./);
});

test("sem termo nenhum, a instrução literal continua indo", () => {
  const dica = montarDicaTranscricao({});
  assert.match(dica, /PALAVRA POR PALAVRA/);
  assert.doesNotMatch(dica, /Termos que podem aparecer/);
});

test("a dica tem teto de tamanho", () => {
  const grupos = Array.from({ length: 200 }, (_, i) => `Grupo muito comprido número ${i}`);
  assert.ok(montarDicaTranscricao({ categoria: "X", grupos }).length <= 1200);
});

test("consumo em tokens é lido; em segundos (whisper-1) não", () => {
  assert.deepEqual(
    usoDaTranscricao({ usage: { type: "tokens", input_tokens: 120, output_tokens: 30, total_tokens: 150 } }),
    { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
  );
  assert.equal(usoDaTranscricao({ usage: { type: "duration", seconds: 12 } }), null);
  assert.equal(usoDaTranscricao({ text: "oi" }), null);
  assert.equal(usoDaTranscricao(null), null);
});

test("ditar acrescenta ao texto digitado, nunca apaga", () => {
  assert.equal(anexarTranscricao("", "  cinco mil por mês "), "cinco mil por mês");
  assert.equal(anexarTranscricao("A agência custa", "cinco mil por mês"), "A agência custa cinco mil por mês");
  assert.equal(anexarTranscricao("já digitado", "   "), "já digitado");
});
