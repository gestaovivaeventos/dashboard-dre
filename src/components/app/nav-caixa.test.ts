// Visibilidade do item "Caixa Real" no menu: trava a REGRA (quem vê, quem não
// vê), que é o que se muda por engano ao mexer nas whitelists de perfil.
//
// O que ele NÃO cobre, e vale saber: o bug que segurou o lançamento do módulo
// foi de FIAÇÃO, não de regra — `canCaixa` chegava em NavLinks e era usado
// dentro de buildGroups, mas ficou de fora do objeto montado campo a campo que
// era passado para ele. Como as flags de módulo são opcionais em BuildInput, o
// TypeScript não reclamou e o item nunca aparecia, para ninguém. `visibleNavKeys`
// (testado aqui) recebe o objeto pronto, então passava verde o tempo todo.
// A defesa contra aquilo é estrutural: NavLinks agora repassa `props` inteiro.

import test from "node:test";
import assert from "node:assert/strict";

import { visibleNavKeys } from "./nav-links";
import { CAIXA_NAV_KEY_REAL } from "@/lib/auth/caixa";

const BASE = {
  dreRole: "admin" as const,
  segments: [],
  activeSegmentSlug: null,
};

function keys(over: Partial<Parameters<typeof visibleNavKeys>[0]>): string[] {
  return visibleNavKeys({ ...BASE, ...over });
}

test("com o módulo concedido, Caixa Real aparece", () => {
  assert.ok(keys({ canCaixa: true }).includes(CAIXA_NAV_KEY_REAL));
});

test("sem o módulo, Caixa Real não aparece nem para admin", () => {
  // O acesso de admin é resolvido na sessão (canCaixa = concessão || admin);
  // aqui o menu só obedece ao booleano que recebe.
  assert.ok(!keys({ canCaixa: false }).includes(CAIXA_NAV_KEY_REAL));
  assert.ok(!keys({}).includes(CAIXA_NAV_KEY_REAL), "omitir a flag não pode liberar");
});

test("o módulo é liberável em Visão Financeira e CSC", () => {
  // Esses perfis têm whitelist de menu própria (FRANQUEADO_NAV_KEYS /
  // CSC_NAV_KEYS) que esconderia o item; a regra do Caixa vem antes delas,
  // como a da Validação de Contratos.
  const franqueado = keys({ canCaixa: true, isFranqueado: true, dreRole: "gestor_unidade" });
  assert.ok(franqueado.includes(CAIXA_NAV_KEY_REAL));

  const csc = keys({ canCaixa: true, isCsc: true, dreRole: "gestor_unidade" });
  assert.ok(csc.includes(CAIXA_NAV_KEY_REAL));
});

test("validador de contrato é ilha: não vê o Caixa mesmo com a flag", () => {
  const somenteContratos = keys({ canCaixa: true, contractsOnly: true });
  assert.ok(!somenteContratos.includes(CAIXA_NAV_KEY_REAL));
});

test("o módulo não vaza para quem só tem Compras", () => {
  const compras = keys({
    dreRole: "gestor_unidade",
    ctrlRoles: ["solicitante"],
    canCaixa: false,
  });
  assert.ok(!compras.includes(CAIXA_NAV_KEY_REAL));
  assert.ok(compras.length > 0, "o usuário continua vendo os itens de Compras");
});
