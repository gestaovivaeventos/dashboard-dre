// A grade de viagens.
//
// Ela existe porque ~50 viagens por ano, a destinos que não se repetem, não cabem
// em 50 conversas. O que estes testes protegem é o que a grade DERIVA — e cada
// derivação é uma suposição que, errada, muda o orçamento em silêncio.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PESSOAS_POR_QUARTO_PADRAO,
  TRAJETOS_DIA_PADRAO,
  TRANSLADO_TRAJETOS_AEREO,
  modalDaLinhaDaGrade,
  paradaRowDaLinha,
  quartosDaLinha,
  resumirLote,
  tituloDaLinha,
  validarLinhaViagem,
  viagemRowDaLinha,
  type LinhaViagemInput,
} from "./grade";

const LINHA: LinhaViagemInput = {
  destino: "Curitiba",
  mesIda: 3,
  noites: 2,
  pessoas: 3,
  tipoId: "t1",
  faixaPassagemId: "f-aerea",
  faixaHospedagemId: "f-hotel",
};

// ─── O que basta para gravar ────────────────────────────────────────────────

test("só DESTINO e TIPO são obrigatórios para gravar a linha", () => {
  // A grade é preenchida de cima para baixo: barrar por campo incompleto faria o
  // gestor perder as 49 linhas certas por causa de uma. Quem cobra o conjunto é o
  // envio, que exige mês e custo.
  assert.equal(validarLinhaViagem({ destino: "Recife", mesIda: null, noites: 0, pessoas: 1, tipoId: "t1" }), null);
  assert.match(validarLinhaViagem({ ...LINHA, destino: "  " })!, /cidade de destino/);
  assert.match(validarLinhaViagem({ ...LINHA, tipoId: "" })!, /tipo da viagem/);
});

test("mês fora da faixa é erro; mês AUSENTE não é", () => {
  // Ausente é estado legítimo (o gestor ainda não decidiu); 13 é digitação errada.
  assert.equal(validarLinhaViagem({ ...LINHA, mesIda: null }), null);
  assert.match(validarLinhaViagem({ ...LINHA, mesIda: 13 })!, /Mês inválido/);
  assert.match(validarLinhaViagem({ ...LINHA, mesIda: 0 })!, /Mês inválido/);
  assert.match(validarLinhaViagem({ ...LINHA, mesIda: 3.5 })!, /Mês inválido/);
});

// ─── O que a grade DERIVA ───────────────────────────────────────────────────

test("quartos = ceil(pessoas / porQuarto), com 2 por quarto por padrão", () => {
  assert.equal(PESSOAS_POR_QUARTO_PADRAO, 2);
  assert.equal(quartosDaLinha({ ...LINHA, pessoas: 3 }), 2, "3 pessoas em duplo = 2 quartos");
  assert.equal(quartosDaLinha({ ...LINHA, pessoas: 4 }), 2);
  assert.equal(quartosDaLinha({ ...LINHA, pessoas: 4, pessoasPorQuarto: 1 }), 4, "individual");
  assert.equal(quartosDaLinha({ ...LINHA, pessoas: 1 }), 1);
});

test("o modal vem da FAIXA, e a linha pode sobrescrever", () => {
  // Um destino de 400 km com 4 pessoas pode compensar de carro, contra o aéreo
  // que a faixa pressupõe.
  assert.equal(modalDaLinhaDaGrade(LINHA, "aviao"), "aviao");
  assert.equal(modalDaLinhaDaGrade({ ...LINHA, modal: "carro" }, "aviao"), "carro");
  // Sem faixa e sem escolha, avião é o padrão (é o caso dominante).
  assert.equal(modalDaLinhaDaGrade(LINHA, null), "aviao");
  // Modal inventado não vira undefined.
  assert.equal(modalDaLinhaDaGrade({ ...LINHA, modal: "foguete" }, null), "outro");
});

test("TRANSLADO só existe em viagem aérea", () => {
  // Casa ↔ aeroporto não acontece em viagem de carro. É suposição, e por isso o
  // custo dela aparece como linha própria na árvore.
  const aereo = viagemRowDaLinha(LINHA, "aviao", 40);
  assert.equal(aereo.translado_custo_trajeto, 40);
  assert.equal(aereo.translado_trajetos, TRANSLADO_TRAJETOS_AEREO);

  const carro = viagemRowDaLinha(LINHA, "carro", 40);
  assert.equal(carro.translado_custo_trajeto, null);
  assert.equal(carro.translado_trajetos, null);
});

