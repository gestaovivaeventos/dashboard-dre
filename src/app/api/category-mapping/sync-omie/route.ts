import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { listCategorias } from "@/lib/omie/cadastros";
import { decryptSecret } from "@/lib/security/encryption";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/utils/uuid";

// Puxa TODAS as categorias ATIVAS direto do cadastro da Omie (ListarCategorias)
// e as grava em omie_categories — mesmo as que nunca receberam lançamento.
//
// Por que existe: omie_categories era populada SOMENTE a partir dos lançamentos
// durante o sync (ver src/lib/omie/sync.ts, passo 6). Uma categoria nova só
// aparecia no Mapeamento (DRE e Fluxo de Caixa) depois do primeiro lançamento.
// Aqui a fonte é o CADASTRO, não o movimento.
//
// Empresa COMPOSTA (sem Omie própria, ex.: Salvaterra Estacionamento): ela puxa
// dados de OUTRAS empresas por departamento roteado. Neste caso sincronizamos o
// cadastro das empresas de ORIGEM — assim o mapeamento roteado (que lista as
// categorias das origens) enxerga todas as categorias delas, independente do
// departamento. Empresa que tem Omie própria E também recebe roteamento
// sincroniza as duas pontas.
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

  // Empresas cujo cadastro de categorias vamos puxar: a própria (se tiver Omie)
  // + as empresas de ORIGEM dos departamentos roteados para ela.
  const targetIds = new Set<string>([companyId]);
  const { data: routedDepts } = await admin
    .from("company_departments")
    .select("company_id")
    .eq("routed_to_company_id", companyId);
  (routedDepts ?? []).forEach((d) => {
    const src = d.company_id as string | null;
    if (src) targetIds.add(src);
  });

  const { data: companies, error: compErr } = await admin
    .from("companies")
    .select("id, name, omie_app_key, omie_app_secret")
    .in("id", Array.from(targetIds));
  if (compErr) {
    return NextResponse.json({ error: compErr.message }, { status: 400 });
  }

  const withCreds = (companies ?? []).filter(
    (c) => c.omie_app_key && c.omie_app_secret,
  );
  if (withCreds.length === 0) {
    return NextResponse.json(
      { error: "Empresa sem conexao Omie (nem ela, nem as empresas de origem)." },
      { status: 400 },
    );
  }

  let totalCount = 0;
  const perCompany: Array<{ name: string; count: number }> = [];
  const errors: string[] = [];

  for (const company of withCreds) {
    try {
      const appKey = decryptSecret(company.omie_app_key as string);
      const appSecret = decryptSecret(company.omie_app_secret as string);
      const count = await syncCompanyCategories(admin, company.id as string, appKey, appSecret);
      totalCount += count;
      perCompany.push({ name: (company.name as string) ?? "Empresa", count });
    } catch (e) {
      errors.push(
        `${(company.name as string) ?? "Empresa"}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }

  // Todas falharam → erro. Sucesso parcial → ok com aviso.
  if (perCompany.length === 0) {
    return NextResponse.json(
      { error: `Erro ao buscar categorias na Omie: ${errors.join(" | ")}` },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    count: totalCount,
    companies: perCompany,
    ...(errors.length > 0 ? { warning: errors.join(" | ") } : {}),
  });
}

// Puxa o cadastro de categorias de UMA empresa (com Omie própria) e faz upsert
// idempotente em omie_categories. NÃO apaga o que a Omie não devolveu: categoria
// inativada que já tem lançamento continua visível para remapear/auditar.
async function syncCompanyCategories(
  admin: SupabaseClient,
  companyId: string,
  appKey: string,
  appSecret: string,
): Promise<number> {
  const categorias = await listCategorias(appKey, appSecret);

  // Dedup por code (o upsert em lote falha se o mesmo code repetir).
  const byCode = new Map<string, { company_id: string; code: string; description: string }>();
  for (const c of categorias) {
    const code = c.codigo?.trim();
    if (!code) continue;
    byCode.set(code, { company_id: companyId, code, description: c.descricao?.trim() || code });
  }
  const rows = Array.from(byCode.values());
  if (rows.length === 0) return 0;

  const { error } = await admin
    .from("omie_categories")
    .upsert(rows, { onConflict: "company_id,code" });
  if (error) throw new Error(error.message);
  return rows.length;
}
