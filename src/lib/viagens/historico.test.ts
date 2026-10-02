// O histórico de viagens realizadas.
//
// Três coisas aqui produzem número errado em silêncio se caírem, e cada uma tem
// teste próprio: o fator 2 da passagem (ida e volta), a mediana entre observações
// e o histórico de CARRO não virar preço de passagem.

import test from "node:test";
import assert from "node:assert/strict";

import {
  alimentacaoSugerida,
  custosUnitarios,
  faixaSugeridaDoHistorico,
  modalCotavel,
  quartosDaViagem,
  reajustar,
  referenciaDeHospedagem,
  referenciaDePassagem,
  referenciasPorDestino,
  rotuloDaReferencia,
  type ViagemRealizada,
} from "./historico";

function viagem(p: Partial<ViagemRealizada> = {}): ViagemRealizada {
  return {
    cidade: "Recife",
    mes: 5,
    pessoas: 2,
    noites: 2,
    pessoasPorQuarto: 2,
    modal: "aviao",
    custoPassagem: 4000,
    custoHospedagem: 640,
    custoAlimentacao: 360,
    ...p,
  };
}

// ─── A unidade ──────────────────────────────────────────────────────────────

test("passagem vira R$ por pessoa SÓ IDA — o fator 2 é a armadilha", () => {
  // A planilha traz o total pago (ida e volta, todas as pessoas). O motor cobra
  // cada trecho por pessoa. Esquecer o ÷2 dobraria o orçamento de passagem, e
  // sairia plausível.
  const u = custosUnitarios(viagem({ pessoas: 2, custoPassagem: 4000 }));
  assert.equal(u.passagemPorPessoa, 1000, "4000 / 2 pessoas / 2 trechos");
});

test("hospedagem vira diária por QUARTO, e o quarto depende da ocupação", () => {
  // 4 pessoas dividindo = 2 quartos; cada um no seu = 4. A mesma despesa dá
  // diárias diferentes, e é por isso que a ocupação é coluna.
  const dividindo = custosUnitarios(
    viagem({ pessoas: 4, pessoasPorQuarto: 2, noites: 2, custoHospedagem: 1280 }),
  );
  assert.equal(dividindo.diariaPorQuarto, 320, "1280 / (2 noites × 2 quartos)");
  const individual = custosUnitarios(
    viagem({ pessoas: 4, pessoasPorQuarto: 1, noites: 2, custoHospedagem: 1280 }),
  );
  assert.equal(individual.diariaPorQuarto, 160, "1280 / (2 noites × 4 quartos)");
});

test("ocupação ausente assume 2 — a convenção do módulo", () => {
  assert.equal(quartosDaViagem(viagem({ pessoas: 4, pessoasPorQuarto: null })), 2);
  assert.equal(quartosDaViagem(viagem({ pessoas: 3, pessoasPorQuarto: null })), 2, "arredonda pra cima");
});

test("alimentação é por pessoa por DIA, e dia é noites + 1", () => {
  // Quem dorme 2 noites come em 3 dias. Contar noites subestimaria sempre.
  const u = custosUnitarios(viagem({ pessoas: 2, noites: 2, custoAlimentacao: 360 }));
  assert.equal(u.alimentacaoPorPessoaDia, 60, "360 / (2 pessoas × 3 dias)");
});

test("bate-volta não produz diária, mas produz alimentação", () => {
  const u = custosUnitarios(viagem({ noites: 0, custoHospedagem: 0, custoAlimentacao: 120 }));
  assert.equal(u.diariaPorQuarto, null);
  assert.equal(u.alimentacaoPorPessoaDia, 60, "120 / (2 pessoas × 1 dia)");
});

