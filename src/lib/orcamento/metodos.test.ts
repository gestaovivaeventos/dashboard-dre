// Quem edita qual método.
//
// A regra vale em dois lugares — as actions de Média e Valor fixo (a
// autorização de verdade) e as telas, que travam os campos. Se os dois
// divergirem, a tela deixa digitar o que o servidor recusa, que é a pior
// combinação possível para quem está preenchendo orçamento.

import test from "node:test";
import assert from "node:assert/strict";

import { METODOS_EM_VALIDACAO, metodoVisivelPara, podeEditarMetodo } from "./metodos";

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
