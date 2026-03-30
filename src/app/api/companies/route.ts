import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { encryptSecret } from "@/lib/security/encryption";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admin pode acessar." }, { status: 403 });
  }

  const url = new URL(request.url);
  const segmentId = url.searchParams.get("segmentId");

  const db = createAdminClientIfAvailable() ?? supabase;
  let query = db
    .from("companies")
    .select("id,name,active,created_at,omie_app_key,omie_app_secret");
  if (segmentId) {
    query = query.eq("segment_id", segmentId);
  }
  const { data, error } = await query.order("name");

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
      segmentId?: string | null;
    };
    const name = body.name?.trim();
    const appKey = body.appKey?.trim();
    const appSecret = body.appSecret?.trim();
    const segmentId = body.segmentId?.trim() ?? null;

    if (!name) {
      return NextResponse.json(
        { error: "Informe o nome da empresa." },
        { status: 400 },
      );
    }

    const db = createAdminClientIfAvailable() ?? supabase;
    const insertData: Record<string, unknown> = {
      name,
      active: true,
    };
    if (appKey && appSecret) {
      insertData.omie_app_key = encryptSecret(appKey);
      insertData.omie_app_secret = encryptSecret(appSecret);
    }
    if (segmentId) {
      insertData.segment_id = segmentId;
    }

    const { data, error } = await db
      .from("companies")
      .insert(insertData)
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
        has_credentials: Boolean(appKey && appSecret),
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
