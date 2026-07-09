"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseAdmin } from "@/lib/case/auth";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
import { decryptSecret } from "@/lib/security/encryption";
import { listCategorias, listContasCorrentes } from "@/lib/omie/cadastros";
import { syncCaseCadastrosFromOmie } from "@/lib/case/sync-cadastros";
import { syncCasePagamentosFromOmie } from "@/lib/case/sync-pagamentos";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

export interface CaseOmieOption {
  codigo: string;
  descricao: string;
}

export interface CaseOmieConfigData {
  categorias: CaseOmieOption[];
  contasCorrentes: CaseOmieOption[];
  config: {
    codigo_categoria_custodia: string | null;
    codigo_categoria_servicos: string | null;
    codigo_categoria_pagar: string | null;
    codigo_categoria_comissao_externa: string | null;
    codigo_categoria_comissao_rider: string | null;
    codigo_conta_corrente: string | null;
  };
}

/** Lê o cache de opções + o mapeamento salvo. */
export async function getOmieConfigData(): Promise<CaseOmieConfigData> {
  await requireCaseAdmin();
  const db = await getDb();

  const [{ data: options }, { data: config }] = await Promise.all([
    db.from("case_omie_options").select("kind, codigo, descricao").eq("company_id", CASE_COMPANY_ID),
    db.from("case_omie_config").select("*").eq("company_id", CASE_COMPANY_ID).maybeSingle(),
  ]);

  const categorias: CaseOmieOption[] = [];
  const contasCorrentes: CaseOmieOption[] = [];
  for (const o of (options ?? []) as Array<{ kind: string; codigo: string; descricao: string | null }>) {
    const opt = { codigo: o.codigo, descricao: o.descricao ?? o.codigo };
    if (o.kind === "categoria") categorias.push(opt);
    else if (o.kind === "conta_corrente") contasCorrentes.push(opt);
  }
  categorias.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));
  contasCorrentes.sort((a, b) => a.descricao.localeCompare(b.descricao, "pt-BR"));

  return {
    categorias,
    contasCorrentes,
    config: {
      codigo_categoria_custodia: config?.codigo_categoria_custodia ?? null,
      codigo_categoria_servicos: config?.codigo_categoria_servicos ?? null,
      codigo_categoria_pagar: config?.codigo_categoria_pagar ?? null,
      codigo_categoria_comissao_externa: config?.codigo_categoria_comissao_externa ?? null,
      codigo_categoria_comissao_rider: config?.codigo_categoria_comissao_rider ?? null,
      codigo_conta_corrente: config?.codigo_conta_corrente ?? null,
    },
  };
}

/** Sincroniza categorias e contas correntes do Omie da Case Shows para o cache. */
export async function syncOmieOptions(): Promise<{ ok: true; categorias: number; contas: number } | { error: string }> {
  await requireCaseAdmin();
  const db = await getDb();

  const { data: company } = await db
    .from("companies")
    .select("omie_app_key, omie_app_secret")
    .eq("id", CASE_COMPANY_ID)
    .single();
  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Case Shows sem credenciais Omie configuradas." };
  }

  let appKey: string;
  let appSecret: string;
  try {
    appKey = decryptSecret(company.omie_app_key);
    appSecret = decryptSecret(company.omie_app_secret);
  } catch {
    return { error: "Falha ao descriptografar credenciais Omie." };
  }

  let categorias, contas;
  try {
    [categorias, contas] = await Promise.all([
      listCategorias(appKey, appSecret),
      listContasCorrentes(appKey, appSecret),
    ]);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao consultar o Omie." };
  }

  const rows = [
    ...categorias.map((c) => ({ company_id: CASE_COMPANY_ID, kind: "categoria", codigo: c.codigo, descricao: c.descricao, synced_at: new Date().toISOString() })),
    ...contas.map((c) => ({ company_id: CASE_COMPANY_ID, kind: "conta_corrente", codigo: c.codigo, descricao: c.descricao, synced_at: new Date().toISOString() })),
  ];

  // Substitui o cache inteiro (delete + insert) para refletir remoções no Omie.
  await db.from("case_omie_options").delete().eq("company_id", CASE_COMPANY_ID);
  if (rows.length > 0) {
    const { error } = await db.from("case_omie_options").insert(rows);
    if (error) return { error: `Falha ao gravar cache: ${error.message}` };
  }

  revalidatePath("/case/config");
  return { ok: true, categorias: categorias.length, contas: contas.length };
}

/** Puxa clientes/fornecedores do Omie da Case para o banco local (manual). */
export async function syncCaseCadastros(): Promise<
  | { ok: true; fetched: number; clientsInserted: number; clientsUpdated: number; bandsInserted: number; bandsUpdated: number; skipped?: string }
  | { error: string }
> {
  await requireCaseAdmin();
  const db = await getDb();
  try {
    const r = await syncCaseCadastrosFromOmie(db);
    revalidatePath("/case/config");
    revalidatePath("/case/contratos/novo");
    return {
      ok: true,
      fetched: r.fetched,
      clientsInserted: r.clients.inserted,
      clientsUpdated: r.clients.updated,
      bandsInserted: r.bands.inserted,
      bandsUpdated: r.bands.updated,
      skipped: r.skipped,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao sincronizar cadastros do Omie." };
  }
}

/** Atualiza o status de pagamento (pago/pendente) dos títulos Case a partir do Omie. */
export async function syncCasePagamentos(): Promise<
  { ok: true; atualizados: number; pagos: number; skipped?: string } | { error: string }
> {
  await requireCaseAdmin();
  const db = await getDb();
  try {
    const r = await syncCasePagamentosFromOmie(db);
    revalidatePath("/case/contratos");
    return { ok: true, atualizados: r.atualizados, pagos: r.pagos, skipped: r.skipped };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao atualizar status de pagamentos." };
  }
}

/** Salva o mapeamento de categorias + conta corrente. */
export async function saveOmieConfig(input: {
  codigo_categoria_custodia: string | null;
  codigo_categoria_servicos: string | null;
  codigo_categoria_pagar: string | null;
  codigo_categoria_comissao_externa: string | null;
  codigo_categoria_comissao_rider: string | null;
  codigo_conta_corrente: string | null;
}): Promise<{ ok: true } | { error: string }> {
  await requireCaseAdmin();
  const db = await getDb();

  const { error } = await db.from("case_omie_config").upsert(
    {
      company_id: CASE_COMPANY_ID,
      codigo_categoria_custodia: input.codigo_categoria_custodia,
      codigo_categoria_servicos: input.codigo_categoria_servicos,
      codigo_categoria_pagar: input.codigo_categoria_pagar,
      codigo_categoria_comissao_externa: input.codigo_categoria_comissao_externa,
      codigo_categoria_comissao_rider: input.codigo_categoria_comissao_rider,
      codigo_conta_corrente: input.codigo_conta_corrente,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "company_id" },
  );
  if (error) return { error: `Falha ao salvar configuração: ${error.message}` };

  revalidatePath("/case/config");
  return { ok: true };
}
