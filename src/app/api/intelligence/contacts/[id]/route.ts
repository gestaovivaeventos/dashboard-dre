import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

interface Params {
  params: { id: string };
}

export async function DELETE(request: Request, { params }: Params) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const { id } = params;

  if (!id) {
    return NextResponse.json({ error: "ID do contato obrigatorio." }, { status: 400 });
  }

  const { error } = await supabase
    .from("company_contacts")
    .update({ active: false })
    .eq("id", id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
