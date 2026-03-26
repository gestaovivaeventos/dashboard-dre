import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/security/encryption";

interface Params {
  params: { companyId: string };
}

// Endpoint temporario de debug — retorna a resposta bruta da API ListarMovimentos
// para diagnosticar por que 0 lancamentos sao importados.
// REMOVER APOS DIAGNOSTICO.
export async function GET(_: Request, { params }: Params) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile || (profile.role !== "admin" && profile.role !== "gestor_hero")) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const supabase = await createSupabaseClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, omie_app_key, omie_app_secret")
    .eq("id", params.companyId)
    .single<{ id: string; omie_app_key: string | null; omie_app_secret: string | null }>();

  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return NextResponse.json({ error: "Credenciais nao encontradas." }, { status: 400 });
  }

  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);

  // Testa a API ListarMovimentos com 3 registros
  const apiResponse = await fetch("https://app.omie.com.br/api/v1/financas/mf/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      call: "ListarMovimentos",
      app_key: appKey,
      app_secret: appSecret,
      param: [{ nPagina: 1, nRegPorPagina: 3 }],
    }),
    cache: "no-store",
  });

  const rawText = await apiResponse.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    // nao e JSON valido
  }

  // Extrai info sobre a estrutura da resposta
  const responseKeys = parsed && typeof parsed === "object" ? Object.keys(parsed as object) : [];
  const arrayKeys = responseKeys.filter((k) => Array.isArray((parsed as Record<string, unknown>)[k]));

  let firstRecord: unknown = null;
  let firstRecordKeys: string[] = [];
  if (parsed && typeof parsed === "object" && arrayKeys.length > 0) {
    const arr = (parsed as Record<string, unknown>)[arrayKeys[0]];
    if (Array.isArray(arr) && arr.length > 0) {
      firstRecord = arr[0];
      firstRecordKeys = firstRecord && typeof firstRecord === "object" ? Object.keys(firstRecord as object) : [];
    }
  }

  return NextResponse.json({
    httpStatus: apiResponse.status,
    responseKeys,
    arrayKeys,
    firstRecordKeys,
    firstRecord,
    rawResponsePreview: typeof rawText === "string" ? rawText.slice(0, 2000) : null,
  });
}
