import type { SupabaseClient } from "@supabase/supabase-js";

import { getCaseOmieCreds } from "@/lib/case/omie-creds";
import {
  syncClienteToOmieUnit,
  syncSupplierToOmieUnit,
  type OmieSupplierData,
} from "@/lib/omie/clientes";
import type { CaseBandInput, CaseClientInput } from "@/lib/case/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// Módulo comum (NÃO "use server"): estes helpers são chamados por dentro das
// server actions, que já fizeram requireCaseUser. Não expor como action própria.

/**
 * Regra "todo cliente já cadastrado na Omie": ao criar um cadastro novo, empurra
 * pro Omie na hora e grava o omie_codigo. Best-effort — se o Omie falhar, o
 * launch do contrato é a rede de segurança (ele reexecuta o mesmo cadastro).
 */
export async function ensureOmieRegistration(db: DB, kind: "client" | "band", id: string): Promise<void> {
  const table = kind === "client" ? "case_clients" : "case_bands";
  const { data: row } = await db.from(table).select("*").eq("id", id).single();
  if (!row || row.omie_codigo || !onlyDigits(row.cnpj_cpf)) return;
  const creds = await getCaseOmieCreds(db);
  if (!creds) return;
  const data: OmieSupplierData = {
    id: row.id,
    name: row.name,
    cnpj_cpf: row.cnpj_cpf,
    email: row.email,
    phone: row.phone,
    banco: kind === "band" ? row.banco : null,
    agencia: kind === "band" ? row.agencia : null,
    conta_corrente: kind === "band" ? row.conta_corrente : null,
    titular_banco: kind === "band" ? row.titular_banco : null,
    doc_titular: kind === "band" ? row.doc_titular : null,
    chave_pix: kind === "band" ? row.chave_pix : null,
  };
  try {
    const { codigoCliente } =
      kind === "client"
        ? await syncClienteToOmieUnit(creds.appKey, creds.appSecret, data)
        : await syncSupplierToOmieUnit(creds.appKey, creds.appSecret, data);
    await db
      .from(table)
      .update({ omie_codigo: codigoCliente, omie_synced_at: new Date().toISOString() })
      .eq("id", id);
  } catch (e) {
    console.error(`[case] falha ao cadastrar ${kind} no Omie na criação:`, e);
  }
}

export async function resolveClient(db: DB, input: CaseClientInput, userId: string): Promise<string> {
  const legalFields = {
    email: input.email,
    phone: input.phone,
    resp_legal: input.resp_legal,
    cpf_resp_legal: input.cpf_resp_legal,
    endereco: input.endereco,
    cidade_estado: input.cidade_estado,
    cep: input.cep,
  };

  if (input.id) {
    await db
      .from("case_clients")
      .update({
        name: input.name,
        cnpj_cpf: input.cnpj_cpf,
        pessoa_fisica: input.pessoa_fisica,
        ...legalFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    return input.id;
  }

  const doc = onlyDigits(input.cnpj_cpf);
  if (doc) {
    const { data: existing } = await db.from("case_clients").select("id, cnpj_cpf");
    const match = (existing ?? []).find(
      (c: { id: string; cnpj_cpf: string | null }) => onlyDigits(c.cnpj_cpf) === doc,
    );
    if (match) {
      await db.from("case_clients").update({ ...legalFields }).eq("id", match.id);
      return match.id as string;
    }
  }

  const { data, error } = await db
    .from("case_clients")
    .insert({
      name: input.name,
      cnpj_cpf: input.cnpj_cpf,
      pessoa_fisica: input.pessoa_fisica,
      ...legalFields,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (doc && error?.code === "23505") {
      const { data: rows } = await db.from("case_clients").select("id, cnpj_cpf");
      const m = (rows ?? []).find((c: { id: string; cnpj_cpf: string | null }) => onlyDigits(c.cnpj_cpf) === doc);
      if (m) return m.id as string;
    }
    throw new Error(`Falha ao cadastrar cliente: ${error?.message ?? "?"}`);
  }
  return data.id as string;
}

export async function resolveBand(
  db: DB,
  input: CaseBandInput,
  userId: string,
  kind: "atracao" | "fornecedor" = "atracao",
): Promise<string> {
  const bankFields = {
    banco: input.banco,
    agencia: input.agencia,
    conta_corrente: input.conta_corrente,
    titular_banco: input.titular_banco,
    doc_titular: input.doc_titular,
    chave_pix: input.chave_pix,
  };

  if (input.id) {
    await db
      .from("case_bands")
      .update({
        name: input.name,
        cnpj_cpf: input.cnpj_cpf,
        pessoa_fisica: input.pessoa_fisica,
        email: input.email,
        phone: input.phone,
        ...bankFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    return input.id;
  }

  const doc = onlyDigits(input.cnpj_cpf);
  if (doc) {
    const { data: existing } = await db.from("case_bands").select("id, cnpj_cpf");
    const match = (existing ?? []).find(
      (b: { id: string; cnpj_cpf: string | null }) => onlyDigits(b.cnpj_cpf) === doc,
    );
    if (match) {
      await db.from("case_bands").update({ ...bankFields }).eq("id", match.id);
      return match.id as string;
    }
  }

  const { data, error } = await db
    .from("case_bands")
    .insert({
      name: input.name,
      cnpj_cpf: input.cnpj_cpf,
      pessoa_fisica: input.pessoa_fisica,
      email: input.email,
      phone: input.phone,
      ...bankFields,
      kind,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (doc && error?.code === "23505") {
      const { data: rows } = await db.from("case_bands").select("id, cnpj_cpf");
      const m = (rows ?? []).find((b: { id: string; cnpj_cpf: string | null }) => onlyDigits(b.cnpj_cpf) === doc);
      if (m) return m.id as string;
    }
    throw new Error(`Falha ao cadastrar banda: ${error?.message ?? "?"}`);
  }
  return data.id as string;
}
