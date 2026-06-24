"use server";

import { revalidatePath } from "next/cache";

import { createAdminClient } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { decryptSecret } from "@/lib/security/encryption";
import {
  listCategorias,
  listDepartamentos,
  listContasCorrentes,
  type OmieOption,
} from "@/lib/omie/cadastros";

// ─── syncOmieOptions ──────────────────────────────────────────────────────────

export async function syncOmieOptions(companyId: string): Promise<
  | { ok: true; counts: { categoria: number; departamento: number; conta_corrente: number } }
  | { error: string }
> {
  await requireCtrlRole("admin", "csc", "contas_a_pagar");
  const db = createAdminClient();

  // Load company credentials
  const { data: company, error: compErr } = await db
    .from("companies")
    .select("omie_app_key, omie_app_secret")
    .eq("id", companyId)
    .single();

  if (compErr || !company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Empresa sem conexão Omie." };
  }

  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);

  // Fetch from Omie
  let categorias: OmieOption[];
  let departamentos: OmieOption[];
  let contasCorrentes: OmieOption[];

  try {
    categorias = await listCategorias(appKey, appSecret);
  } catch (e) {
    return { error: `Erro ao buscar categorias: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    departamentos = await listDepartamentos(appKey, appSecret);
  } catch (e) {
    return { error: `Erro ao buscar departamentos: ${e instanceof Error ? e.message : String(e)}` };
  }

  try {
    contasCorrentes = await listContasCorrentes(appKey, appSecret);
  } catch (e) {
    return { error: `Erro ao buscar contas correntes: ${e instanceof Error ? e.message : String(e)}` };
  }

  const now = new Date().toISOString();

  // Replace cache per kind
  const kinds = [
    { kind: "categoria" as const, items: categorias },
    { kind: "departamento" as const, items: departamentos },
    { kind: "conta_corrente" as const, items: contasCorrentes },
  ];

  for (const { kind, items } of kinds) {
    // Delete existing rows for this company + kind
    const { error: delErr } = await db
      .from("ctrl_omie_options")
      .delete()
      .eq("company_id", companyId)
      .eq("kind", kind);

    if (delErr) return { error: `Erro ao limpar cache (${kind}): ${delErr.message}` };

    if (items.length > 0) {
      const rows = items.map((it) => ({
        company_id: companyId,
        kind,
        codigo: it.codigo,
        descricao: it.descricao,
        synced_at: now,
      }));

      const { error: insErr } = await db.from("ctrl_omie_options").insert(rows);
      if (insErr) return { error: `Erro ao salvar cache (${kind}): ${insErr.message}` };
    }
  }

  return {
    ok: true,
    counts: {
      categoria: categorias.length,
      departamento: departamentos.length,
      conta_corrente: contasCorrentes.length,
    },
  };
}

// ─── getOmieMappingData ───────────────────────────────────────────────────────

export interface OmieMappingData {
  categorias: OmieOption[];
  departamentos: OmieOption[];
  contasCorrentes: OmieOption[];
  expenseTypes: { id: string; name: string }[];
  sectors: { id: string; name: string }[];
  expenseMap: Record<string, string>; // expenseTypeId → codigoCategoria (com NF)
  expenseMapSemNota: Record<string, string>; // expenseTypeId → codigoCategoria (sem NF)
  sectorMap: Record<string, string>; // sectorId → codigoDepartamento
  contaCorrente: string | null;
  contaCorrenteCaixa: string | null;
  contaCorrenteCartao: string | null;
  cartaoDiaVencimento: number | null;
  lastSyncedAt: string | null;
}

export async function getOmieMappingData(
  companyId: string,
): Promise<OmieMappingData | { error: string }> {
  await requireCtrlRole("admin", "csc", "contas_a_pagar");
  const db = createAdminClient();

  // Cached options
  const { data: options, error: optErr } = await db
    .from("ctrl_omie_options")
    .select("kind, codigo, descricao, synced_at")
    .eq("company_id", companyId)
    .order("descricao");

  if (optErr) return { error: optErr.message };

  const categorias: OmieOption[] = [];
  const departamentos: OmieOption[] = [];
  const contasCorrentes: OmieOption[] = [];
  let lastSyncedAt: string | null = null;

  for (const row of options ?? []) {
    const opt: OmieOption = { codigo: row.codigo, descricao: row.descricao };
    if (row.kind === "categoria") categorias.push(opt);
    else if (row.kind === "departamento") departamentos.push(opt);
    else if (row.kind === "conta_corrente") contasCorrentes.push(opt);

    if (row.synced_at && (!lastSyncedAt || row.synced_at > lastSyncedAt)) {
      lastSyncedAt = row.synced_at;
    }
  }

  // Expense types
  const { data: expenseTypesRaw, error: etErr } = await db
    .from("ctrl_expense_types")
    .select("id, name")
    .order("name");

  if (etErr) return { error: etErr.message };

  // Sectors (active only)
  const { data: sectorsRaw, error: secErr } = await db
    .from("ctrl_sectors")
    .select("id, name")
    .eq("active", true)
    .order("name");

  if (secErr) return { error: secErr.message };

  // Expense → categoria mapping (com nota fiscal / sem nota fiscal)
  const { data: expMapRaw, error: emErr } = await db
    .from("ctrl_expense_type_omie_categoria")
    .select("expense_type_id, codigo_categoria, codigo_categoria_sem_nota")
    .eq("company_id", companyId);

  if (emErr) return { error: emErr.message };

  // Sector → departamento mapping
  const { data: secMapRaw, error: smErr } = await db
    .from("ctrl_sector_omie_departamento")
    .select("sector_id, codigo_departamento")
    .eq("company_id", companyId);

  if (smErr) return { error: smErr.message };

  // Conta corrente config
  const { data: ccConfig, error: ccErr } = await db
    .from("ctrl_company_omie_config")
    .select("codigo_conta_corrente, codigo_conta_corrente_caixa, codigo_conta_corrente_cartao, cartao_dia_vencimento")
    .eq("company_id", companyId)
    .maybeSingle();

  if (ccErr) return { error: ccErr.message };

  const expenseMap: Record<string, string> = {};
  const expenseMapSemNota: Record<string, string> = {};
  for (const row of expMapRaw ?? []) {
    if (row.codigo_categoria) expenseMap[row.expense_type_id] = row.codigo_categoria;
    if (row.codigo_categoria_sem_nota)
      expenseMapSemNota[row.expense_type_id] = row.codigo_categoria_sem_nota;
  }

  const sectorMap: Record<string, string> = {};
  for (const row of secMapRaw ?? []) {
    sectorMap[row.sector_id] = row.codigo_departamento;
  }

  return {
    categorias,
    departamentos,
    contasCorrentes,
    expenseTypes: (expenseTypesRaw ?? []).map((r) => ({ id: r.id, name: r.name })),
    sectors: (sectorsRaw ?? []).map((r) => ({ id: r.id, name: r.name })),
    expenseMap,
    expenseMapSemNota,
    sectorMap,
    contaCorrente: ccConfig?.codigo_conta_corrente ?? null,
    contaCorrenteCaixa: ccConfig?.codigo_conta_corrente_caixa ?? null,
    contaCorrenteCartao: ccConfig?.codigo_conta_corrente_cartao ?? null,
    cartaoDiaVencimento: ccConfig?.cartao_dia_vencimento ?? null,
    lastSyncedAt,
  };
}

// ─── saveExpenseTypeCategoria ─────────────────────────────────────────────────

export async function saveExpenseTypeCategoria(
  companyId: string,
  expenseTypeId: string,
  codigoCategoria: string | null,
  tipo: "com_nota" | "sem_nota" = "com_nota",
): Promise<{ ok: true } | { error: string }> {
  await requireCtrlRole("admin", "csc", "contas_a_pagar");
  const db = createAdminClient();

  // Cada tipo de despesa tem duas categorias (com/sem nota fiscal) na mesma
  // linha. Upsert da coluna do tipo escolhido — sem apagar a outra. Valor vazio
  // grava null naquela coluna (a linha permanece para a outra categoria).
  const coluna = tipo === "sem_nota" ? "codigo_categoria_sem_nota" : "codigo_categoria";

  const { error } = await db
    .from("ctrl_expense_type_omie_categoria")
    .upsert(
      {
        expense_type_id: expenseTypeId,
        company_id: companyId,
        [coluna]: codigoCategoria || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "expense_type_id,company_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/ctrl/admin/omie-mapeamento");
  return { ok: true };
}

// ─── saveSectorDepartamento ───────────────────────────────────────────────────

export async function saveSectorDepartamento(
  companyId: string,
  sectorId: string,
  codigoDepartamento: string | null,
): Promise<{ ok: true } | { error: string }> {
  await requireCtrlRole("admin", "csc", "contas_a_pagar");
  const db = createAdminClient();

  if (!codigoDepartamento) {
    const { error } = await db
      .from("ctrl_sector_omie_departamento")
      .delete()
      .eq("sector_id", sectorId)
      .eq("company_id", companyId);

    if (error) return { error: error.message };
  } else {
    const { error } = await db
      .from("ctrl_sector_omie_departamento")
      .upsert(
        {
          sector_id: sectorId,
          company_id: companyId,
          codigo_departamento: codigoDepartamento,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "sector_id,company_id" },
      );

    if (error) return { error: error.message };
  }

  revalidatePath("/ctrl/admin/omie-mapeamento");
  return { ok: true };
}

// ─── saveContaCorrente ────────────────────────────────────────────────────────

export async function saveContaCorrente(
  companyId: string,
  codigo: string | null,
  tipo: "padrao" | "caixa" | "cartao" = "padrao",
): Promise<{ ok: true } | { error: string }> {
  await requireCtrlRole("admin", "csc", "contas_a_pagar");
  const db = createAdminClient();

  const coluna =
    tipo === "caixa"
      ? "codigo_conta_corrente_caixa"
      : tipo === "cartao"
      ? "codigo_conta_corrente_cartao"
      : "codigo_conta_corrente";

  const { error } = await db
    .from("ctrl_company_omie_config")
    .upsert(
      {
        company_id: companyId,
        [coluna]: codigo ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/ctrl/admin/omie-mapeamento");
  return { ok: true };
}

// ─── saveCartaoDiaVencimento ──────────────────────────────────────────────────

export async function saveCartaoDiaVencimento(
  companyId: string,
  dia: number | null,
): Promise<{ ok: true } | { error: string }> {
  await requireCtrlRole("admin", "csc", "contas_a_pagar");

  if (dia !== null && (!Number.isInteger(dia) || dia < 1 || dia > 31)) {
    return { error: "Dia de vencimento deve ser um número entre 1 e 31." };
  }

  const db = createAdminClient();
  const { error } = await db
    .from("ctrl_company_omie_config")
    .upsert(
      {
        company_id: companyId,
        cartao_dia_vencimento: dia,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "company_id" },
    );

  if (error) return { error: error.message };

  revalidatePath("/ctrl/admin/omie-mapeamento");
  return { ok: true };
}
