import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { syncSirenaSheetsToManualValues } from "@/lib/sheets/sirena-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "Apenas admins podem disparar este sync." }, { status: 403 });
  }

  try {
    const result = await syncSirenaSheetsToManualValues();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha inesperada ao sincronizar planilha da Sirena.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
