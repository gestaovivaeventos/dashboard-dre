import assert from "node:assert/strict";
import { test } from "node:test";

import { canAccessPathByProfile, defaultLandingFor } from "@/lib/auth/access";
import { hasDpGrant, isDpPath } from "@/lib/auth/dp";

test("hasDpGrant: só a linha module='dp' com papel conhecido concede", () => {
  assert.equal(hasDpGrant(null), false);
  assert.equal(hasDpGrant([]), false);
  assert.equal(hasDpGrant([{ module: "vb", role: "gestor" }]), false);
  assert.equal(hasDpGrant([{ module: "dp", role: "gestor" }]), true);
});

test("hasDpGrant: papel desconhecido ou ausente falha fechado", () => {
  assert.equal(hasDpGrant([{ module: "dp", role: "admin" }]), false);
  assert.equal(hasDpGrant([{ module: "dp" }]), false);
});

test("isDpPath: raiz e subrotas, sem casar prefixo solto", () => {
  assert.equal(isDpPath("/dp"), true);
  assert.equal(isDpPath("/dp/colaboradores"), true);
  assert.equal(isDpPath("/dpx"), false);
});

// (pathname, profile, canFinanceiro, canCompras, canCase, canViagens,
//  canContratos, email, canVb, canCaixa, canOrcamento, canDp)
const args = (canDp: boolean) =>
  [true, true, true, false, true, "x@y.z", true, true, true, canDp] as const;

test("/dp: admin SEM concessão é negado (sem override)", () => {
  assert.equal(canAccessPathByProfile("/dp", "admin", ...args(false)), false);
  assert.equal(canAccessPathByProfile("/dp/folha", "admin", ...args(false)), false);
});

test("/dp: com concessão entra, em qualquer perfil fora da ilha", () => {
  assert.equal(canAccessPathByProfile("/dp", "admin", ...args(true)), true);
  assert.equal(canAccessPathByProfile("/dp", "franqueado", ...args(true)), true);
});

test("/dp: validador de contrato segue ilha mesmo com concessão", () => {
  assert.equal(canAccessPathByProfile("/dp", "validador_contrato", ...args(true)), false);
});

test("defaultLandingFor: só o DP já tira da tela de espera", () => {
  assert.equal(
    defaultLandingFor("solicitante", false, false, false, false, false, false, false, false, true),
    "/home",
  );
});
