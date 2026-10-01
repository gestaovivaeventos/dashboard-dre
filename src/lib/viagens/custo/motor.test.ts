// O motor de custo de viagem.
//
// O que estes testes protegem é a propriedade que justifica o motor existir:
// **todo valor se explica**. Um orçamento de viagem vira comparação orçado ×
// realizado no Financeiro, e número que ninguém consegue reconstruir é número
// que ninguém consegue defender.

import test from "node:test";
import assert from "node:assert/strict";

import { calcularViagem, mesDaData } from "./motor";
import type { ParametrosViagem, ViagemSpec } from "./tipos";

const P: ParametrosViagem = {
  rsPorKm: 2,
  precoCombustivelLitro: 6,
  consumoKmLitro: 10,
  tarifaOnibusKm: 0.5,
  diariaAlimentacao: 100,
  hotelDiariaPadrao: 200,
  aviaoPorKmPessoa: 1,
};

/** Viagem simples: JF → São Paulo de carro, 1 noite, 2 pessoas. */
function simples(over: Partial<ViagemSpec> = {}): ViagemSpec {
  return {
    origem: "Juiz de Fora",
    dataIda: "2027-03-10",
    pessoas: 2,
    pessoasPorQuarto: 2,
    paradas: [
      {
        cidade: "São Paulo",
        noites: 1,
        chegada: { de: "Juiz de Fora", para: "São Paulo", modal: "carro", distanciaKm: 500 },
      },
    ],
    volta: { de: "São Paulo", para: "Juiz de Fora", modal: "carro", distanciaKm: 500 },
    ...over,
  };
}

const grupo = (r: ReturnType<typeof calcularViagem>, g: string) =>
  r.grupos.find((x) => x.grupo === g);

test("o total é a soma dos grupos, e cada linha explica a própria conta", () => {
  const r = calcularViagem(simples(), P);
  assert.equal(
    r.total,
    r.grupos.reduce((a, g) => a + g.total, 0),
  );
  for (const g of r.grupos) {
    for (const l of g.linhas) {
      assert.ok(l.descricao.trim().length > 0, "linha sem descrição");
    }
  }
  // Carro: 500 km × R$ 2 × 1 veículo, nos dois sentidos = 2.000.
  assert.equal(grupo(r, "passagem")?.total, 2000);
  // Hotel: 1 noite × R$ 200 × 1 quarto (2 pessoas dividindo).
  assert.equal(grupo(r, "hospedagem")?.total, 200);
  // Alimentação: 2 dias × R$ 100 × 2 pessoas.
  assert.equal(grupo(r, "alimentacao")?.total, 400);
  assert.equal(r.total, 2600);
});

test("CARRO custa por veículo, não por pessoa", () => {
  // Rodar com 2 ou com 4 pessoas gasta a mesma gasolina — era o erro mais
  // provável de um motor que multiplica tudo por passageiro.
  const dois = calcularViagem(simples({ pessoas: 2 }), P);
  const quatro = calcularViagem(simples({ pessoas: 4, pessoasPorQuarto: 2 }), P);
  assert.equal(grupo(dois, "passagem")?.total, grupo(quatro, "passagem")?.total);
});

test("ÔNIBUS custa por pessoa", () => {
  const spec = simples({
    paradas: [
      {
        cidade: "São Paulo",
        noites: 1,
        chegada: { de: "Juiz de Fora", para: "São Paulo", modal: "onibus", distanciaKm: 500 },
      },
    ],
    volta: { de: "São Paulo", para: "Juiz de Fora", modal: "onibus", distanciaKm: 500 },
  });
  const dois = calcularViagem({ ...spec, pessoas: 2 }, P);
  const quatro = calcularViagem({ ...spec, pessoas: 4 }, P);
  // 500 km × 0,50 × 2 pessoas × 2 trechos = 1.000 → dobra com 4 pessoas.
  assert.equal(grupo(dois, "passagem")?.total, 1000);
  assert.equal(grupo(quatro, "passagem")?.total, 2000);
});

test("QUARTO INDIVIDUAL dobra a hospedagem — e é por isso que é campo", () => {
  const dividindo = calcularViagem(simples({ pessoas: 4, pessoasPorQuarto: 2 }), P);
  const individual = calcularViagem(simples({ pessoas: 4, pessoasPorQuarto: 1 }), P);
  assert.equal(dividindo.quartos, 2);
  assert.equal(individual.quartos, 4);
  assert.equal(grupo(individual, "hospedagem")!.total, grupo(dividindo, "hospedagem")!.total * 2);
});

test("número ÍMPAR de pessoas arredonda o quarto para cima", () => {
  const r = calcularViagem(simples({ pessoas: 3, pessoasPorQuarto: 2 }), P);
  assert.equal(r.quartos, 2, "3 pessoas em quarto duplo são 2 quartos, não 1,5");
});

test("MULTI-DESTINO soma os trechos na ordem do roteiro", () => {
  // JF → Curitiba (2 noites) → Florianópolis (1 noite) → JF.
  const r = calcularViagem(
    {
      origem: "Juiz de Fora",
      dataIda: "2027-05-04",
      pessoas: 2,
      pessoasPorQuarto: 2,
      paradas: [
        {
          cidade: "Curitiba",
          noites: 2,
          chegada: { de: "Juiz de Fora", para: "Curitiba", modal: "aviao", precoPorPessoa: 800 },
        },
        {
          cidade: "Florianópolis",
          noites: 1,
          chegada: { de: "Curitiba", para: "Florianópolis", modal: "onibus", distanciaKm: 300 },
        },
      ],
      volta: { de: "Florianópolis", para: "Juiz de Fora", modal: "aviao", precoPorPessoa: 900 },
    },
    P,
  );
  // 800×2 + (300×0,5×2) + 900×2 = 1600 + 300 + 1800 = 3700
  assert.equal(grupo(r, "passagem")?.total, 3700);
  // 2 noites + 1 noite, 1 quarto.
  assert.equal(r.noites, 3);
  assert.equal(grupo(r, "hospedagem")?.total, 3 * 200);
  // 4 dias de alimentação (3 noites + 1).
  assert.equal(grupo(r, "alimentacao")?.total, 4 * 100 * 2);
});

