import { type NextRequest, NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code");
  const rawNext = requestUrl.searchParams.get("next") ?? "/dashboard";
  // Só caminho interno: "https://evil" ou "//evil" resolveriam para fora do app.
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") && !rawNext.startsWith("/\\")
      ? rawNext
      : "/dashboard";

  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(new URL(next, requestUrl.origin));
}
