import assert from "node:assert/strict";
import { test } from "node:test";

import { canAccessPathByProfile, defaultLandingFor } from "@/lib/auth/access";

// (pathname, profile, canFinanceiro, canCompras, canCase, canViagens, canContratos, email, canVb)

test("/vb: admin SEM concessão é negado (sem override)", () => {
  assert.equal(
    canAccessPathByProfile("/vb", "admin", true, true, true, false, true, "x@y.z", false),
    false,
  );
});

test("/vb: admin COM concessão entra", () => {
  assert.equal(
    canAccessPathByProfile("/vb/importar", "admin", true, true, false, false, false, null, true),
    true,
  );
});

test("/vb: franqueado com concessão entra (gate vem antes da whitelist)", () => {
  assert.equal(
    canAccessPathByProfile("/vb", "franqueado", true, false, false, false, false, null, true),
    true,
  );
});

test("/vb: perfil de Compras sem concessão é negado", () => {
  assert.equal(
    canAccessPathByProfile("/vb", "gerente", false, true, false, false, false, null, false),
    false,
  );
});

test("/vb não vaza para prefixos parecidos", () => {
  // /vbx não existe; cai no default permissivo de rota não mapeada para admin.
  assert.equal(canAccessPathByProfile("/vbx", "admin", true, true, false, false, false, null, false), true);
});

test("defaultLandingFor: quem só tem o VB cai na home, não em /pendente", () => {
  assert.equal(defaultLandingFor("solicitante", false, false, false, false, false, true), "/home");
  assert.equal(defaultLandingFor("solicitante", false, false, false, false, false, false), "/pendente");
});
