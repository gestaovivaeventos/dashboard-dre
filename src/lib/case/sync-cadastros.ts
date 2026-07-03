import type { SupabaseClient } from "@supabase/supabase-js";

import { listAllClientesFromOmie, type OmiePartner } from "@/lib/omie/clientes";
import { getCaseOmieCreds } from "@/lib/case/omie-creds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
const coalesce = <T>(a: T | null | undefined, b: T | null | undefined): T | null =>
  a != null && a !== "" ? a : (b ?? null);

async function chunkedInsert(db: DB, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).insert(rows.slice(i, i + 200));
    if (error) throw new Error(`Falha ao inserir em ${table}: ${error.message}`);
  }
}
async function chunkedUpsert(db: DB, table: string, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await db.from(table).upsert(rows.slice(i, i + 200), { onConflict: "id" });
    if (error) throw new Error(`Falha ao atualizar ${table}: ${error.message}`);
  }
}

interface UpsertPlan {
  inserts: Record<string, unknown>[];
  updates: Record<string, unknown>[];
}

/**
 * Monta insert/update por CNPJ para uma tabela de cadastros do Case.
 * `pick` escolhe quais campos do parceiro Omie interessam à tabela.
 * Regra de merge: identidade (name/doc/pessoa_fisica/omie_codigo) sempre vem do
 * Omie; os demais usam coalesce(Omie, existente) — nunca zera dado já gravado.
 */
/** @internal exportado para teste. */
export function planUpsert(
  partners: OmiePartner[],
  existing: Array<Record<string, unknown>>,
  pick: (p: OmiePartner, prev: Record<string, unknown> | null) => Record<string, unknown>,
  now: string,
): UpsertPlan {
  const byDoc = new Map<string, Record<string, unknown>>();
  for (const row of existing) {
    const d = digits(row.cnpj_cpf as string | null);
    if (d) byDoc.set(d, row);
  }
  const seen = new Set<string>();
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];

  for (const p of partners) {
    const d = digits(p.cnpj_cpf);
    if (!d || seen.has(d)) continue; // sem doc não entra; dedupe de duplicados do Omie
    seen.add(d);
    const prev = byDoc.get(d) ?? null;
    const fields = pick(p, prev);
    if (prev) {
      updates.push({ id: prev.id, ...fields, updated_at: now });
    } else {
      inserts.push({ ...fields, omie_synced_at: now });
    }
  }
  return { inserts, updates };
}

export interface CaseCadastroSyncResult {
  skipped?: string;
  fetched: number;
  clients: { inserted: number; updated: number };
  bands: { inserted: number; updated: number };
}

/**
 * Pull Omie → banco local do Case. Espelha TODOS os cadastros da unidade Omie
 * da Case Shows em case_clients e case_bands (pool misturado: o mesmo cadastro
 * fica disponível como cliente e como artista). Idempotente por CNPJ.
 */
export async function syncCaseCadastrosFromOmie(db: DB): Promise<CaseCadastroSyncResult> {
  const creds = await getCaseOmieCreds(db);
  if (!creds) {
    return { skipped: "Empresa Case Shows sem credenciais Omie.", fetched: 0, clients: { inserted: 0, updated: 0 }, bands: { inserted: 0, updated: 0 } };
  }

  const partners = await listAllClientesFromOmie(creds.appKey, creds.appSecret);
  const now = new Date().toISOString();

  const [{ data: existingClients }, { data: existingBands }] = await Promise.all([
    db.from("case_clients").select("id, cnpj_cpf, email, phone, endereco, cidade_estado, cep"),
    db.from("case_bands").select("id, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix"),
  ]);

  // Clientes (contratantes) — preserva resp_legal/cpf_resp_legal (não vêm do Omie).
  const clientPlan = planUpsert(
    partners,
    (existingClients ?? []) as Array<Record<string, unknown>>,
    (p, prev) => ({
      name: p.name,
      cnpj_cpf: p.cnpj_cpf,
      pessoa_fisica: p.pessoa_fisica,
      email: coalesce(p.email, prev?.email as string | null),
      phone: coalesce(p.phone, prev?.phone as string | null),
      endereco: coalesce(prev?.endereco as string | null, p.endereco),
      cidade_estado: coalesce(prev?.cidade_estado as string | null, p.cidade_estado),
      cep: coalesce(prev?.cep as string | null, p.cep),
      omie_codigo: p.omie_codigo,
      omie_synced_at: now,
    }),
    now,
  );

  // Artistas/fornecedores — inclui dados bancários do Omie.
  const bandPlan = planUpsert(
    partners,
    (existingBands ?? []) as Array<Record<string, unknown>>,
    (p, prev) => ({
      name: p.name,
      cnpj_cpf: p.cnpj_cpf,
      pessoa_fisica: p.pessoa_fisica,
      email: coalesce(p.email, prev?.email as string | null),
      phone: coalesce(p.phone, prev?.phone as string | null),
      banco: coalesce(p.banco, prev?.banco as string | null),
      agencia: coalesce(p.agencia, prev?.agencia as string | null),
      conta_corrente: coalesce(p.conta_corrente, prev?.conta_corrente as string | null),
      titular_banco: coalesce(p.titular_banco, prev?.titular_banco as string | null),
      doc_titular: coalesce(p.doc_titular, prev?.doc_titular as string | null),
      chave_pix: coalesce(p.chave_pix, prev?.chave_pix as string | null),
      omie_codigo: p.omie_codigo,
      omie_synced_at: now,
    }),
    now,
  );

  await chunkedInsert(db, "case_clients", clientPlan.inserts);
  await chunkedUpsert(db, "case_clients", clientPlan.updates);
  await chunkedInsert(db, "case_bands", bandPlan.inserts);
  await chunkedUpsert(db, "case_bands", bandPlan.updates);

  return {
    fetched: partners.length,
    clients: { inserted: clientPlan.inserts.length, updated: clientPlan.updates.length },
    bands: { inserted: bandPlan.inserts.length, updated: bandPlan.updates.length },
  };
}
