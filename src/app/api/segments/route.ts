import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveUserSegments } from "@/lib/context/user-segments";

export async function GET() {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }

  // Fonte única (resolveUserSegments): admin vê todos; os demais recebem a
  // UNIÃO de user_segment_access com os segmentos derivados das empresas em
  // user_company_access — evita sub-reportar segmentos de quem tem acesso
  // explícito a um só + empresas em outros segmentos.
  const segments = await resolveUserSegments(supabase, {
    isAdmin: profile.role === "admin",
    userId: user.id,
    companyIds: profile.company_ids ?? [],
  });

  return NextResponse.json({ segments });
}
