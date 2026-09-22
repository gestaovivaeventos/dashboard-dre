// Visibilidade do grupo ORÇAMENTO no menu.
//
// Existe pelo mesmo motivo do nav-caixa.test.ts: o módulo Caixa nasceu
// invisível porque a flag chegava em NavLinks mas ficava de fora do objeto
// montado campo a campo no app-shell — e, como as flags são opcionais em
// BuildInput, nada reclamou. Aqui o risco é maior ainda: os itens do Orçamento
// eram gateados por `dreRoles: ["admin"]` e passaram a depender de
// `orcamentoPapel`, então uma regressão devolve o módulo a admin-only sem erro
// nenhum.

import test from "node:test";
import assert from "node:assert/strict";

import { visibleNavKeys } from "./nav-links";
import {
  ORCAMENTO_NAV_KEY_CONFIG,
  ORCAMENTO_NAV_KEY_PAINEL,
} from "@/lib/auth/orcamento";

const BASE = {
  dreRole: null,
  segments: [],
  activeSegmentSlug: null,
};

function keys(over: Partial<Parameters<typeof visibleNavKeys>[0]>): string[] {
  return visibleNavKeys({ ...BASE, ...over });
}

test("construtor vê o Painel do Orçamento mesmo SEM o módulo Financeiro", () => {
  // O caso central da fase A: o gerente que monta o orçamento pode não ter o
  // Financeiro (dreRole null). Enquanto os itens dependiam de dreRoles, ele
  // não via nada.
  const k = keys({ orcamentoPapel: "construtor" });
  assert.ok(k.includes(ORCAMENTO_NAV_KEY_PAINEL));
});

test("Configurações gerais é só do admin do módulo", () => {
  for (const papel of ["construtor", "construtor_amplo", "validador"] as const) {
    const k = keys({ orcamentoPapel: papel });
    assert.ok(k.includes(ORCAMENTO_NAV_KEY_PAINEL), `${papel} vê o painel`);
    assert.ok(
      !k.includes(ORCAMENTO_NAV_KEY_CONFIG),
      `${papel} NÃO vê Configurações gerais`,
    );
  }
  const admin = keys({ orcamentoPapel: "admin", dreRole: "admin" });
  assert.ok(admin.includes(ORCAMENTO_NAV_KEY_CONFIG));
});

test("sem papel, o grupo não aparece — nem para admin do Financeiro", () => {
  // O acesso é resolvido na sessão (concessão || admin); o menu só obedece ao
  // que recebe. Admin do DRE sem o papel do módulo não deve ver o grupo.
  assert.ok(!keys({ dreRole: "admin" }).includes(ORCAMENTO_NAV_KEY_PAINEL));
  assert.ok(
    !keys({ orcamentoPapel: null, dreRole: "admin" }).includes(ORCAMENTO_NAV_KEY_PAINEL),
    "papel nulo explícito também não libera",
  );
});

test("omitir a flag não pode liberar o módulo", () => {
  // A armadilha da fiação: flag esquecida num objeto montado campo a campo.
  // Se um dia isto passar a incluir o item, é porque alguém trocou o gate por
  // um default permissivo.
  assert.ok(!keys({}).includes(ORCAMENTO_NAV_KEY_PAINEL));
});

test("o módulo é liberável em Visão Financeira e CSC", () => {
  // Esses perfis têm whitelist de menu própria, que esconderia o item; a regra
  // do Orçamento vem antes dela, como a do Contratos e a do Caixa.
  const franqueado = keys({
    orcamentoPapel: "construtor",
    isFranqueado: true,
    dreRole: "gestor_unidade",
  });
  assert.ok(franqueado.includes(ORCAMENTO_NAV_KEY_PAINEL));

  const csc = keys({ orcamentoPapel: "construtor", isCsc: true, dreRole: "gestor_unidade" });
  assert.ok(csc.includes(ORCAMENTO_NAV_KEY_PAINEL));
});

test("validador de contrato é ilha: não vê o Orçamento", () => {
  const ilha = keys({ orcamentoPapel: "admin", contractsOnly: true });
  assert.ok(!ilha.includes(ORCAMENTO_NAV_KEY_PAINEL));
});
