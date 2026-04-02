import { NextResponse } from "next/server";
import { getCurrentSessionContext } from "@/lib/auth/session";

export async function GET(request: Request) {
  const { supabase, user } = await getCurrentSessionContext();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });

  // Check account 5 in the database
  const { data: account5 } = await supabase
    .from("dre_accounts")
    .select("id,code,name,type,is_summary,formula")
    .eq("code", "5")
    .single();

  return NextResponse.json({ account5 });
}
