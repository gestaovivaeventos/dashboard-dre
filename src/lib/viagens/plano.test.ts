// O plano do ano, recebido de uma vez.
//
// É aqui que a IA passa a valer de verdade — recebendo, não cotando. E é aqui que
// um defeito silencioso custa caro: linha que o casamento de nomes descarta sem
// avisar vira viagem que o gestor acha que orçou e não orçou.

import test from "node:test";
import assert from "node:assert/strict";

import { chaveNome, lerMes, parsePlanoViagens, resolverPlano } from "./plano";

const CADASTROS = {
  tipos: [
    { id: "t-cons", nome: "Consultoria" },
    { id: "t-trein", nome: "Treinamento" },
  ],
};

// ─── O parser ───────────────────────────────────────────────────────────────

test("aceita o array direto E embrulhado em { viagens: [...] }", () => {
  // O modelo faz os dois, e recusar um perderia o plano inteiro.
  const a = parsePlanoViagens([{ destino: "Curitiba" }]);
  const b = parsePlanoViagens({ viagens: [{ destino: "Curitiba" }] });
  assert.equal(a.length, 1);
  assert.deepEqual(a, b);
});

test("linha SEM destino é descartada — meia linha é pior que nenhuma", () => {
  const r = parsePlanoViagens([{ destino: "Recife" }, { mes: 5, pessoas: 2 }, { cidade: "Natal" }]);
  assert.deepEqual(r.map((l) => l.destino), ["Recife", "Natal"]);
});

test("o MÊS vem como número ou como nome", () => {
  // A IA escreve "maio" com a mesma frequência com que escreve 5.
  for (const [v, esperado] of [
    [5, 5],
    ["5", 5],
    ["maio", 5],
    ["Maio", 5],
    ["mai", 5],
    ["março", 3],
    ["marco", 3],
    ["dezembro", 12],
  ] as Array<[unknown, number]>) {
    assert.equal(lerMes(v), esperado, String(v));
  }
  for (const v of [0, 13, 3.5, "", "trimestre", null, undefined]) {
    assert.equal(lerMes(v), null, String(v));
  }
});

test("os sinônimos de campo que o modelo usa são aceitos", () => {
  const r = parsePlanoViagens([
    { cidade: "Recife", mes_ida: "maio", dias: 3, pessoas_por_quarto: 1, faixa: "Nordeste", hotel: "Capital" },
  ]);
  assert.equal(r[0].destino, "Recife");
  assert.equal(r[0].mes, 5);
  assert.equal(r[0].noites, 3);
  assert.equal(r[0].pessoasPorQuarto, 1);
});

test("faltando pessoas e noites, assume 1 — nunca zero", () => {
  // Zero pessoa zeraria a viagem com aparência de dado.
  const r = parsePlanoViagens([{ destino: "Vitória" }]);
  assert.equal(r[0].pessoas, 1);
  assert.equal(r[0].noites, 1);
  assert.equal(r[0].pessoasPorQuarto, null, "ausente é diferente de 1");
});

test("JSON quebrado ou vazio não explode", () => {
  for (const v of [null, undefined, "texto", 7, {}, { viagens: "x" }]) {
    assert.deepEqual(parsePlanoViagens(v), []);
  }
});

// ─── O casamento com os cadastros ───────────────────────────────────────────

test("casa o tipo por nome, ignorando acento e caixa", () => {
  const r = resolverPlano(
    parsePlanoViagens([
      { destino: "Recife", mes: 5, noites: 3, pessoas: 2, tipo: "TREINAMENTO" },
    ]),
    CADASTROS,
  );
  assert.equal(r.linhas[0].tipoId, "t-trein");
  assert.deepEqual(r.avisos, []);
});

test("casa por CONTINÊNCIA depois do exato", () => {
  // A IA descreve o tipo em vez de copiá-lo ("Treinamento de vendas" para
  // "Treinamento"); recusar perderia o tipo e a linha cairia no padrão, calada.
  const r = resolverPlano(
    parsePlanoViagens([
      { destino: "Natal", mes: 6, noites: 2, pessoas: 1, tipo: "Treinamento de vendas" },
    ]),
    CADASTROS,
  );
  assert.equal(r.linhas[0].tipoId, "t-trein");
});

test("tipo inexistente cai no PADRÃO e AVISA", () => {
  // A linha aparece preenchida para o gestor corrigir, em vez de a leitura
  // descartar metade do plano sem ele saber o que faltou.
  const r = resolverPlano(
    parsePlanoViagens([{ destino: "Goiânia", mes: 4, noites: 1, pessoas: 1, tipo: "Auditoria" }]),
    CADASTROS,
  );
  assert.equal(r.linhas[0].tipoId, "t-cons", "o primeiro do cadastro");
  assert.match(r.avisos.join(" | "), /Tipo "Auditoria" não existe/);
});

test("mês ausente vira AVISO, não erro — a linha fica rascunho", () => {
  const r = resolverPlano(
    parsePlanoViagens([{ destino: "Salvador", noites: 2, pessoas: 2 }]),
    CADASTROS,
  );
  assert.equal(r.linhas[0].mesIda, null);
  assert.match(r.avisos.join(" | "), /"Salvador" veio sem mês/);
});

test("o mesmo aviso não se repete em 50 linhas", () => {
  // Cinquenta vezes "Tipo X não existe" tornaria a lista ilegível.
  const brutas = parsePlanoViagens(
    Array.from({ length: 20 }, (_, i) => ({ destino: `Cidade ${i}`, mes: 5, tipo: "Auditoria" })),
  );
  const r = resolverPlano(brutas, CADASTROS);
  assert.equal(r.linhas.length, 20);
  assert.equal(r.avisos.filter((a) => a.includes("Auditoria")).length, 1);
});

test("sem tipo cadastrado, avisa em vez de inventar id", () => {
  const r = resolverPlano(parsePlanoViagens([{ destino: "Recife", mes: 5 }]), { tipos: [] });
  assert.equal(r.linhas[0].tipoId, "");
  assert.match(r.avisos.join(" | "), /Não há tipo de viagem cadastrado/);
});

test("chaveNome normaliza acento, caixa e espaço", () => {
  assert.equal(chaveNome("  Capital   NORDESTE "), "capital nordeste");
  assert.equal(chaveNome("Florianópolis"), "florianopolis");
});

test("cidades de uma MESMA ida viram duas linhas E um aviso", () => {
  // Descartar a 2ª cidade seria pior (o gestor acharia que orçou e não orçou);
  // somar as duas numa linha a esconderia da conferência. Então: duas linhas, e
  // o aviso diz que a passagem está contada duas vezes.
  const r = resolverPlano(
    parsePlanoViagens([
      { destino: "Curitiba", mes: 3, noites: 2, pessoas: 3, junto: "sul" },
      { destino: "Florianópolis", mes: 3, noites: 2, pessoas: 3, junto: "sul" },
      { destino: "Recife", mes: 5, noites: 3, pessoas: 2 },
    ]),
    CADASTROS,
  );
  assert.equal(r.linhas.length, 3);
  const aviso = r.avisos.find((a) => a.includes("uma ida só"));
  assert.ok(aviso, "o aviso tem de existir");
  assert.match(aviso!, /Curitiba e Florianópolis/);
  assert.match(aviso!, /passagem está contada em cada uma/);
});

test("etiqueta 'junto' com uma cidade só NÃO vira aviso", () => {
  const r = resolverPlano(
    parsePlanoViagens([{ destino: "Recife", mes: 5, noites: 2, pessoas: 2, junto: "nordeste" }]),
    CADASTROS,
  );
  assert.deepEqual(r.avisos, []);
});
