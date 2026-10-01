// Aplicar os preços encontrados ao roteiro.
//
// O defeito que estes testes impedem é o pior desta tela: a busca sobrescrever um
// preço que a pessoa digitou. Quem digitou quase sempre tem a cotação na mão, e
// trocá-la pelo "menor preço encontrado na web" rebaixaria o orçamento com
// aparência de pesquisa — pior do que não buscar.

import test from "node:test";
import assert from "node:assert/strict";

import { aplicarPrecos, indiceDaParada } from "./aplicar";
import type { RoteiroEditavel } from "@/lib/viagens/cartao";

const ROTEIRO: RoteiroEditavel = {
  titulo: "Implantação",
  origem: "Juiz de Fora",
  dataIda: "2027-05-04",
  pessoas: 2,
  pessoasPorQuarto: 2,
  voltaModal: "aviao",
  voltaPrecoPessoa: null,
  voltaPrecoTotal: null,
  paradas: [
    { cidade: "Curitiba", noites: 2, chegadaModal: "aviao", diariaHotel: null },
    { cidade: "Florianópolis", noites: 1, chegadaModal: "onibus", diariaHotel: null },
  ],
};

test("preenche o que está vazio: passagem por trecho e diária por cidade", () => {
  const r = aplicarPrecos(ROTEIRO, {
    trechos: [
      { id: "p0", precoPorPessoa: 800, fonte: "voopter" },
      { id: "p1", precoPorPessoa: 150, fonte: "clickbus" },
      { id: "volta", precoPorPessoa: 900, fonte: "kayak" },
    ],
    hoteis: [
      { cidade: "Curitiba", diaria: 300, fonte: "booking" },
      { cidade: "Florianópolis", diaria: 280, fonte: "booking" },
    ],
  });
  assert.equal(r.roteiro.paradas[0].chegadaPrecoPessoa, 800);
  assert.equal(r.roteiro.paradas[1].chegadaPrecoPessoa, 150);
  assert.equal(r.roteiro.voltaPrecoPessoa, 900);
  assert.equal(r.roteiro.paradas[0].diariaHotel, 300);
  assert.equal(r.roteiro.paradas[1].diariaHotel, 280);
  assert.equal(r.aplicados.length, 5);
  assert.deepEqual(r.ignorados, []);
});

test("NÃO sobrescreve preço que a pessoa digitou — e diz que ignorou", () => {
  const comPreco: RoteiroEditavel = {
    ...ROTEIRO,
    voltaPrecoPessoa: 1200,
    paradas: [
      { ...ROTEIRO.paradas[0], chegadaPrecoPessoa: 650, diariaHotel: 420 },
      { ...ROTEIRO.paradas[1] },
    ],
  };
  const r = aplicarPrecos(comPreco, {
    trechos: [
      { id: "p0", precoPorPessoa: 800, fonte: null },
      { id: "volta", precoPorPessoa: 900, fonte: null },
    ],
    hoteis: [{ cidade: "Curitiba", diaria: 300, fonte: null }],
  });
  assert.equal(r.roteiro.paradas[0].chegadaPrecoPessoa, 650, "a cotação da pessoa manda");
  assert.equal(r.roteiro.voltaPrecoPessoa, 1200);
  assert.equal(r.roteiro.paradas[0].diariaHotel, 420);
  assert.equal(r.aplicados.length, 0);
  assert.equal(r.ignorados.filter((x) => /já tinha/.test(x)).length, 3);
});

test("preço FECHADO do trecho também bloqueia", () => {
  // `precoTotal` é cotação igualmente — e tem precedência no motor.
  const r = aplicarPrecos(
    { ...ROTEIRO, paradas: [{ ...ROTEIRO.paradas[0], chegadaPrecoTotal: 1500 }] },
    { trechos: [{ id: "p0", precoPorPessoa: 800, fonte: null }], hoteis: [] },
  );
  assert.equal(r.roteiro.paradas[0].chegadaPrecoPessoa, undefined);
  assert.match(r.ignorados[0], /já tinha preço/);
});

