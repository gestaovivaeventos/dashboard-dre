// O negrito que a IA escreve sozinha.
//
// O caso que mais importa aqui é o do STREAMING: o texto chega com o par de
// asteriscos ainda aberto, e é aí que os `**` apareciam na tela.

import test from "node:test";
import assert from "node:assert/strict";

import { partirNegrito } from "./negrito";

/** Atalho de leitura: "a[b]c" onde os colchetes marcam o negrito. */
function marcado(texto: string): string {
  return partirNegrito(texto)
    .map((t) => (t.negrito ? `[${t.texto}]` : t.texto))
    .join("");
}

test("o caso relatado: os asteriscos somem e a frase fica em negrito", () => {
  const frase = "Nesta categoria de **Capacitação e Treinamentos**, prevemos";
  assert.equal(marcado(frase), "Nesta categoria de [Capacitação e Treinamentos], prevemos");
  // O que o usuário vê não tem mais asterisco nenhum.
  assert.ok(!partirNegrito(frase).some((t) => t.texto.includes("*")));
});

test("vários negritos na mesma mensagem", () => {
  assert.equal(
    marcado("**SERASA S.A.** custou **R$ 11.104,04** no ano"),
    "[SERASA S.A.] custou [R$ 11.104,04] no ano",
  );
});

test("STREAMING: par ainda aberto já sai em negrito, sem asterisco piscando", () => {
  // Como o texto chega letra a letra, este é o estado mais comum da tela.
  assert.equal(marcado("na categoria de **Capacit"), "na categoria de [Capacit]");
  assert.equal(marcado("na categoria de **Capacitação e Treinamentos*"), "na categoria de [Capacitação e Treinamentos*]");
  assert.equal(
    marcado("na categoria de **Capacitação e Treinamentos**"),
    "na categoria de [Capacitação e Treinamentos]",
  );
});

test("asterisco de abertura sozinho não aparece na tela", () => {
  // Um `**` que o modelo esquece de fechar: negrito até o fim, nunca o símbolo.
  const r = partirNegrito("o valor ** subiu muito");
  assert.equal(marcado("o valor ** subiu muito"), "o valor [ subiu muito]");
  assert.ok(!r.some((t) => t.texto.includes("*")));
});

test("texto sem marcação atravessa inteiro, num trecho só", () => {
  assert.deepEqual(partirNegrito("quanto vamos gastar em 2027?"), [
    { texto: "quanto vamos gastar em 2027?", negrito: false },
  ]);
});

test("lista com hífen NÃO é tocada — o pre-wrap já a exibe", () => {
  const lista = "Considere:\n- mídia paga\n- eventos";
  assert.deepEqual(partirNegrito(lista), [{ texto: lista, negrito: false }]);
});

test("asterisco SOLTO (um só) não vira marcação", () => {
  // A categoria gêmea da Omie se chama "Marketing (*)" — não pode sumir.
  const t = "a categoria Marketing (*) entra junto";
  assert.deepEqual(partirNegrito(t), [{ texto: t, negrito: false }]);
});

test("vazio e nulo não quebram", () => {
  assert.deepEqual(partirNegrito(""), []);
  assert.deepEqual(partirNegrito(null), []);
  assert.deepEqual(partirNegrito(undefined), []);
});

test("nenhum trecho vazio é emitido", () => {
  for (const t of ["**a**", "****", "**", "a****b"]) {
    assert.ok(
      partirNegrito(t).every((x) => x.texto !== ""),
      `"${t}" gerou trecho vazio`,
    );
  }
});

test("negrito que atravessa a quebra de linha continua valendo", () => {
  assert.equal(marcado("total:\n**R$ 10,00**"), "total:\n[R$ 10,00]");
});
