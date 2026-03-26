import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { testCompanyConnection } from "@/lib/omie/sync";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

export async function POST(_: Request, { params }: Params) {
  try {
    const { supabase, user, profile } = await getCurrentSessionContext();
    if (!user) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    if (!profile || profile.role !== "admin") {
      return NextResponse.json({ error: "Apenas admin pode testar conexao." }, { status: 403 });
    }

    const db = createAdminClientIfAvailable() ?? supabase;
    const { data: company, error } = await db
      .from("companies")
      .select("omie_app_key,omie_app_secret")
      .eq("id", params.companyId)
      .single<{ omie_app_key: string | null; omie_app_secret: string | null }>();

    if (error || !company) {
      return NextResponse.json({ error: "Empresa nao encontrada." }, { status: 404 });
    }
    if (!company.omie_app_key || !company.omie_app_secret) {
      return NextResponse.json({ error: "Credenciais nao configuradas." }, { status: 400 });
    }

    await testCompanyConnection(company.omie_app_key, company.omie_app_secret);
    return NextResponse.json({ ok: true, message: "Conexao Omie validada com sucesso." });
  } catch (testError) {
    const message =
      testError instanceof Error ? testError.message : "Falha ao testar conexao com a Omie.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
