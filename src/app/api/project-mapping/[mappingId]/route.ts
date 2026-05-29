import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ mappingId: string }> },
) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const { mappingId } = await params;
  if (!mappingId) {
    return NextResponse.json({ error: "Informe mappingId." }, { status: 400 });
  }

  const { error } = await supabase.from("project_mapping").delete().eq("id", mappingId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true });
}
