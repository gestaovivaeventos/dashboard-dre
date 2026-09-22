// Papel no módulo Orçamento: quem entra, como, e quem NÃO entra.
//
// A regra é composta (concessão em user_module_roles × perfil do usuário) e
// vive em três lugares que têm de concordar — a sessão, o middleware e a root
// page. Este teste trava a regra em si, que é o que se muda por engano ao
// mexer nas permissões.

import test from "node:test";
import assert from "node:assert/strict";

import { canAccessOrcamento, isOrcamentoEligibleProfile, resolveOrcamentoPapel } from "./orcamento";

/** Linha de concessão como o join da sessão a devolve. */
const CONCEDIDO = [{ module: "orcamento", role: "auto" }];
const OUTRO_MODULO = [{ module: "caixa", role: "user" }];

test("admin entra sem a concessão", () => {
  assert.equal(resolveOrcamentoPapel("admin", null), "admin");
  assert.equal(resolveOrcamentoPapel("admin", OUTRO_MODULO), "admin");
});

test("o papel vem do perfil quando a concessão é 'auto'", () => {
  assert.equal(resolveOrcamentoPapel("diretor", CONCEDIDO), "validador");
  assert.equal(resolveOrcamentoPapel("gerente", CONCEDIDO), "construtor_amplo");
  assert.equal(resolveOrcamentoPapel("gerente_setor", CONCEDIDO), "construtor");
});

test("sem a concessão, perfil elegível NÃO entra", () => {
  for (const p of ["diretor", "gerente", "gerente_setor"] as const) {
    assert.equal(resolveOrcamentoPapel(p, null), null, p);
    assert.equal(resolveOrcamentoPapel(p, OUTRO_MODULO), null, `${p} com outro módulo`);
  }
});

test("perfil não elegível não entra nem com a concessão marcada", () => {
  // Marcar o módulo para um solicitante/CSC não deve dar acesso: a tela de
  // Usuários nem oferece o botão para eles (isOrcamentoEligibleProfile).
  for (const p of ["solicitante", "contas_a_pagar", "franqueado", "csc"] as const) {
    assert.equal(resolveOrcamentoPapel(p, CONCEDIDO), null, p);
    assert.equal(isOrcamentoEligibleProfile(p), false, p);
  }
});

test("validador_contrato é ilha: não entra nem com a concessão", () => {
  assert.equal(resolveOrcamentoPapel("validador_contrato", CONCEDIDO), null);
});

test("o papel explícito na linha sobrepõe o perfil", () => {
  // Escape hatch para quem precise de papel no Orçamento diferente do que tem
  // no Compras. A tela grava 'auto'; o override é manual no banco.
  assert.equal(
    resolveOrcamentoPapel("csc", [{ module: "orcamento", role: "construtor" }]),
    "construtor",
    "perfil não elegível entra com override",
  );
  assert.equal(
    resolveOrcamentoPapel("gerente", [{ module: "orcamento", role: "validador" }]),
    "validador",
    "override vence o perfil",
  );
  assert.equal(
    resolveOrcamentoPapel("validador_contrato", [{ module: "orcamento", role: "construtor" }]),
    null,
    "a ilha resiste ao override",
  );
});

test("canAccessOrcamento é o booleano do papel", () => {
  assert.equal(canAccessOrcamento("gerente", CONCEDIDO), true);
  assert.equal(canAccessOrcamento("gerente", null), false);
  assert.equal(canAccessOrcamento(null, CONCEDIDO), false);
});
