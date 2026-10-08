// A abertura do orçado no drilldown do Budget, agrupada por SETOR.

import test from "node:test";
import assert from "node:assert/strict";

import {
  agruparDetalheOrcado,
  contarDespesas,
  totalDoDetalhe,
  type LinhaDetalheOrcado,
  type SetorDaLinha,
} from "./budget-detalhe";

const nomes: Record<string, string> = { c1: "Terrazzo", c2: "Sirena" };

/** O resolvedor real mora na rota; aqui o setor vem da própria source de teste. */
function porSource(comEmpresa = false) {
  return {
    setorDaLinha: (l: LinhaDetalheOrcado): SetorDaLinha => {
      const base = (l.source ?? "").trim() || "Sem setor";
      const empresa = comEmpresa ? nomes[l.company_id] ?? "" : "";
      return {
        rotulo: empresa ? `${base} · ${empresa}` : base,
        semSetor: base === "Sem setor",
      };
    },
  };
}

const UM_SETOR = { setorDaLinha: () => ({ rotulo: "Marketing", semSetor: false }) };

test("a mesma despesa em 12 meses vira UMA linha somada", () => {
  const linhas = Array.from({ length: 12 }, () => ({
    company_id: "c1",
    nome: "SAMS CLUB",
    valor: 100,
    source: "Marketing",
  }));
  const r = agruparDetalheOrcado(linhas, porSource());
  assert.equal(r.length, 1);
  assert.deepEqual(r[0].itens, [{ nome: "SAMS CLUB", valor: 1200 }]);
  assert.equal(r[0].total, 1200);
});

test("dentro do setor, ordena da maior para a menor", () => {
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Pequena", valor: 10, source: "Marketing" },
      { company_id: "c1", nome: "Grande", valor: 900, source: "Marketing" },
      { company_id: "c1", nome: "Média", valor: 300, source: "Marketing" },
    ],
    porSource(),
  );
  assert.deepEqual(r[0].itens.map((i) => i.nome), ["Grande", "Média", "Pequena"]);
});

// ─── O agrupamento por setor ────────────────────────────────────────────────

test("a lista SAI POR SETOR, não corrida", () => {
  // Era o pedido: numa conta que vários setores alimentam, a lista corrida dizia
  // quanto foi orçado sem dizer por quem.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Mídia paga", valor: 500, source: "Marketing" },
      { company_id: "c1", nome: "Feira", valor: 800, source: "Comercial" },
      { company_id: "c1", nome: "Brindes", valor: 100, source: "Marketing" },
    ],
    porSource(),
  );
  assert.deepEqual(r.map((g) => g.setor), ["Comercial", "Marketing"], "maior primeiro");
  assert.equal(r[0].total, 800);
  assert.deepEqual(r[1].itens.map((i) => i.nome), ["Mídia paga", "Brindes"]);
  assert.equal(r[1].total, 600);
});

test("a MESMA despesa em dois setores não se funde", () => {
  // Fundir responderia "Passagens: R$ 300" e esconderia que dois setores viajam.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Passagens", valor: 100, source: "Marketing" },
      { company_id: "c1", nome: "Passagens", valor: 200, source: "Comercial" },
    ],
    porSource(),
  );
  assert.equal(r.length, 2);
  assert.equal(totalDoDetalhe(r), 300);
  assert.equal(contarDespesas(r), 2);
});

test('"Sem setor" vai por ÚLTIMO mesmo sendo o maior', () => {
  // Mesma convenção de "Sem grupo" e do "Sem setor" do quadro de pessoal: é
  // dívida visível, não um setor de verdade, e misturá-lo o faria passar por um.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Grandona", valor: 9000, source: "" },
      { company_id: "c1", nome: "Pequena", valor: 10, source: "Marketing" },
    ],
    porSource(),
  );
  assert.deepEqual(r.map((g) => g.setor), ["Marketing", "Sem setor"]);
  assert.equal(r[1].semSetor, true);
});