test("viagem de CARRO não alimenta preço de passagem — mas alimenta o hotel", () => {
  // Ali o custo é km × R$/km. Deixar entrar faria o dia em que alguém for de
  // avião ao mesmo destino sair com o custo do carro. O hotel é hotel.
  for (const modal of ["carro", "van"]) {
    const u = custosUnitarios(viagem({ modal, custoPassagem: 800, custoHospedagem: 640 }));
    assert.equal(u.passagemPorPessoa, null, modal);
    assert.equal(u.diariaPorQuarto, 320, `hotel do ${modal} conta: 640 / (2 noites × 1 quarto)`);
  }
  assert.equal(modalCotavel("aviao"), true);
  assert.equal(modalCotavel("carro"), false);
});

// ─── A agregação por destino ────────────────────────────────────────────────

test("mesma cidade escrita diferente é UM destino", () => {
  // Duas chaves dariam duas referências, cada uma com metade das observações.
  const refs = referenciasPorDestino([
    viagem({ cidade: "São Luís" }),
    viagem({ cidade: "sao luis" }),
  ]);
  assert.equal(refs.size, 1);
  assert.equal(Array.from(refs.values())[0].viagens, 2);
});

test("destino repetido usa a MEDIANA, não a última nem a média", () => {
  // Uma ida atípica (compra de última hora) não pode definir o ano inteiro.
  const refs = referenciasPorDestino([
    viagem({ pessoas: 2, custoPassagem: 2000 }), // 500/pessoa
    viagem({ pessoas: 2, custoPassagem: 4000 }), // 1000/pessoa
    viagem({ pessoas: 2, custoPassagem: 20000 }), // 5000/pessoa — atípica
  ]);
  const r = refs.get("recife")!;
  assert.equal(r.passagemPorPessoa, 1000, "a mediana, não a média (2166) nem a última");
  assert.equal(r.viagensPassagem, 3);
});

test("as observações de carro não contam na contagem da passagem", () => {
  const refs = referenciasPorDestino([
    viagem({ modal: "aviao", custoPassagem: 4000 }),
    viagem({ modal: "carro", custoPassagem: 900 }),
  ]);
  const r = refs.get("recife")!;
  assert.equal(r.viagens, 2);
  assert.equal(r.viagensPassagem, 1);
  assert.equal(r.passagemPorPessoa, 1000, "só a do avião");
});

test("os meses observados vêm ordenados e sem repetição", () => {
  const refs = referenciasPorDestino([
    viagem({ mes: 9 }),
    viagem({ mes: 3 }),
    viagem({ mes: 9 }),
    viagem({ mes: null }),
  ]);
  assert.deepEqual(refs.get("recife")!.meses, [3, 9]);
});

test("cidade em branco é ignorada", () => {
  assert.equal(referenciasPorDestino([viagem({ cidade: "   " })]).size, 0);
});

// ─── O reajuste ─────────────────────────────────────────────────────────────

test("o reajuste é percentual e arredonda a centavo", () => {
  assert.equal(reajustar(1000, 8), 1080);
  assert.equal(reajustar(1180, 8.5), 1280.3);
  assert.equal(reajustar(1000, 0), 1000, "zero não mexe");
  assert.equal(reajustar(1000, -10), 900, "deflação é permitida");
});

test("a referência de passagem sai reajustada e DIZ a conta", () => {
  const refs = referenciasPorDestino([viagem({ pessoas: 2, custoPassagem: 4000, mes: 5 })]);
  const ref = referenciaDePassagem(refs.get("recife"), 2026, { passagem: 8 });
  assert.equal(ref!.valor, 1080);
  assert.equal(ref!.origem, "historico");
  assert.match(ref!.nome, /histórico de Recife em 2026/);
  assert.match(ref!.nome, /mai/);
  assert.match(ref!.nome, /\+8%/);
});

