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

test("a dica traz categoria, setor e grupos sem repetir", () => {
  const dica = montarDicaTranscricao({
    categoria: "Marketing",
    setor: "Comercial",
    grupos: ["Mídia paga", "Mídia paga", "  Eventos  ", ""],
  });
  assert.match(dica, /Categoria: Marketing\./);
  assert.match(dica, /Setor: Comercial\./);
  assert.match(dica, /Termos: Mídia paga, Eventos\./);
});

test("a dica tem teto de tamanho", () => {
  const grupos = Array.from({ length: 200 }, (_, i) => `Grupo muito comprido número ${i}`);
  assert.ok(montarDicaTranscricao({ categoria: "X", grupos }).length <= 800);
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
