// Quem edita qual método.
//
// A regra vale em dois lugares — as actions de Média e Valor fixo (a
// autorização de verdade) e as telas, que travam os campos. Se os dois
// divergirem, a tela deixa digitar o que o servidor recusa, que é a pior
// combinação possível para quem está preenchendo orçamento.

import test from "node:test";
import assert from "node:assert/strict";

import {
  METODOS,
  METODOS_EM_VALIDACAO,
  isOrcamentoMetodo,
  metodoVisivelPara,
  podeEditarMetodo,
} from "./metodos";
import { WORKSPACE_TABS } from "./workspace-tabs";
import { isMetodoFinalizavel } from "./finalizacao";
import { ROTULO_POR_METODO, sufixo } from "./previa-setor-contagem";

test("gerente e gerente sócio NÃO editam média nem valor fixo", () => {
  // Regra de 29/09/2026: os dois métodos partem de um número que o gestor não
  // define (realizado do ano anterior, contrato) e são da administração.
  for (const papel of ["construtor", "construtor_amplo"] as const) {
    assert.equal(podeEditarMetodo(papel, "media"), false, papel);
    assert.equal(podeEditarMetodo(papel, "valor_fixo"), false, papel);
  }
});

test("gerente e gerente sócio CONSTROEM pessoal e planejamento", () => {
  for (const papel of ["construtor", "construtor_amplo"] as const) {
    assert.equal(podeEditarMetodo(papel, "pessoal"), true, papel);
    assert.equal(podeEditarMetodo(papel, "planejamento_socios"), true, papel);
  }
});

test("admin e diretoria seguem editando tudo", () => {
  for (const papel of ["admin", "validador"] as const) {
    for (const metodo of ["media", "valor_fixo", "pessoal", "planejamento_socios"] as const) {
      assert.equal(podeEditarMetodo(papel, metodo), true, `${papel}/${metodo}`);
    }
  }
});

test("a regra é só do PAPEL — o setor continua valendo por cima", () => {
  // `podeEditarMetodo` libera o método; `podeEscreverNoSetor` (auth.ts) diz se
  // a LINHA daquele setor é dele. Um não substitui o outro.
  assert.equal(podeEditarMetodo("construtor", "pessoal"), true);
});

// ─── Métodos em prova ────────────────────────────────────────────────────────

test("o Planejamento dos gestores foi LIBERADO para não-admin", () => {
  // Era o que impedia o Gerente Sócio de ver o método — justamente o que foi
  // feito para ele preencher. Saiu em 29/09/2026.
  assert.equal(METODOS_EM_VALIDACAO.has("planejamento_socios"), false);
  assert.equal(metodoVisivelPara("planejamento_socios", false), true);
});

test("o mecanismo de 'em validação' continua de pé para o próximo método", () => {
  // Vazio hoje, mas a função tem de continuar respondendo à chave.
  assert.equal(metodoVisivelPara("media", true), true);
  assert.equal(metodoVisivelPara("media", false), true);
});

// ─── A fiação do método ──────────────────────────────────────────────────────
// O slug da aba do workspace É a chave do método (o hub linka por
// `workspaceTabHref(m.key)`), e a Prévia monta o `href` da fonte do mesmo jeito.
// Um método sem aba vira caixa que leva a 404; uma aba sem método vira tela que
// o hub nunca oferece. Nenhum dos dois quebra o build — este teste é quem cobra.

test("todo método NÃO-VE tem aba no workspace, e toda aba é um método", () => {
  const slugs = new Set(WORKSPACE_TABS.map((t) => t.slug));
  for (const m of METODOS.filter((x) => !x.ve)) {
    assert.ok(slugs.has(m.key), `método ${m.key} sem aba no workspace`);
  }
  for (const t of WORKSPACE_TABS) {
    assert.ok(isOrcamentoMetodo(t.slug), `aba ${t.slug} não é um método`);
  }
});

test("os métodos de VE seguem SEM tela, de propósito", () => {
  // Eles existem como chave atribuível a uma categoria, mas não têm tela: marcar
  // uma categoria com um deles hoje a deixa sem caminho de preenchimento. Viagens
  // saiu desse grupo em 01/10/2026; marketing e endomarketing continuam nele.
  const slugs = new Set(WORKSPACE_TABS.map((t) => t.slug));
  for (const m of METODOS.filter((x) => x.ve)) {
    assert.equal(slugs.has(m.key), false, m.key);
  }
  assert.deepEqual(
    METODOS.filter((x) => x.ve).map((x) => x.key),
    ["marketing_ve", "endomarketing_ve"],
  );
});

test("viagens é um método de verdade: finalizável e com rótulo de contagem", () => {
  // Os dois pontos que fazem um método "existir" para a diretoria: a fatia que o
  // admin fecha e o nome que a faixa da prévia do setor usa para contar.
  assert.ok(isMetodoFinalizavel("viagens"));
  assert.equal(ROTULO_POR_METODO.viagens?.plural, "viagens");
  assert.equal(sufixo(ROTULO_POR_METODO.viagens), "as", "viagens aprovadAS");
});
