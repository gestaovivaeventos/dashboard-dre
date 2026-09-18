import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { listCategorias } from "@/lib/omie/cadastros";
import { decryptSecret } from "@/lib/security/encryption";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { isUuid } from "@/lib/utils/uuid";

// Puxa TODAS as categorias ATIVAS direto do cadastro da Omie (ListarCategorias)
// e as grava em omie_categories — mesmo as que nunca receberam lançamento.
//
// Por que existe: omie_categories era populada SOMENTE a partir dos lançamentos
// durante o sync (ver src/lib/omie/sync.ts, passo 6). Uma categoria nova só
// aparecia no Mapeamento (DRE e Fluxo de Caixa) depois do primeiro lançamento.
// Aqui a fonte é o CADASTRO, não o movimento, então a categoria aparece assim
// que é criada na Omie e o admin clica em "Atualizar".
//
// Sem filtro de tipo: DRE e Fluxo de Caixa mapeiam categorias de RECEITA e de
// DESPESA (diferente do Compras, que só usa despesa).
export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const companyId = body.companyId?.trim();
  if (!isUuid(companyId)) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  // Precisa do admin client: ler as credenciais Omie (criptografadas) e gravar
  // em omie_categories fora da RLS do usuário.
  const admin = createAdminClientIfAvailable();
  if (!admin) {
    return NextResponse.json(
      { error: "Servico indisponivel (sem service role)." },
      { status: 503 },
    );
  }

  const { data: company, error: compErr } = await admin
    .from("companies")
    .select("omie_app_key, omie_app_secret")
    .eq("id", companyId)
    .single();
  if (compErr || !company?.omie_app_key || !company?.omie_app_secret) {
    return NextResponse.json({ error: "Empresa sem conexao Omie." }, { status: 400 });
  }

  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);

  let categorias;
  try {
    categorias = await listCategorias(appKey, appSecret);
  } catch (e) {
    return NextResponse.json(
      {
        error: `Erro ao buscar categorias na Omie: ${
          e instanceof Error ? e.message : String(e)
        }`,
      },
      { status: 502 },
    );
  }

  // Dedup por code (defensivo — o upsert em lote falha se o mesmo code aparecer
  // duas vezes: "ON CONFLICT ... cannot affect row a second time").
  const byCode = new Map<string, { company_id: string; code: string; description: string }>();
  for (const c of categorias) {
    const code = c.codigo?.trim();
    if (!code) continue;
    byCode.set(code, { company_id: companyId, code, description: c.descricao?.trim() || code });
  }
  const rows = Array.from(byCode.values());

  if (rows.length === 0) {
    return NextResponse.json({ ok: true, count: 0 });
  }

  // Upsert idempotente. NÃO apaga o que a Omie não devolveu: categoria inativada
  // que já tem lançamento continua visível para remapear/auditar. Só adiciona as
  // novas e atualiza a descrição das existentes.
  const { error: upsertErr } = await admin
    .from("omie_categories")
    .upsert(rows, { onConflict: "company_id,code" });
  if (upsertErr) {
    return NextResponse.json({ error: upsertErr.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, count: rows.length });
}