test("preço informado VENCE a estimativa por km", () => {
  // É por esta porta que a cotação de COMPRA entra depois, com preço real.
  const r = calcularViagem(
    simples({
      paradas: [
        {
          cidade: "São Paulo",
          noites: 1,
          chegada: {
            de: "Juiz de Fora",
            para: "São Paulo",
            modal: "carro",
            distanciaKm: 500,
            precoTotal: 123,
          },
        },
      ],
      volta: null,
    }),
    P,
  );
  assert.equal(grupo(r, "passagem")?.total, 123, "o km não podia ter sido usado");
  assert.ok(
    !r.premissas.some((p) => /quilometragem/i.test(p)),
    "preço informado não deve gerar premissa de estimativa",
  );
});

test("o que foi ARBITRADO vira premissa visível", () => {
  const r = calcularViagem(simples(), P);
  // Diária padrão e quilometragem foram arbitradas — o diretor precisa saber.
  assert.ok(r.premissas.some((p) => /diária padrão/i.test(p)));
  assert.ok(r.premissas.some((p) => /quilometragem/i.test(p)));
});

test("passagem aérea sem cotação avisa que é estimativa grosseira", () => {
  const r = calcularViagem(
    simples({
      paradas: [
        {
          cidade: "São Paulo",
          noites: 1,
          chegada: { de: "Juiz de Fora", para: "São Paulo", modal: "aviao", distanciaKm: 500 },
        },
      ],
      volta: null,
    }),
    P,
  );
  assert.ok(r.premissas.some((p) => /ESTIMADA por quilometragem/i.test(p)));
  assert.ok(r.premissas.some((p) => /Confira antes de aprovar/i.test(p)));
});

test("trecho sem preço E sem distância não some — vira premissa de custo zero", () => {
  // Sumir em silêncio daria um orçamento barato demais sem ninguém perceber.
  const r = calcularViagem(
    simples({
      paradas: [
        {
          cidade: "São Paulo",
          noites: 1,
          chegada: { de: "Juiz de Fora", para: "São Paulo", modal: "aviao" },
        },
      ],
      volta: null,
    }),
    P,
  );
  assert.ok(r.premissas.some((p) => /custo ZERO/i.test(p)));
});

test("transporte local conta os DIAS, não as noites", () => {
  // O deslocamento do último dia existe — contar só as noites o perderia.
  const r = calcularViagem(
    simples({
      paradas: [
        {
          cidade: "São Paulo",
          noites: 2,
          chegada: { de: "Juiz de Fora", para: "São Paulo", modal: "carro", distanciaKm: 100 },
          transporteLocal: { trajetosPorDia: 2, custoPorTrajeto: 30, destino: "Viva Eventos SP" },
        },
      ],
      volta: null,
    }),
    P,
  );
  // 3 dias × 2 trajetos × R$ 30 = 180.
  assert.equal(grupo(r, "transporte_local")?.total, 180);
  assert.match(grupo(r, "transporte_local")!.linhas[0].descricao, /hotel ↔ Viva Eventos SP/);
});

test("o custo cai no MÊS DA PARTIDA, inteiro", () => {
  const r = calcularViagem(simples({ dataIda: "2027-03-10" }), P);
  assert.equal(r.meses[2], r.total, "março é o índice 2");
  assert.equal(r.meses.filter((v) => v !== 0).length, 1);
  assert.equal(
    r.meses.reduce((a, b) => a + b, 0),
    r.total,
  );
});

test("viagem que atravessa a virada do mês NÃO é rateada", () => {
  // Decisão: a DRE é caixa, e passagem e hotel são pagos antes de viajar.
  const r = calcularViagem(simples({ dataIda: "2027-01-31" }), P);
  assert.equal(r.meses[0], r.total);
  assert.equal(r.meses[1], 0);
});

test("sem data não distribui, e diz por quê", () => {
  const r = calcularViagem(simples({ dataIda: "" }), P);
  assert.equal(r.meses.reduce((a, b) => a + b, 0), 0);
  assert.ok(r.premissas.some((p) => /não foi distribuído/i.test(p)));
  assert.ok(r.total > 0, "o total continua valendo — só a distribuição falta");
});

test("linha de valor ZERO não polui a abertura", () => {
  const r = calcularViagem(
    simples({ translado: { custoPorTrajeto: 0, trajetos: 4 }, outros: [{ descricao: "X", valor: 0 }] }),
    P,
  );
  assert.equal(grupo(r, "translado"), undefined);
  assert.equal(grupo(r, "outros"), undefined);
});

test("valor inválido não contamina o total com NaN", () => {
  const r = calcularViagem(
    simples({ outros: [{ descricao: "Quebrado", valor: Number.NaN }] }),
    P,
  );
  assert.ok(Number.isFinite(r.total));
  assert.equal(r.total, 2600);
});

test("mesDaData aceita só ISO válido", () => {
  assert.equal(mesDaData("2027-03-10"), 3);
  assert.equal(mesDaData("2027-12-01"), 12);
  assert.equal(mesDaData("2027-13-01"), null);
  assert.equal(mesDaData("10/03/2027"), null);
  assert.equal(mesDaData(""), null);
  assert.equal(mesDaData(null), null);
});
