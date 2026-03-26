import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/security/encryption";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

export async function GET() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode acessar." }, { status: 403 });
  }

  const db = createAdminClientIfAvailable() ?? supabase;
  const { data, error } = await db
    .from("companies")
    .select("id,name,active,created_at,omie_app_key,omie_app_secret")
    .order("name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const companies = (data ?? []).map((company) => ({
    id: company.id as string,
    name: company.name as string,
    active: company.active as boolean,
    created_at: company.created_at as string,
    has_credentials: Boolean(company.omie_app_key && company.omie_app_secret),
  }));

  return NextResponse.json({ companies });
}

export async function POST(request: Request) {
  try {
    const { supabase, user, profile } = await getCurrentSessionContext();
    if (!user) {
      return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
    }
    if (!profile || profile.role !== "admin") {
      return NextResponse.json({ error: "Apenas admin pode cadastrar empresas." }, { status: 403 });
    }

    const body = (await request.json()) as {
      name?: string;
      appKey?: string;
      appSecret?: string;
    };
    const name = body.name?.trim();
    const appKey = body.appKey?.trim();
    const appSecret = body.appSecret?.trim();

    if (!name || !appKey || !appSecret) {
      return NextResponse.json(
        { error: "Informe nome, app key e app secret." },
        { status: 400 },
      );
    }

    const db = createAdminClientIfAvailable() ?? supabase;
    const { data, error } = await db
      .from("companies")
      .insert({
        name,
        omie_app_key: encryptSecret(appKey),
        omie_app_secret: encryptSecret(appSecret),
        active: true,
      })
      .select("id,name,active,created_at")
      .single();

    if (error) {
      if (error.code === "42501") {
        return NextResponse.json(
          {
            error:
              "Permissao negada no RLS da tabela companies. Aplique a migration de policies admin ou configure SUPABASE_SERVICE_ROLE_KEY.",
          },
          { status: 403 },
        );
      }
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Ja existe uma empresa com esse nome." },
          { status: 409 },
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      company: {
        ...data,
        has_credentials: true,
      },
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Falha inesperada ao cadastrar empresa.";
    if (
      message.includes("ENCRYPTION_KEY") ||
      message.includes("APP_SECRETS_ENCRYPTION_KEY") ||
      message.includes("SUPABASE_SERVICE_ROLE_KEY")
    ) {
      return NextResponse.json({ error: message }, { status: 500 });
    }
    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 },
    );
  }
}