test("trecho de CARRO/VAN é ignorado — ali o custo vem do R$/km", () => {
  // Pôr um preço de passagem num trecho de carro trocaria o método do trecho.
  for (const modal of ["carro", "van"]) {
    const r = aplicarPrecos(
      { ...ROTEIRO, paradas: [{ ...ROTEIRO.paradas[0], chegadaModal: modal }] },
      { trechos: [{ id: "p0", precoPorPessoa: 800, fonte: null }], hoteis: [] },
    );
    // A parada do fixture nem tem o campo: o que importa é que o preço NÃO entrou.
    assert.ok(!r.roteiro.paradas[0].chegadaPrecoPessoa, modal);
    assert.match(r.ignorados[0], /R\$\/km/);
  }
});

test("cidade com acento diferente ainda casa", () => {
  // O modelo escreve "Florianopolis" com frequência; recusar perderia a diária.
  const r = aplicarPrecos(ROTEIRO, {
    trechos: [],
    hoteis: [{ cidade: "FLORIANOPOLIS", diaria: 280, fonte: null }],
  });
  assert.equal(r.roteiro.paradas[1].diariaHotel, 280);
});

test("cidade fora do roteiro, parada que sumiu e volta inexistente são DITAS", () => {
  // Busca que "não fez nada" sem motivo faz a pessoa clicar de novo achando que
  // falhou.
  const r = aplicarPrecos(
    { ...ROTEIRO, voltaModal: null },
    {
      trechos: [
        { id: "p9", precoPorPessoa: 700, fonte: null },
        { id: "volta", precoPorPessoa: 900, fonte: null },
        { id: "lixo", precoPorPessoa: 700, fonte: null },
      ],
      hoteis: [{ cidade: "Salvador", diaria: 300, fonte: null }],
    },
  );
  assert.equal(r.aplicados.length, 0);
  assert.match(r.ignorados.join(" | "), /não existe mais no roteiro/);
  assert.match(r.ignorados.join(" | "), /não tem trecho de volta/);
  assert.match(r.ignorados.join(" | "), /não está no roteiro/);
});

test("cidade sem noites não recebe diária", () => {
  // Diária em parada de passagem somaria hospedagem que não existe.
  const r = aplicarPrecos(
    { ...ROTEIRO, paradas: [{ ...ROTEIRO.paradas[0], noites: 0 }] },
    { trechos: [], hoteis: [{ cidade: "Curitiba", diaria: 300, fonte: null }] },
  );
  assert.equal(r.roteiro.paradas[0].diariaHotel, null);
  assert.match(r.ignorados[0], /sem noites/);
});

test("valor zero ou negativo não entra", () => {
  const r = aplicarPrecos(ROTEIRO, {
    trechos: [{ id: "p0", precoPorPessoa: 0, fonte: null }],
    hoteis: [{ cidade: "Curitiba", diaria: -10, fonte: null }],
  });
  assert.equal(r.aplicados.length, 0);
  assert.equal(r.ignorados.length, 2);
});

test("aplicar não muta o roteiro original", () => {
  const antes = JSON.stringify(ROTEIRO);
  aplicarPrecos(ROTEIRO, {
    trechos: [{ id: "p0", precoPorPessoa: 800, fonte: null }],
    hoteis: [{ cidade: "Curitiba", diaria: 300, fonte: null }],
  });
  assert.equal(JSON.stringify(ROTEIRO), antes);
});

test("indiceDaParada só aceita o formato pN", () => {
  assert.equal(indiceDaParada("p0"), 0);
  assert.equal(indiceDaParada("p12"), 12);
  assert.equal(indiceDaParada("volta"), null);
  assert.equal(indiceDaParada("p-1"), null);
  assert.equal(indiceDaParada("px"), null);
  assert.equal(indiceDaParada(""), null);
});
