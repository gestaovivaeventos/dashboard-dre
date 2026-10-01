// A ponte entre as linhas do banco e o motor.
//
// O defeito que estes testes impedem é SILENCIOSO: campo esquecido no
// mapeamento não dá erro — o motor calcula certo sobre um roteiro incompleto e
// o orçamento sai menor. Por isso o teste principal leva uma viagem COMPLETA e
// confere que cada pedaço chegou do outro lado.

import test from "node:test";
import assert from "node:assert/strict";

import { calcularViagem } from "./motor";
import {
  PARAMETROS_PADRAO,
  gruposDoRetrato,
  lerOutros,
  mesesDoRetrato,
  parametrosDaLinha,
  retratoParaGravar,
  specDaViagem,
} from "./mapear";

/** Linha de viagem como o PostgREST a entrega — `numeric` vem em string. */
const VIAGEM = {
  origem: "Juiz de Fora",
  data_ida: "2027-05-04",
  pessoas: "2",
  pessoas_por_quarto: "2",
  translado_custo_trajeto: "40",
  translado_trajetos: "2",
  volta_modal: "aviao",
  volta_preco_pessoa: "900",
  outros: [{ descricao: "Seguro viagem", valor: "120" }],
};

const PARADAS = [
  {
    ordem: 2,
    cidade: "Florianópolis",
    noites: "1",
    chegada_de: "Curitiba",
    chegada_modal: "onibus",
    chegada_distancia_km: "300",
  },
  {
    ordem: 1,
    cidade: "Curitiba",
    noites: "2",
    chegada_de: "Juiz de Fora",
    chegada_modal: "aviao",
    chegada_preco_pessoa: "800",
    diaria_hotel: "300",
    local_trajetos_dia: "2",
    local_custo_trajeto: "35",
    local_destino: "Viva Eventos Curitiba",
  },
];

test("a viagem COMPLETA atravessa o mapeamento sem perder pedaço", () => {
  const spec = specDaViagem(VIAGEM, PARADAS);
  assert.equal(spec.origem, "Juiz de Fora");
  assert.equal(spec.pessoas, 2);
  assert.equal(spec.pessoasPorQuarto, 2);
  assert.equal(spec.dataIda, "2027-05-04");
  assert.deepEqual(spec.translado, { custoPorTrajeto: 40, trajetos: 2 });
  assert.deepEqual(spec.outros, [{ descricao: "Seguro viagem", valor: 120 }]);

  // As paradas saem na ORDEM, não na ordem do SELECT.
  assert.deepEqual(spec.paradas.map((p) => p.cidade), ["Curitiba", "Florianópolis"]);
  assert.equal(spec.paradas[0].chegada.precoPorPessoa, 800);
  assert.equal(spec.paradas[0].diariaHotel, 300);
  assert.deepEqual(spec.paradas[0].transporteLocal, {
    trajetosPorDia: 2,
    custoPorTrajeto: 35,
    destino: "Viva Eventos Curitiba",
  });
  assert.equal(spec.paradas[1].chegada.distanciaKm, 300);

  // A volta sai da ÚLTIMA parada para a origem.
  assert.equal(spec.volta?.de, "Florianópolis");
  assert.equal(spec.volta?.para, "Juiz de Fora");
  assert.equal(spec.volta?.precoPorPessoa, 900);
});

test("a ordem das paradas muda o roteiro — por isso ela é reordenada aqui", () => {
  // Invertida no banco, o trecho Curitiba→Floripa viraria Floripa→Curitiba e o
  // total de noites continuaria igual: erro que passa despercebido.
  const spec = specDaViagem(VIAGEM, PARADAS);
  assert.equal(spec.paradas[1].chegada.de, "Curitiba");
  assert.equal(spec.paradas[1].chegada.para, "Florianópolis");
});

