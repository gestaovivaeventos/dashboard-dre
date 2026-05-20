import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

import { getCurrentSessionContext } from "@/lib/auth/session";

// Lazy-forks the global DRE plan into a per-company plan when an admin starts
// customizing the structure of a specific company. Idempotent: if the company
// already has a custom plan, this is a no-op.
export async function POST(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Nao autenticado." }, { status: 401 });
  }
  if (profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { companyId?: string };
  const companyId = body.companyId;

  if (!companyId) {
    return NextResponse.json({ error: "companyId e obrigatorio." }, { status: 400 });
  }

  const { count, error: countError } = await supabase
    .from("dre_accounts")
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 400 });
  }

  if ((count ?? 0) > 0) {
    return NextResponse.json({ ok: true, forked: false, alreadyCustom: true });
  }

  const { data: forked, error: forkError } = await supabase.rpc(
    "dre_accounts_fork_to_company",
    { p_company_id: companyId },
  );

  if (forkError) {
    return NextResponse.json(
      { error: `Falha ao iniciar plano customizado: ${forkError.message}` },
      { status: 400 },
    );
  }

  revalidatePath("/(app)", "layout");
  return NextResponse.json({ ok: true, forked: true, copied: forked ?? 0 });
}