test("o total do drilldown é a soma do que está na tela", () => {
  // O invariante do Caixa, aqui também: total que ignora o recorte é o que torna
  // a tela não confiável.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "A", valor: 100.5, source: "Marketing" },
      { company_id: "c1", nome: "B", valor: 200.25, source: "Comercial" },
    ],
    porSource(),
  );
  assert.equal(totalDoDetalhe(r), 300.75);
  assert.equal(contarDespesas(r), 2);
});

// ─── O consolidado de várias empresas ───────────────────────────────────────

test("consolidado de VÁRIAS empresas não funde setores homônimos", () => {
  // "Marketing" existe nas duas empresas, com ids diferentes. Sem a empresa no
  // rótulo viraria um grupo só, e o leitor concluiria que é um setor que gasta o
  // dobro.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Aluguel", valor: 100, source: "Marketing" },
      { company_id: "c2", nome: "Aluguel", valor: 200, source: "Marketing" },
    ],
    porSource(true),
  );
  assert.equal(r.length, 2);
  assert.deepEqual(
    r.map((g) => g.setor).sort(),
    ["Marketing · Sirena", "Marketing · Terrazzo"],
  );
  // A empresa fica no CABEÇALHO, não repetida em cada despesa.
  assert.deepEqual(r[0].itens.map((i) => i.nome), ["Aluguel"]);
});

test("empresa sem setor nas DUAS empresas continua separada", () => {
  // `orc:pessoal:-:-` é idêntica em toda empresa que não orça por setor: sem a
  // empresa no rótulo, as duas cairiam no mesmo balde.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Folha", valor: 100, source: "" },
      { company_id: "c2", nome: "Folha", valor: 200, source: "" },
    ],
    porSource(true),
  );
  assert.equal(r.length, 2);
  assert.ok(r.every((g) => g.semSetor), "os dois continuam sendo o balde");
});

test("uma empresa só não polui o rótulo", () => {
  const r = agruparDetalheOrcado(
    [{ company_id: "c1", nome: "Aluguel", valor: 100, source: "Marketing" }],
    porSource(),
  );
  assert.equal(r[0].setor, "Marketing");
});

// ─── O que já se travava antes, e continua valendo ──────────────────────────

test("numeric em STRING soma, não concatena", () => {
  // O PostgREST pode entregar `numeric` como string; "100" + "200" daria
  // "100200" e o drilldown mostraria um número absurdo.
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "X", valor: "100.50" },
      { company_id: "c1", nome: "X", valor: "200.25" },
    ],
    UM_SETOR,
  );
  assert.deepEqual(r[0].itens, [{ nome: "X", valor: 300.75 }]);
});

test("zero e valor inválido não viram linha", () => {
  const r = agruparDetalheOrcado(
    [
      { company_id: "c1", nome: "Zerada", valor: 0 },
      { company_id: "c1", nome: "Quebrada", valor: "abc" },
      { company_id: "c1", nome: "Boa", valor: 5 },
    ],
    UM_SETOR,
  );
  assert.deepEqual(r[0].itens, [{ nome: "Boa", valor: 5 }]);
});

test("setor que ficaria só com itens zerados não vira grupo vazio", () => {
  const r = agruparDetalheOrcado([{ company_id: "c1", nome: "Zerada", valor: 0 }], UM_SETOR);
  assert.deepEqual(r, []);
});

test("despesa sem nome não some da lista", () => {
  const r = agruparDetalheOrcado([{ company_id: "c1", nome: "  ", valor: 50 }], UM_SETOR);
  assert.deepEqual(r[0].itens, [{ nome: "Sem nome", valor: 50 }]);
});

test("lista vazia devolve vazio", () => {
  assert.deepEqual(agruparDetalheOrcado([], UM_SETOR), []);
  assert.equal(totalDoDetalhe([]), 0);
  assert.equal(contarDespesas([]), 0);
});
