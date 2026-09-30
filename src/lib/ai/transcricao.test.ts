// Ditado por voz: formato do arquivo, vocabulário, consumo e a regra de nunca
// apagar o que o gestor já digitou.

import test from "node:test";
import assert from "node:assert/strict";

import {
  SEM_FALA,
  anexarTranscricao,
  escolherFormatoGravacao,
  extensaoDoAudio,
  limparTranscricao,
  mimeParaGemini,
  montarDicaTranscricao,
  montarPromptGemini,
  usoDaTranscricao,
  usoGemini,
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

// ─── Gemini ─────────────────────────────────────────────────────────────────
// O Gemini é um modelo de CHAT fazendo o trabalho de um transcritor. Tudo
// abaixo trava um jeito concreto de ele devolver algo que não é transcrição —
// e que iria direto para a caixa de resposta do gestor.

test("o prompt proíbe moldura, resposta ao conteúdo e resumo", () => {
  const p = montarPromptGemini("Categoria: Marketing.");
  assert.match(p, /APENAS com a transcrição/i);
  assert.match(p, /NÃO responda ao que foi dito/i);
  assert.match(p, /NÃO resuma|não resuma/i);
  assert.ok(p.includes(SEM_FALA), "precisa combinar o sentinela de silêncio");
  assert.ok(p.includes("Categoria: Marketing."), "a dica entra como vocabulário");
});

test("o sentinela de silêncio vira texto vazio", () => {
  assert.equal(limparTranscricao(SEM_FALA), "");
  assert.equal(limparTranscricao("  (Sem Fala)  "), "");
});

test("bloco de código e aspas em volta de TUDO são removidos", () => {
  assert.equal(limparTranscricao("```\nmídia paga, cinco mil\n```"), "mídia paga, cinco mil");
  assert.equal(limparTranscricao("```text\nmídia paga\n```"), "mídia paga");
  assert.equal(limparTranscricao('"mídia paga, cinco mil"'), "mídia paga, cinco mil");
});

test("aspas NO MEIO da fala são preservadas", () => {
  // Quem dita pode citar algo; tirar as aspas mudaria o que ele disse.
  const t = 'o fornecedor chamou de "pacote premium" na proposta';
  assert.equal(limparTranscricao(t), t);
});

test("texto normal atravessa intacto", () => {
  assert.equal(limparTranscricao("R$ 5.000,00 por mês a partir de janeiro"), "R$ 5.000,00 por mês a partir de janeiro");
  assert.equal(limparTranscricao(null), "");
  assert.equal(limparTranscricao("   "), "");
});

test("o mime perde os codecs e o container de vídeo vira áudio", () => {
  assert.equal(mimeParaGemini("audio/webm;codecs=opus"), "audio/webm");
  // O Chrome às vezes reporta video/webm para uma trilha só de áudio.
  assert.equal(mimeParaGemini("video/webm"), "audio/webm");
  assert.equal(mimeParaGemini("video/mp4"), "audio/mp4");
  assert.equal(mimeParaGemini("audio/mp4"), "audio/mp4");
  assert.equal(mimeParaGemini(""), "audio/webm");
  assert.equal(mimeParaGemini(null), "audio/webm");
});

test("o consumo do Gemini soma áudio e texto no input", () => {
  // Números reais da sonda de 29/09/2026 contra a API.
  const uso = usoGemini({
    usageMetadata: { promptTokenCount: 84, candidatesTokenCount: 4, totalTokenCount: 88 },
  });
  assert.deepEqual(uso, { inputTokens: 84, outputTokens: 4, totalTokens: 88 });
});

test("o raciocínio, se alguém religar, conta como saída", () => {
  const uso = usoGemini({
    usageMetadata: {
      promptTokenCount: 84,
      candidatesTokenCount: 3,
      thoughtsTokenCount: 391,
      totalTokenCount: 478,
    },
  });
  assert.equal(uso?.outputTokens, 394);
  assert.equal(uso?.totalTokens, 478);
});

test("resposta sem usageMetadata não inventa consumo", () => {
  assert.equal(usoGemini({}), null);
  assert.equal(usoGemini(null), null);
});
