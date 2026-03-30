import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/security/encryption";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

interface Params {
  params: {
    companyId: string;
  };
}

export async function PATCH(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode editar empresas." }, { status: 403 });
  }

  const body = (await request.json()) as {
    appKey?: string;
    appSecret?: string;
  };

  const appKey = body.appKey?.trim();
  const appSecret = body.appSecret?.trim();

  if (!appKey || !appSecret) {
    return NextResponse.json(
      { error: "Informe app key e app secret." },
      { status: 400 },
    );
  }

  const db = createAdminClientIfAvailable() ?? supabase;

  const { error } = await db
    .from("companies")
    .update({
      omie_app_key: encryptSecret(appKey),
      omie_app_secret: encryptSecret(appSecret),
    })
    .eq("id", params.companyId);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
