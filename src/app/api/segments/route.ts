import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  // Admin sees all segments; others see only assigned segments
  if (profile.role === "admin") {
    const { data, error } = await supabase
      .from("segments")
      .select("id,name,slug,display_order,active")
      .eq("active", true)
      .order("display_order");

    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ segments: data });
  }

  const { data, error } = await supabase
    .from("user_segment_access")
    .select("segment_id, segments(id,name,slug,display_order,active)")
    .eq("user_id", user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const segments = (data ?? [])
    .map((row) => (row as unknown as { segments: { id: string; name: string; slug: string; display_order: number; active: boolean } }).segments)
    .filter((s) => s && s.active)
    .sort((a, b) => a.display_order - b.display_order);

  return NextResponse.json({ segments });
}
