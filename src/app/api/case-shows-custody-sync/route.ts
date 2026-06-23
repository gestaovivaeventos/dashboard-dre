// Ingestão/validação da seção "Custódia de Artistas - Análise Competência" da
// Case Shows (dados por DATA DE REGISTRO, vindos direto do ListarMovimentos da
// Omie). Admin only.
//
//   ?dryRun=1  → NÃO grava. Busca via dDtRegDe/dDtRegAte e devolve as somas por
//                campo de valor candidato (movCC/liquido/pago/aberto/titulo) +
//                amostras cruas, para confirmar qual campo bate com o relatório.
//   (sem dryRun) → grava na tabela usando ?field=<candidato> (default "titulo").
//
// NÃO altera o sync oficial nem dados da Omie — apenas LÊ a Omie e grava a tabela
// gerencial isolada.

import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { decryptSecret } from "@/lib/security/encryption";
import { CASE_SHOWS_COMPANY_NAME } from "@/lib/dashboard/case-shows-custody";
import {
  CUSTODY_VALUE_FIELDS,
  type CustodyValueField,
  analyzeCaseShowsCustodyRegistration,
  resolveCustodyCategoryCodes,
  runCaseShowsCustodyCompetenciaSync,
} from "@/lib/omie/case-shows-custody-sync";
import { COMPETENCIA_FLOOR_YEAR } from "@/lib/dashboard/case-shows-custody";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) return NextResponse.json({ error: "auth" }, { status: 401 });
  if (profile.role !== "admin") return NextResponse.json({ error: "admin only" }, { status: 403 });

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const fieldParam = url.searchParams.get("field") as CustodyValueField | null;
  const valueField: CustodyValueField =
    fieldParam && (CUSTODY_VALUE_FIELDS as readonly string[]).includes(fieldParam)
      ? fieldParam
      : "titulo";

  const admin = createAdminClient();

  // Case Shows + credenciais Omie.
  const { data: company } = await admin
    .from("companies")
    .select("id,name,omie_app_key,omie_app_secret")
    .ilike("name", CASE_SHOWS_COMPANY_NAME)
    .maybeSingle<{ id: string; name: string; omie_app_key: string | null; omie_app_secret: string | null }>();
  if (!company) return NextResponse.json({ error: "Case Shows não encontrada" }, { status: 404 });
  if (!company.omie_app_key || !company.omie_app_secret) {
    return NextResponse.json({ error: "Credenciais Omie não configuradas" }, { status: 400 });
  }
  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);

  if (dryRun) {
    const { codes } = await resolveCustodyCategoryCodes(admin, company.id);
    if (codes.length === 0) {
      return NextResponse.json({ error: "Nenhuma categoria de Custódia mapeada em 6.2/6.3/6.4" }, { status: 400 });
    }
    const analysis = await analyzeCaseShowsCustodyRegistration({
      appKey,
      appSecret,
      categoryCodes: codes,
      yearFrom: COMPETENCIA_FLOOR_YEAR,
    });
    return NextResponse.json({
      mode: "dryRun",
      company: { id: company.id, name: company.name },
      category_codes: codes,
      omie_reference_entradas_2026: { "1": 138286.13, "2": 148730.33, "3": 268832.69, "4": 173160.0, "5": 154850.0, "6": 152000.0 },
      ...analysis,
    });
  }

  const result = await runCaseShowsCustodyCompetenciaSync({
    supabase: admin,
    companyId: company.id,
    appKey,
    appSecret,
    valueField,
  });
  if (result.categoryCodes.length === 0) {
    return NextResponse.json({ error: "Nenhuma categoria de Custódia mapeada em 6.2/6.3/6.4" }, { status: 400 });
  }
  return NextResponse.json({ mode: "sync", company: { id: company.id, name: company.name }, valueField, ...result });
}