test("sem `chegada_de` gravado o roteiro NÃO fica com buraco", () => {
  const spec = specDaViagem(VIAGEM, [
    { ordem: 1, cidade: "Curitiba", noites: "1", chegada_modal: "carro", chegada_distancia_km: "900" },
    { ordem: 2, cidade: "Florianópolis", noites: "1", chegada_modal: "carro", chegada_distancia_km: "300" },
  ]);
  assert.equal(spec.paradas[0].chegada.de, "Juiz de Fora", "a 1ª parte da origem");
  assert.equal(spec.paradas[1].chegada.de, "Curitiba", "as demais, da parada anterior");
});

test("o número em STRING soma, não concatena", () => {
  // `numeric` chega como string pelo PostgREST; "800" + "900" daria "800900".
  const spec = specDaViagem(VIAGEM, PARADAS);
  const r = calcularViagem(spec, PARAMETROS_PADRAO);
  assert.ok(Number.isFinite(r.total));
  // 800×2 (aéreo) + 300km×0,42×2 (ônibus) + 900×2 (volta) = 1600 + 252 + 1800
  const passagem = r.grupos.find((g) => g.grupo === "passagem");
  assert.equal(passagem?.total, 3652);
});

test("viagem SEM volta não inventa trecho de retorno", () => {
  const spec = specDaViagem({ ...VIAGEM, volta_modal: null, volta_preco_pessoa: null }, PARADAS);
  assert.equal(spec.volta, null);
});

test("translado incompleto não vira meia linha", () => {
  // Só o custo, sem a quantidade de trajetos, não é informação suficiente.
  const spec = specDaViagem({ ...VIAGEM, translado_trajetos: null }, PARADAS);
  assert.equal(spec.translado, null);
});

test("parâmetros: linha ausente cai no padrão, linha parcial completa o resto", () => {
  assert.deepEqual(parametrosDaLinha(null), PARAMETROS_PADRAO);
  const p = parametrosDaLinha({ hotel_diaria_padrao: "400", diaria_alimentacao: null });
  assert.equal(p.hotelDiariaPadrao, 400);
  assert.equal(p.diariaAlimentacao, PARAMETROS_PADRAO.diariaAlimentacao);
});

test("o retrato guarda os PARÂMETROS usados, não só o número", () => {
  // Sem eles não dá para reconstruir o cálculo depois que a diária mudar.
  const spec = specDaViagem(VIAGEM, PARADAS);
  const params = parametrosDaLinha({ hotel_diaria_padrao: "400" });
  const r = calcularViagem(spec, params);
  const retrato = retratoParaGravar(r, params);
  assert.equal(retrato.custo_total, r.total);
  assert.deepEqual(retrato.parametros, params);
  assert.equal(retrato.meses.length, 12);
  assert.ok(retrato.calculado_em.length > 0);
});

test("o retrato volta do jsonb saneado", () => {
  const meses = mesesDoRetrato(["0", "0", "0", "0", 1500, null, "x"]);
  assert.equal(meses.length, 12);
  assert.equal(meses[4], 1500);
  assert.equal(meses[6], 0, "valor ilegível vira zero, não NaN");
  assert.deepEqual(mesesDoRetrato(null), Array(12).fill(0));
  assert.deepEqual(mesesDoRetrato("nada"), Array(12).fill(0));
});

test("grupo desconhecido no jsonb é descartado", () => {
  const g = gruposDoRetrato([
    { grupo: "hospedagem", label: "Hospedagem", total: "500", linhas: [{ descricao: "Hotel", valor: "500" }] },
    { grupo: "inventado", label: "X", total: 999, linhas: [] },
    "lixo",
  ]);
  assert.equal(g.length, 1);
  assert.equal(g[0].total, 500);
  assert.equal(g[0].linhas[0].valor, 500);
});

test("`outros` ilegível não derruba nem vira linha fantasma", () => {
  assert.deepEqual(lerOutros(null), []);
  assert.deepEqual(lerOutros([{ valor: "50" }]), [{ descricao: "Outro custo", valor: 50 }]);
  assert.deepEqual(lerOutros([{ descricao: "Sem valor" }, "lixo", 7]), []);
});
