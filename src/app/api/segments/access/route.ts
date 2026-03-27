import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// GET: list segment access for a user (admin only)
export async function GET(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId obrigatorio." }, { status: 400 });
  }

  const adminClient = createAdminClient();
  const { data, error } = await adminClient
    .from("user_segment_access")
    .select("segment_id")
    .eq("user_id", userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const segmentIds = (data ?? []).map((row) => row.segment_id);
  return NextResponse.json({ segmentIds });
}

// POST: set segment access for a user (admin only) — replaces all existing access
export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as { userId: string; segmentIds: string[] };
  if (!body.userId || !Array.isArray(body.segmentIds)) {
    return NextResponse.json({ error: "userId e segmentIds[] obrigatorios." }, { status: 400 });
  }

  const adminClient = createAdminClient();

  // Delete existing access
  const { error: deleteError } = await adminClient
    .from("user_segment_access")
    .delete()
    .eq("user_id", body.userId);

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 });

  // Insert new access
  if (body.segmentIds.length > 0) {
    const rows = body.segmentIds.map((segmentId) => ({
      user_id: body.userId,
      segment_id: segmentId,
    }));
    const { error: insertError } = await adminClient
      .from("user_segment_access")
      .insert(rows);

    if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
