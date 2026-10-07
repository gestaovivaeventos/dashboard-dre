import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CTRL_ORG_ROLE_VALUES,
  ctrlRolesFromProfile,
  isCtrlOrgRole,
  resolveCtrlRolesForOrg,
} from "./roles";
import type { CtrlRole, UserProfileType } from "@/lib/supabase/types";

// ─── ctrlRolesFromProfile: trava de DIFF-ZERO ────────────────────────────────
// Deve reproduzir EXATAMENTE o switch que era a cauda de deriveCtrlRoles
// (session.ts). Qualquer divergência aqui muda a permissão de todo mundo.
const EXPECTED: Record<UserProfileType, CtrlRole[]> = {
  admin: ["admin"],
  contas_a_pagar: ["contas_a_pagar", "csc", "aprovacao_fornecedor"],
  diretor: ["diretor"],
  gerente: ["gerente"],
  gerente_setor: ["gerente"],
  solicitante: ["solicitante"],
  // Perfis sem Compras: o switch devolve [] (os early-returns de deriveCtrlRoles
  // tratam esses casos antes; a função pura, chamada direto, também dá []).
  franqueado: [],
  csc: [],
  validador_contrato: [],
};

test("ctrlRolesFromProfile: mapeia cada perfil como o switch de hoje", () => {
  for (const [profile, roles] of Object.entries(EXPECTED) as [UserProfileType, CtrlRole[]][]) {
    assert.deepEqual(ctrlRolesFromProfile(profile), roles, profile);
  }
});

test("gerente e gerente_setor caem no MESMO CtrlRole", () => {
  assert.deepEqual(ctrlRolesFromProfile("gerente"), ctrlRolesFromProfile("gerente_setor"));
});

// ─── isCtrlOrgRole: vocabulário do override (== CHECK do banco) ──────────────
test("isCtrlOrgRole aceita só os 5 papéis de empresa; recusa admin e lixo", () => {
  for (const r of CTRL_ORG_ROLE_VALUES) assert.equal(isCtrlOrgRole(r), true, r);
  assert.equal(isCtrlOrgRole("admin"), false); // admin é GLOBAL, nunca por empresa
  assert.equal(isCtrlOrgRole("franqueado"), false);
  assert.equal(isCtrlOrgRole(null), false);
  assert.equal(isCtrlOrgRole(""), false);
  assert.equal(isCtrlOrgRole(undefined), false);
});

// ─── resolveCtrlRolesForOrg: a decisão override ?? global ────────────────────
test("sem override (null) devolve o papel GLOBAL inalterado — diff-zero", () => {
  const global: CtrlRole[] = ["contas_a_pagar", "csc", "aprovacao_fornecedor"];
  const out = resolveCtrlRolesForOrg("contas_a_pagar", global, null);
  assert.deepEqual(out, global);
  // Mesma referência/valor: a resolução não reescreve nada quando não há override.
  assert.deepEqual(resolveCtrlRolesForOrg("solicitante", ["solicitante"], null), ["solicitante"]);
});

test("admin IGNORA o override — segue global em qualquer empresa", () => {
  // Mesmo que (hipoteticamente) houvesse um override gravado, admin não estreita.
  assert.deepEqual(resolveCtrlRolesForOrg("admin", ["admin"], "solicitante"), ["admin"]);
});

test("override estreita o papel na empresa ativa", () => {
  // Perfil global contas_a_pagar, mas Solicitante nesta empresa.
  assert.deepEqual(
    resolveCtrlRolesForOrg("contas_a_pagar", ["contas_a_pagar", "csc", "aprovacao_fornecedor"], "solicitante"),
    ["solicitante"],
  );
  // Override para gerente usa o mesmo mapeamento do perfil.
  assert.deepEqual(
    resolveCtrlRolesForOrg("diretor", ["diretor"], "gerente"),
    ["gerente"],
  );
});

test("o papel por empresa NUNCA é vazio para quem tem Compras", () => {
  // Garante que o item do módulo no switcher (que exige length > 0) nunca some.
  for (const r of CTRL_ORG_ROLE_VALUES) {
    assert.ok(resolveCtrlRolesForOrg("solicitante", ["solicitante"], r).length > 0, r);
  }
});
