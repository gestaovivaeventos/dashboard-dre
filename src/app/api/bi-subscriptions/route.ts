import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";

// ============================================================================
// /api/bi-subscriptions — gestao das assinaturas do relatorio BI mensal.
// Admin-only. Cada assinatura vincula um usuario a uma empresa; o cron
// /api/cron/monthly-bi-report envia o One Page Report do mes anterior para
// os assinantes no dia 5.
// ============================================================================

async function requireAdmin() {
  const ctx = await getCurrentSessionContext();
  if (!ctx.user || !ctx.profile) {
    return { error: NextResponse.json({ error: "Nao autenticado." }, { status: 401 }) };
  }
  if (ctx.profile.role !== "admin") {
    return { error: NextResponse.json({ error: "Acesso restrito." }, { status: 403 }) };
  }
  return { ctx };
}

export async function GET() {
  const { ctx, error } = await requireAdmin();
  if (error) return error;

  const { data, error: dbError } = await ctx.supabase
    .from("bi_report_subscriptions")
    .select("id, user_id, company_id, active, created_at, users!bi_report_subscriptions_user_id_fkey(name,email), companies!bi_report_subscriptions_company_id_fkey(name)")
    .order("created_at", { ascending: false });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 400 });
  }

  const subscriptions = (data ?? []).map((row) => {
    const user = row.users as unknown as { name: string | null; email: string } | null;
    const company = row.companies as unknown as { name: string } | null;
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      company_id: row.company_id as string,
      active: Boolean(row.active),
      created_at: row.created_at as string,
      user_name: user?.name ?? null,
      user_email: user?.email ?? "",
      company_name: company?.name ?? "",
    };
  });

  return NextResponse.json({ subscriptions });
}

interface CreateBody {
  user_id?: string;
  company_ids?: string[];
}

export async function POST(request: Request) {
  const { ctx, error } = await requireAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as CreateBody;
  const { user_id, company_ids } = body;

  if (!user_id || !company_ids || company_ids.length === 0) {
    return NextResponse.json(
      { error: "Campos obrigatorios: user_id, company_ids (lista nao vazia)." },
      { status: 400 },
    );
  }

  const rows = company_ids.map((company_id) => ({
    user_id,
    company_id,
    active: true,
    created_by: ctx.profile!.id,
  }));

  // Upsert pelo par (user_id, company_id): reativa assinatura desativada
  // em vez de falhar no unique constraint.
  const { error: dbError } = await ctx.supabase
    .from("bi_report_subscriptions")
    .upsert(rows, { onConflict: "user_id,company_id" });

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

interface DeleteBody {
  id?: string;
}

export async function DELETE(request: Request) {
  const { ctx, error } = await requireAdmin();
  if (error) return error;

  const body = (await request.json().catch(() => ({}))) as DeleteBody;
  if (!body.id) {
    return NextResponse.json({ error: "Campo obrigatorio: id." }, { status: 400 });
  }

  const { error: dbError } = await ctx.supabase
    .from("bi_report_subscriptions")
    .delete()
    .eq("id", body.id);

  if (dbError) {
    return NextResponse.json({ error: dbError.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
