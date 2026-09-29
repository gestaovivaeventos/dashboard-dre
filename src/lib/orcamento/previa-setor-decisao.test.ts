// A atualização instantânea da prévia do setor ao decidir.
//
// Ela existe porque esperar o servidor fazia a tela parecer travada no gesto
// mais repetido da validação. Como é otimista, o risco é ficar INTERNAMENTE
// inconsistente — item atualizado e total não, ou contador contando o mesmo
// alvo três vezes. É isso que estes testes travam.

import test from "node:test";
import assert from "node:assert/strict";

import { aplicarDecisao } from "./previa-setor-decisao";
import type { PreviaSetorResumo } from "./actions/planejamento-categoria";

function item(alvoId: string, total: number, estado: "pendente" | "aprovado" | "reprovado" = "pendente") {
  return {
    nome: alvoId,
    detalhe: null,
    total,
    alvoTipo: "colaborador" as const,
    alvoId,
    setorId: "s1",
    estado,
    comentario: null,
  };
}

/** Mesmo colaborador em DUAS categorias — o caso do pessoal. */
function resumoBase(): PreviaSetorResumo {
  return {
    categorias: [
      {
        categoria: "Salários",
        metodo: "pessoal",
        metodoLabel: "Pessoal",
        total: 1000,
        totalAprovado: 0,
        atual: false,
        grupos: [{ nome: "Sem grupo", grupoId: null, total: 1000, totalAprovado: 0, itens: [item("ana", 1000)] }],
      },
      {
        categoria: "Encargos",
        metodo: "pessoal",
        metodoLabel: "Pessoal",
        total: 300,
        totalAprovado: 0,
        atual: false,
        grupos: [{ nome: "Sem grupo", grupoId: null, total: 300, totalAprovado: 0, itens: [item("ana", 300)] }],
      },
    ],
    total: 1300,
    totalAprovado: 0,
    contagem: { pendentes: 1, aprovados: 0, reprovados: 0, revisar: 0, total: 1 },
    podeValidar: true,
    pessoalIndisponivel: null,
  };
}

test("aprovar soma no grupo, na categoria e no total do setor", () => {
  const r = aplicarDecisao(resumoBase(), {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "aprovado",
    comentario: null,
  });
  assert.equal(r.categorias[0].grupos[0].totalAprovado, 1000);
  assert.equal(r.categorias[0].totalAprovado, 1000);
  assert.equal(r.totalAprovado, 1300); // as DUAS categorias
});

test("um ✓ marca o colaborador em TODAS as categorias dele", () => {
  // Salários, Encargos e Benefícios compartilham o mesmo alvo: aprovar a
  // pessoa aprova as três linhas, não uma.
  const r = aplicarDecisao(resumoBase(), {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "aprovado",
    comentario: null,
  });
  assert.equal(r.categorias[0].grupos[0].itens[0].estado, "aprovado");
  assert.equal(r.categorias[1].grupos[0].itens[0].estado, "aprovado");
});

test("o contador NÃO conta o mesmo alvo uma vez por categoria", () => {
  const r = aplicarDecisao(resumoBase(), {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "aprovado",
    comentario: null,
  });
  assert.deepEqual(r.contagem, {
    pendentes: 0,
    aprovados: 1,
    reprovados: 0,
    revisar: 0,
    total: 1,
  });
});

test("reprovar tira do total aprovado", () => {
  const partida = aplicarDecisao(resumoBase(), {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "aprovado",
    comentario: null,
  });
  const r = aplicarDecisao(partida, {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "reprovado",
    comentario: null,
  });
  assert.equal(r.totalAprovado, 0);
  assert.equal(r.contagem.reprovados, 1);
});

test("revisar guarda o comentário e fica FORA do número", () => {
  const r = aplicarDecisao(resumoBase(), {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "revisar",
    comentario: "trocar o cargo",
  });
  assert.equal(r.categorias[0].grupos[0].itens[0].comentario, "trocar o cargo");
  assert.equal(r.totalAprovado, 0);
});

test("alvo que não está na prévia não muda nada", () => {
  const antes = resumoBase();
  const r = aplicarDecisao(antes, {
    alvoTipo: "colaborador",
    alvoId: "fulano-que-nao-existe",
    estado: "aprovado",
    comentario: null,
  });
  assert.equal(r.totalAprovado, 0);
  assert.equal(r.contagem.pendentes, 1);
});

test("tipo diferente com MESMO id não é o mesmo alvo", () => {
  // `alvoId` da média é uma chave de texto e poderia coincidir com um uuid de
  // outro método; é o par (tipo, id) que identifica.
  const r = aplicarDecisao(resumoBase(), {
    alvoTipo: "planejamento_item",
    alvoId: "ana",
    estado: "aprovado",
    comentario: null,
  });
  assert.equal(r.totalAprovado, 0);
});

test("categoria sem itens conserva o total do servidor", () => {
  // A média sem linha gravada não tem de onde recalcular — zerá-la faria o
  // número sumir da tela a cada clique em outra categoria.
  const base = resumoBase();
  base.categorias.push({
    categoria: "Água",
    metodo: "media",
    metodoLabel: "Média",
    total: 500,
    totalAprovado: 500,
    atual: false,
    grupos: [],
  });
  const r = aplicarDecisao(base, {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "aprovado",
    comentario: null,
  });
  assert.equal(r.categorias[2].totalAprovado, 500);
  assert.equal(r.totalAprovado, 1800);
});

test("não muta o resumo recebido", () => {
  const antes = resumoBase();
  aplicarDecisao(antes, {
    alvoTipo: "colaborador",
    alvoId: "ana",
    estado: "aprovado",
    comentario: null,
  });
  assert.equal(antes.totalAprovado, 0);
  assert.equal(antes.categorias[0].grupos[0].itens[0].estado, "pendente");
});
