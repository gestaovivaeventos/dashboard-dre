import { NextResponse } from "next/server";

import { normalizeDoc } from "@/lib/ctrl/cnpj";
import { getCtrlUser, hasCtrlRole } from "@/lib/ctrl/auth";
import { getOrgCompanyIds } from "@/lib/ctrl/orgs";
import { planSupplierImport } from "@/lib/ctrl/omie-suppliers-import";
import { listAllClientesFromOmie, type OmiePartner } from "@/lib/omie/clientes";
import { decryptSecret } from "@/lib/security/encryption";
import { createAdminClient } from "@/lib/supabase/admin";

// Lê os cadastros da Omie dos CNPJs da empresa ativa (18 páginas por CNPJ na
// Feat), então precisa de folga além do teto padrão da Vercel.
export const maxDuration = 300;

const CHUNK = 500;

/**
 * Importa os fornecedores da Omie da EMPRESA ATIVA do Compras como `pendente`.
 * Só os cadastros marcados "Fornecedor" (decisão do dono, 07/10/2026); entram na
 * fila de homologação do Contas a Pagar/admin, com PIX e dados bancários. Lê com
 * o admin client DEPOIS do gate — as credenciais Omie vivem em `companies`, com
 * RLS. Reexecutar é seguro: dedup por documento/código não reimporta ninguém.
 */
export async function POST() {
  const ctx = await getCtrlUser();
  if (!ctx) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  // Operação de cadastro em lote: admin ou Contas a Pagar (quem opera o Mapeamento
  // Omie e homologa). Não é a mesma alçada de "aprovar fornecedor".
  if (!hasCtrlRole(ctx, "admin", "contas_a_pagar")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }
  if (!ctx.orgId) {
    return NextResponse.json({ error: "Empresa ativa não identificada." }, { status: 400 });
  }

  const admin = createAdminClient();

  // CNPJs da empresa ativa + credenciais Omie.
  const companyIds = await getOrgCompanyIds(admin, ctx.orgId);
  if (companyIds.length === 0) {
    return NextResponse.json({ error: "A empresa ativa não tem CNPJ vinculado." }, { status: 400 });
  }
  const { data: comps, error: compErr } = await admin
    .from("companies")
    .select("id, name, omie_app_key, omie_app_secret")
    .in("id", companyIds);
  if (compErr) return NextResponse.json({ error: compErr.message }, { status: 400 });
  const comCredencial = (comps ?? []).filter((c) => c.omie_app_key && c.omie_app_secret);
  if (comCredencial.length === 0) {
    return NextResponse.json(
      { error: "Nenhum CNPJ da empresa ativa tem credencial Omie configurada." },
      { status: 400 },
    );
  }

  // Fornecedores já cadastrados na empresa — dedup por documento e por código Omie.
  const { data: existing, error: exErr } = await admin
    .from("ctrl_suppliers")
    .select("cnpj_cpf, omie_id")
    .eq("org_id", ctx.orgId);
  if (exErr) return NextResponse.json({ error: exErr.message }, { status: 400 });
  const existingDocs = new Set<string>();
  const existingOmieIds = new Set<string>();
  for (const s of (existing ?? []) as Array<{ cnpj_cpf: string | null; omie_id: number | null }>) {
    if (s.cnpj_cpf) existingDocs.add(normalizeDoc(s.cnpj_cpf));
    if (s.omie_id != null) existingOmieIds.add(String(s.omie_id));
  }

  // Lê cada CNPJ da empresa e junta (a empresa pode ter mais de um; a Feat tem 1).
  const partners: OmiePartner[] = [];
  const avisos: string[] = [];
  let scanned = 0;
  for (const c of comCredencial) {
    try {
      const appKey = decryptSecret(c.omie_app_key as string);
      const appSecret = decryptSecret(c.omie_app_secret as string);
      const list = await listAllClientesFromOmie(appKey, appSecret);
      scanned += list.length;
      partners.push(...list);
    } catch (e) {
      avisos.push(`${c.name}: ${(e as Error).message}`);
    }
  }
  // Se nenhum CNPJ respondeu, é falha — não "zero fornecedores".
  if (partners.length === 0 && avisos.length > 0) {
    return NextResponse.json(
      { error: `Falha ao ler a Omie: ${avisos.join("; ")}` },
      { status: 502 },
    );
  }

  const { rows, fornecedorCount, skippedExisting } = planSupplierImport(partners, {
    orgId: ctx.orgId,
    createdBy: ctx.id,
    existingDocs,
    existingOmieIds,
  });

  // Insere em blocos. Sem upsert: o índice único de documento é POR EXPRESSÃO
  // (upper(regexp_replace(...))), e `ignoreDuplicates` não casa com ele — a dedup
  // já foi feita por leitura acima (mesma lição de orcamento_grupo_escopo).
  let imported = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await admin.from("ctrl_suppliers").insert(chunk);
    if (error) {
      return NextResponse.json({ error: error.message, imported }, { status: 400 });
    }
    imported += chunk.length;
  }

  return NextResponse.json({
    imported,
    skippedExisting,
    scanned,
    fornecedorCount,
    avisos: avisos.length > 0 ? avisos : undefined,
  });
}
