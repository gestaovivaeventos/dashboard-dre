import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json()) as {
    updates?: Array<{ id: string; sort_order: number }>;
  };

  const updates = body.updates ?? [];
  if (updates.length === 0) {
    return NextResponse.json({ ok: true });
  }

  for (const item of updates) {
    const { error } = await supabase
      .from("dre_accounts")
      .update({ sort_order: item.sort_order })
      .eq("id", item.id);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  return NextResponse.json({ ok: true });
}