test("sem custo de translado cadastrado, não se inventa trajeto", () => {
  // Trajetos sem custo somariam zero e poluiriam a árvore com uma linha vazia.
  const r = viagemRowDaLinha(LINHA, "aviao", null);
  assert.equal(r.translado_custo_trajeto, null);
  assert.equal(r.translado_trajetos, null);
});

test("a VOLTA usa o mesmo modal da ida", () => {
  // O gestor respondeu "voltam direto": volta diferente é exceção, pela tela da
  // viagem.
  assert.equal(viagemRowDaLinha(LINHA, "onibus", null).volta_modal, "onibus");
});

test("a parada leva trajetos/dia só quando há PERNOITE", () => {
  // Hotel ↔ compromisso não existe em bate-volta.
  assert.equal(paradaRowDaLinha(LINHA, "Juiz de Fora", "aviao").local_trajetos_dia, TRAJETOS_DIA_PADRAO);
  assert.equal(
    paradaRowDaLinha({ ...LINHA, noites: 0 }, "Juiz de Fora", "aviao").local_trajetos_dia,
    null,
  );
  // O que o gestor digitou vence o padrão, inclusive zero.
  assert.equal(
    paradaRowDaLinha({ ...LINHA, localTrajetosDia: 0 }, "Juiz de Fora", "aviao").local_trajetos_dia,
    0,
  );
});

test("a parada nasce SEM preço — ele vem da faixa, no motor", () => {
  // Gravar o valor da faixa aqui o congelaria: mudar a faixa deixaria de refletir
  // nas viagens que ainda não foram fechadas.
  const p = paradaRowDaLinha(LINHA, "Juiz de Fora", "aviao");
  assert.equal(p.chegada_preco_pessoa, null);
  assert.equal(p.chegada_preco_total, null);
  assert.equal(p.diaria_hotel, null);
});

test("a parada carrega a ORIGEM e é sempre a ordem 1", () => {
  const p = paradaRowDaLinha(LINHA, "Juiz de Fora", "aviao");
  assert.equal(p.chegada_de, "Juiz de Fora");
  assert.equal(p.cidade, "Curitiba");
  assert.equal(p.ordem, 1);
});

test("a distância só é gravada quando informada", () => {
  // Ela só pesa em carro/van; no aéreo o motor a ignora e diz isso na premissa.
  assert.equal(paradaRowDaLinha(LINHA, "JF", "carro").chegada_distancia_km, null);
  assert.equal(
    paradaRowDaLinha({ ...LINHA, distanciaKm: 420 }, "JF", "carro").chegada_distancia_km,
    420,
  );
});

test("número em string não quebra as derivações", () => {
  // A grade é uma tela: tudo chega como string do input.
  const l = {
    ...LINHA,
    noites: "2" as unknown as number,
    pessoas: "3" as unknown as number,
    pessoasPorQuarto: "2" as unknown as number,
  };
  assert.equal(quartosDaLinha(l), 2);
  assert.equal(viagemRowDaLinha(l, "aviao", null).pessoas, 3);
  assert.equal(paradaRowDaLinha(l, "JF", "aviao").noites, 2);
});

test("o título padrão é o destino", () => {
  assert.equal(tituloDaLinha(LINHA), "Curitiba");
  assert.equal(tituloDaLinha({ ...LINHA, destino: "   " }), "Viagem sem destino");
});

// ─── O lote ─────────────────────────────────────────────────────────────────

test("o lote falha POR LINHA, e o resumo conta as duas pontas", () => {
  // Destino errado na linha 30 não pode custar as 49 certas — é a mesma regra da
  // importação do plano de cargos.
  const r = resumirLote([
    { indice: 0, id: "a", custoTotal: 100 },
    { indice: 1, erro: "Informe a cidade de destino." },
    { indice: 2, id: "c", custoTotal: 200 },
  ]);
  assert.deepEqual(r, { gravadas: 2, comErro: 1, total: 3 });
  assert.deepEqual(resumirLote([]), { gravadas: 0, comErro: 0, total: 0 });
});
