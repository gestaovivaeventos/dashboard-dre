import assert from "node:assert/strict";
import { test } from "node:test";

import { matchExtApiClient, type ExtApiClient } from "./clients";
import { buildExtCtrlUser, escapeIlike, type ExtUserRow } from "./identity";

const CLIENTS: ExtApiClient[] = [
  { id: "hubfeat", keyEnv: "HUBFEAT_API_KEY", orgSlug: "feat-producoes" },
  { id: "outro", keyEnv: "OUTRO_API_KEY", orgSlug: "viva" },
];
const FEAT = { id: "org-feat", nome: "Feat Produções", slug: "feat-producoes" };

function user(over: Partial<ExtUserRow> = {}): ExtUserRow {
  return {
    id: "u1",
    email: "ana@feat.com",
    name: "Ana",
    role: null,
    profile: "solicitante",
    active: true,
    can_compras: true,
    user_module_roles: [],
    user_sectors: [{ sector_id: "s1" }],
    ...over,
  };
}

test("matchExtApiClient: chave certa devolve o cliente dono dela", () => {
  const env = { HUBFEAT_API_KEY: "abc", OUTRO_API_KEY: "xyz" };
  assert.equal(matchExtApiClient("Bearer abc", env, CLIENTS)?.id, "hubfeat");
  assert.equal(matchExtApiClient("Bearer xyz", env, CLIENTS)?.id, "outro");
});

test("matchExtApiClient: falha fechado", () => {
  assert.equal(matchExtApiClient(null, { HUBFEAT_API_KEY: "abc" }, CLIENTS), null);
  assert.equal(matchExtApiClient("Bearer errada", { HUBFEAT_API_KEY: "abc" }, CLIENTS), null);
  assert.equal(matchExtApiClient("abc", { HUBFEAT_API_KEY: "abc" }, CLIENTS), null);
  // Variável ausente ou vazia nunca autoriza, nem com "Bearer " vazio.
  assert.equal(matchExtApiClient("Bearer ", {}, CLIENTS), null);
  assert.equal(matchExtApiClient("Bearer ", { HUBFEAT_API_KEY: "" }, CLIENTS), null);
  assert.equal(matchExtApiClient("Bearer undefined", {}, CLIENTS), null);
});

test("escapeIlike: _ e % do e-mail não viram curinga", () => {
  assert.equal(escapeIlike("ana_maria@feat.com"), "ana\\_maria@feat.com");
  assert.equal(escapeIlike("100%@x"), "100\\%@x");
});

test("buildExtCtrlUser: solicitante concedido na Feat age só na Feat", () => {
  const r = buildExtCtrlUser("ana@feat.com", user(), FEAT, { role: null });
  assert.ok(r.ok);
  assert.deepEqual(r.ctx.ctrlRoles, ["solicitante"]);
  assert.equal(r.ctx.orgId, "org-feat");
  assert.deepEqual(r.ctx.orgIds, ["org-feat"]);
  assert.deepEqual(r.ctx.sectorIds, ["s1"]);
});

test("buildExtCtrlUser: recusa quem não existe, está inativo ou sem concessão", () => {
  assert.equal(buildExtCtrlUser("x@y", null, FEAT, { role: null }).ok, false);
  assert.equal(buildExtCtrlUser("x@y", user({ active: false }), FEAT, { role: null }).ok, false);
  assert.equal(buildExtCtrlUser("x@y", user(), FEAT, undefined).ok, false);
});

test("buildExtCtrlUser: admin também precisa da concessão explícita na Feat", () => {
  assert.equal(buildExtCtrlUser("x@y", user({ profile: "admin" }), FEAT, undefined).ok, false);
  const r = buildExtCtrlUser("x@y", user({ profile: "admin" }), FEAT, { role: null });
  assert.ok(r.ok);
  assert.deepEqual(r.ctx.ctrlRoles, ["admin"]);
});

test("buildExtCtrlUser: papel por empresa estreita o global", () => {
  const r = buildExtCtrlUser("x@y", user({ profile: "diretor" }), FEAT, { role: "solicitante" });
  assert.ok(r.ok);
  assert.deepEqual(r.ctx.ctrlRoles, ["solicitante"]);
});

test("buildExtCtrlUser: sem o módulo Compras não age", () => {
  assert.equal(buildExtCtrlUser("x@y", user({ can_compras: false }), FEAT, { role: null }).ok, false);
  assert.equal(buildExtCtrlUser("x@y", user({ profile: "franqueado" }), FEAT, { role: null }).ok, false);
});

// ─── Requisições ────────────────────────────────────────────────────────────

import { etapaDaRequisicao, parseCreateRequest, respostaPendente, safeFileName } from "./requisicoes";

const U1 = "c0daadd2-f3b4-4be0-8df6-7c7398ec79a9";
const U2 = "11111111-2222-3333-4444-555555555555";

function ctxDe(over: Partial<{ id: string; ctrlRoles: string[]; sectorIds: string[] }> = {}) {
  const r = buildExtCtrlUser("ana@feat.com", user(), FEAT, { role: null });
  assert.ok(r.ok);
  return { ...r.ctx, id: U1, ...over } as typeof r.ctx;
}

const BASE = {
  title: "Contador",
  sector_id: "s1",
  amount: 1500,
  reference_month: 10,
  reference_year: 2026,
  payment_method: "pix",
  expense_type_id: "t1",
  supplier_id: "f1",
  supplier_issues_invoice: "nao",
};

