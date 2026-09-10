import assert from "node:assert/strict";
import { test } from "node:test";

import { hasVbGrant, isVbPath, resolveVbRole } from "@/lib/auth/vb";

test("resolveVbRole: sem linha → null", () => {
  assert.equal(resolveVbRole([]), null);
  assert.equal(resolveVbRole(null), null);
});

test("resolveVbRole: ignora outros módulos", () => {
  assert.equal(resolveVbRole([{ module: "ctrl", role: "gestor" }, { module: "contratos", role: "validador" }]), null);
});

test("resolveVbRole: credor", () => {
  assert.equal(resolveVbRole([{ module: "vb", role: "credor" }]), "credor");
});

test("resolveVbRole: gestor prevalece sobre credor", () => {
  assert.equal(resolveVbRole([{ module: "vb", role: "credor" }, { module: "vb", role: "gestor" }]), "gestor");
});

test("resolveVbRole: papel desconhecido não concede nada", () => {
  assert.equal(resolveVbRole([{ module: "vb", role: "admin" }]), null);
});

test("hasVbGrant: basta o módulo (select enxuto do middleware)", () => {
  assert.equal(hasVbGrant([{ module: "vb" }]), true);
  assert.equal(hasVbGrant([{ module: "ctrl" }]), false);
  assert.equal(hasVbGrant(undefined), false);
});

test("isVbPath", () => {
  assert.equal(isVbPath("/vb"), true);
  assert.equal(isVbPath("/vb/importar/abc"), true);
  assert.equal(isVbPath("/vbx"), false);
  assert.equal(isVbPath("/ctrl/vb"), false);
});
