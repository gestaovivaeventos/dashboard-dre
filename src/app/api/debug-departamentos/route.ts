import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { decryptSecret } from "@/lib/security/encryption";
import { createClient as createSupabaseClient } from "@/lib/supabase/server";

// ===========================================================================
// DEBUG: inspeciona a resposta crua de ListarDepartamentos para entender
// como a Omie expoe a hierarquia (agregador "Sua Empresa" vs folhas
// VIVA GO / HERO).
// ===========================================================================
export async function GET(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (
    !user ||
    !profile ||
    (profile.role !== "admin" && profile.role !== "gestor_hero")
  ) {
    return NextResponse.json({ error: "Acesso negado." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  if (!companyId) {
    return NextResponse.json({ error: "companyId obrigatorio." }, { status: 400 });
  }

  const supabase = await createSupabaseClient();
  const { data: company } = await supabase
    .from("companies")
    .select("id, name, omie_app_key, omie_app_secret")
    .eq("id", companyId)
    .single<{
      id: string;
      name: string;
      omie_app_key: string | null;
      omie_app_secret: string | null;
    }>();

  if (!company || !company.omie_app_key || !company.omie_app_secret) {
    return NextResponse.json({ error: "Empresa sem credenciais." }, { status: 400 });
  }

  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);

  const resp = await fetch(
    "https://app.omie.com.br/api/v1/geral/departamentos/",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: "ListarDepartamentos",
        app_key: appKey,
        app_secret: appSecret,
        param: [{ pagina: 1, registros_por_pagina: 500 }],
      }),
      cache: "no-store",
    },
  );
  const data = (await resp.json()) as Record<string, unknown>;

  return NextResponse.json({
    empresa: company.name,
    rootKeys: Object.keys(data),
    raw: data,
  });
}
