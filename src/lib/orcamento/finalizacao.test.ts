// A identidade da fatia finalizada.
//
// Dois erros aqui seriam graves e silenciosos: duas fatias diferentes gerando a
// MESMA source (uma sobrescreveria a publicação da outra no Budget) e o setor
// nulo colidindo com um setor de verdade (a empresa sem "orçar por setor" e uma
// com setor cairiam na mesma trava).

import test from "node:test";
import assert from "node:assert/strict";

import {
  CATEGORIA_METODO_INTEIRO,
  TRAVA_FINALIZADO,
  chaveFinalizacao,
  contarFinalizadasPorMetodo,
  finalizacaoDe,
  indexarFinalizacoes,
  isMetodoFinalizavel,
  sourceFinalizacao,
  travaDaFinalizacao,
  type Finalizacao,
} from "./finalizacao";

const alvo = (metodo: "media" | "pessoal" | "valor_fixo" | "planejamento_socios", cat: string, setor: string | null) =>
  ({ metodo, categoryCode: cat, setorId: setor }) as const;

function fin(
  metodo: "media" | "pessoal" | "valor_fixo" | "planejamento_socios",
  cat: string,
  setor: string | null,
): Finalizacao {
  return {
    id: `${metodo}-${cat}-${setor ?? "x"}`,
    metodo,
    categoryCode: cat,
    setorId: setor,
    totalPublicado: 1000,
    itensPublicados: 3,
    itensFora: 1,
    finalizadoEm: "2026-09-30T12:00:00Z",
  };
}

test("setor NULO não colide com setor de verdade", () => {
  // Empresa sem "orçar por setor" grava setor nulo; confundir os dois travaria
  // a fatia errada.
  assert.notEqual(
    chaveFinalizacao(alvo("media", "3.01", null)),
    chaveFinalizacao(alvo("media", "3.01", "s1")),
  );
  assert.notEqual(
    sourceFinalizacao(alvo("media", "3.01", null)),
    sourceFinalizacao(alvo("media", "3.01", "s1")),
  );
});

test("fatias diferentes NUNCA compartilham source", () => {
  // Source repetida faria uma publicação sobrescrever a outra no Budget.
  const alvos = [
    alvo("media", "3.01", "s1"),
    alvo("media", "3.01", "s2"),
    alvo("media", "3.02", "s1"),
    alvo("valor_fixo", "3.01", "s1"),
    alvo("planejamento_socios", "3.01", "s1"),
    alvo("pessoal", CATEGORIA_METODO_INTEIRO, "s1"),
    alvo("pessoal", CATEGORIA_METODO_INTEIRO, "s2"),
    alvo("pessoal", CATEGORIA_METODO_INTEIRO, null),
  ];
  const sources = alvos.map(sourceFinalizacao);
  assert.equal(new Set(sources).size, alvos.length, "houve source repetida");
  const chaves = alvos.map(chaveFinalizacao);
  assert.equal(new Set(chaves).size, alvos.length, "houve chave repetida");
});

test("a source não se confunde com as origens antigas do Budget", () => {
  // 'orcamento' e 'pessoal' são as sources do publicador antigo; colidir faria
  // o delete de uma apagar a outra.
  for (const a of [alvo("media", "3.01", "s1"), alvo("pessoal", "", null)]) {
    const s = sourceFinalizacao(a);
    assert.notEqual(s, "orcamento");
    assert.notEqual(s, "pessoal");
    assert.ok(s.startsWith("orc:"));
  }
});

test("a trava vale para TODO MUNDO, inclusive admin", () => {
  // Diferente de `travaDaValidacao`, onde admin e diretoria sempre passam:
  // aqui quem quer editar reabre antes, e o fecho fica visível.
  const indice = indexarFinalizacoes([fin("media", "3.01", "s1")]);
  assert.equal(travaDaFinalizacao(indice, alvo("media", "3.01", "s1")), TRAVA_FINALIZADO);
});

test("a trava é SÓ da fatia fechada — o resto segue editável", () => {
  const indice = indexarFinalizacoes([fin("media", "3.01", "s1")]);
  assert.equal(travaDaFinalizacao(indice, alvo("media", "3.02", "s1")), null, "outra categoria");
  assert.equal(travaDaFinalizacao(indice, alvo("media", "3.01", "s2")), null, "outro setor");
  assert.equal(travaDaFinalizacao(indice, alvo("valor_fixo", "3.01", "s1")), null, "outro método");
  assert.equal(travaDaFinalizacao(indice, alvo("media", "3.01", null)), null, "sem setor");
});

test("índice vazio não trava nada (migration pendente)", () => {
  const vazio = indexarFinalizacoes(null);
  assert.equal(travaDaFinalizacao(vazio, alvo("media", "3.01", "s1")), null);
  assert.equal(travaDaFinalizacao(indexarFinalizacoes([]), alvo("pessoal", "", null)), null);
});

test("finalizacaoDe devolve o retrato do que foi publicado", () => {
  const indice = indexarFinalizacoes([fin("pessoal", "", null)]);
  const f = finalizacaoDe(indice, alvo("pessoal", "", null));
  assert.equal(f?.totalPublicado, 1000);
  assert.equal(f?.itensFora, 1);
  assert.equal(finalizacaoDe(indice, alvo("pessoal", "", "s1")), null);
});

test("contagem por método para o hub", () => {
  assert.deepEqual(
    contarFinalizadasPorMetodo([
      fin("media", "3.01", "s1"),
      fin("media", "3.02", "s1"),
      fin("pessoal", "", "s1"),
    ]),
    { media: 2, pessoal: 1 },
  );
  assert.deepEqual(contarFinalizadasPorMetodo([]), {});
});

test("só os quatro métodos são finalizáveis", () => {
  for (const m of ["pessoal", "media", "valor_fixo", "planejamento_socios"]) {
    assert.ok(isMetodoFinalizavel(m), m);
  }
  for (const m of ["viagens_ve", "marketing_ve", "", null, 7]) {
    assert.equal(isMetodoFinalizavel(m), false, String(m));
  }
});