test("parseCreateRequest: corpo válido passa e campos desconhecidos caem", () => {
  const r = parseCreateRequest({ ...BASE, created_by: "outro", org_id: "viva" }, ctxDe());
  assert.ok(r.ok);
  assert.equal("created_by" in r.input, false);
  assert.equal("org_id" in r.input, false);
});

test("parseCreateRequest: despesa de evento e rateio são recusados", () => {
  assert.equal(parseCreateRequest({ ...BASE, event_id: "e1" }, ctxDe()).ok, false);
  assert.equal(parseCreateRequest({ ...BASE, is_rateio: true }, ctxDe()).ok, false);
  assert.ok(parseCreateRequest({ ...BASE, event_id: null }, ctxDe()).ok);
});

test("parseCreateRequest: setor precisa ser vinculado (admin passa)", () => {
  assert.equal(parseCreateRequest({ ...BASE, sector_id: "s2" }, ctxDe()).ok, false);
  assert.ok(parseCreateRequest({ ...BASE, sector_id: "s2" }, ctxDe({ ctrlRoles: ["admin"] })).ok);
});

test("parseCreateRequest: anexo só do próprio usuário", () => {
  const own = `${U1}/1791491752532-nota.pdf`;
  assert.ok(parseCreateRequest({ ...BASE, attachment_path: own }, ctxDe()).ok);
  assert.equal(parseCreateRequest({ ...BASE, attachment_path: `${U2}/1791491752532-nota.pdf` }, ctxDe()).ok, false);
  assert.equal(parseCreateRequest({ ...BASE, extra_attachment_paths: [own, `${U2}/1791491752532-b`] }, ctxDe()).ok, false);
  // Começar com o próprio id não basta: sem travessia nem formato livre.
  for (const p of [`${U1}/../${U2}/1791491752532-x.pdf`, `${U1}/1791491752532-..pdf`, `${U1}//x`, `${U1}/nota.pdf`, `/${own}`]) {
    assert.equal(parseCreateRequest({ ...BASE, invoice_attachment_path: p }, ctxDe()).ok, false, p);
  }
});

test("parseCreateRequest: tipos e forma de pagamento", () => {
  assert.equal(parseCreateRequest({ ...BASE, amount: "1500" }, ctxDe()).ok, false);
  assert.equal(parseCreateRequest({ ...BASE, payment_method: "cheque" }, ctxDe()).ok, false);
  assert.equal(parseCreateRequest({ ...BASE, title: "  " }, ctxDe()).ok, false);
  assert.equal(parseCreateRequest(null, ctxDe()).ok, false);
});

test("etapaDaRequisicao: pago vence o status", () => {
  assert.equal(etapaDaRequisicao({ status: "agendado", omie_paid_at: "2026-10-01", omie_launch_status: "lancado" }), "paga");
  assert.equal(etapaDaRequisicao({ status: "pendente_diretor", omie_paid_at: null, omie_launch_status: null }), "em_aprovacao");
  assert.equal(etapaDaRequisicao({ status: "aprovado", omie_paid_at: null, omie_launch_status: null }), "aprovada");
  assert.equal(etapaDaRequisicao({ status: "aprovado", omie_paid_at: null, omie_launch_status: "pendente" }), "enviada_para_pagamento");
  assert.equal(etapaDaRequisicao({ status: "info_pagamento_pendente", omie_paid_at: null, omie_launch_status: null }), "aguardando_sua_resposta");
  assert.equal(etapaDaRequisicao({ status: "inativado_csc", omie_paid_at: null, omie_launch_status: null }), "cancelada");
});

test("respostaPendente e safeFileName", () => {
  assert.equal(respostaPendente("aguardando_complementacao"), "complemento");
  assert.equal(respostaPendente("info_pagamento_pendente"), "info_pagamento");
  assert.equal(respostaPendente("pendente"), null);
  assert.equal(safeFileName("Nota Fiscal (1).pdf"), "Nota_Fiscal_1_.pdf");
  assert.equal(safeFileName("../../etc/passwd").includes("/"), false);
  assert.equal(safeFileName("../../etc/passwd").includes(".."), false);
  assert.equal(safeFileName("///"), "arquivo");
});

test("parseCreateRequest: obrigatórios do formulário do Compras", () => {
  assert.equal(parseCreateRequest({ ...BASE, supplier_id: undefined }, ctxDe()).ok, false);
  assert.equal(parseCreateRequest({ ...BASE, expense_type_id: "" }, ctxDe()).ok, false);
  assert.equal(parseCreateRequest({ ...BASE, supplier_issues_invoice: "talvez" }, ctxDe()).ok, false);
  // Boleto exige o anexo; NF "sim" exige a nota; "após pagamento" não.
  assert.equal(parseCreateRequest({ ...BASE, payment_method: "boleto" }, ctxDe()).ok, false);
  assert.ok(parseCreateRequest({ ...BASE, payment_method: "boleto", attachment_path: `${U1}/1791491752532-b.pdf` }, ctxDe()).ok);
  assert.equal(parseCreateRequest({ ...BASE, supplier_issues_invoice: "sim" }, ctxDe()).ok, false);
  assert.ok(parseCreateRequest({ ...BASE, supplier_issues_invoice: "sim_apos_pagamento" }, ctxDe()).ok);
  assert.equal(parseCreateRequest({ ...BASE, payment_method: "pix_copia_cola" }, ctxDe()).ok, false);
  assert.ok(parseCreateRequest({ ...BASE, payment_method: "cartao_prepago" }, ctxDe()).ok);
});