test("a referência de hospedagem usa o reajuste de HOSPEDAGEM, não o de passagem", () => {
  // Tarifa aérea e diária de hotel não sobem no mesmo ritmo — é a razão de o
  // índice ser por grupo de custo.
  const refs = referenciasPorDestino([viagem({ noites: 2, pessoas: 2, custoHospedagem: 640 })]);
  const ref = referenciaDeHospedagem(refs.get("recife"), 2026, { passagem: 50, hospedagem: 10 });
  assert.equal(ref!.valor, 352, "320 + 10%");
});

test("destino sem histórico devolve null — nunca zero", () => {
  // Zero entraria na conta como se a viagem fosse de graça.
  assert.equal(referenciaDePassagem(undefined, 2026, {}), null);
  const refs = referenciasPorDestino([viagem({ custoPassagem: null, custoHospedagem: 640 })]);
  assert.equal(referenciaDePassagem(refs.get("recife"), 2026, {}), null);
  assert.ok(referenciaDeHospedagem(refs.get("recife"), 2026, {}));
});

test("uma observação só não vira 'mediana de 1 viagem'", () => {
  const refs = referenciasPorDestino([viagem()]);
  const r = refs.get("recife")!;
  assert.doesNotMatch(rotuloDaReferencia(r, 2026, 0, 1), /mediana/);
  assert.match(rotuloDaReferencia(r, 2026, 0, 2), /mediana de 2 viagens/);
});

// ─── A faixa derivada do histórico ──────────────────────────────────────────

test("a faixa recebe a mediana entre DESTINOS, não entre viagens", () => {
  // Um destino com seis observações não pode pesar seis vezes mais que outro com
  // uma na definição de uma referência que é regional.
  const refs = referenciasPorDestino([
    viagem({ cidade: "Recife", pessoas: 2, custoPassagem: 4000 }), // 1000
    viagem({ cidade: "Recife", pessoas: 2, custoPassagem: 4000 }),
    viagem({ cidade: "Recife", pessoas: 2, custoPassagem: 4000 }),
    viagem({ cidade: "Natal", pessoas: 2, custoPassagem: 6000 }), // 1500
    viagem({ cidade: "Maceió", pessoas: 2, custoPassagem: 8000 }), // 2000
  ]);
  const sug = faixaSugeridaDoHistorico(
    refs,
    ["Recife", "Natal", "Maceió"],
    "passagem",
    2026,
    { passagem: 0 },
  );
  assert.equal(sug!.valor, 1500, "mediana de 1000/1500/2000");
  assert.deepEqual(sug!.destinos.sort(), ["Maceió", "Natal", "Recife"]);
});

test("faixa cujas cidades não têm histórico devolve null", () => {
  const refs = referenciasPorDestino([viagem({ cidade: "Recife" })]);
  assert.equal(
    faixaSugeridaDoHistorico(refs, ["Manaus", "Belém"], "passagem", 2026, {}),
    null,
  );
});

test("a faixa sugerida já vem reajustada", () => {
  const refs = referenciasPorDestino([viagem({ pessoas: 2, custoPassagem: 4000 })]);
  const sug = faixaSugeridaDoHistorico(refs, ["Recife"], "passagem", 2026, { passagem: 10 });
  assert.equal(sug!.valor, 1100);
});

// ─── A alimentação (parâmetro da empresa) ───────────────────────────────────

test("a alimentação sugerida é a mediana de todos os destinos", () => {
  // É política da empresa, não preço de mercado — por isso não é por destino.
  const refs = referenciasPorDestino([
    viagem({ cidade: "Recife", pessoas: 2, noites: 2, custoAlimentacao: 360 }), // 60
    viagem({ cidade: "Natal", pessoas: 2, noites: 2, custoAlimentacao: 480 }), // 80
    viagem({ cidade: "Maceió", pessoas: 2, noites: 2, custoAlimentacao: 600 }), // 100
  ]);
  assert.equal(alimentacaoSugerida(refs, {}), 80);
  assert.equal(alimentacaoSugerida(refs, { alimentacao: 5 }), 84);
  assert.equal(alimentacaoSugerida(new Map(), {}), null);
});
