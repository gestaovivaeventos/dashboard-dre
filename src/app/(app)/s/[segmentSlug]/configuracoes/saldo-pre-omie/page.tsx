import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { SettingsPreOmieBalances } from "@/components/app/settings-pre-omie-balances";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ segmentSlug: string }>;
}

export default async function SaldoPreOmiePage({ params }: PageProps) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!profile || profile.role !== "admin") redirect("/dashboard");

  const { segmentSlug } = await params;

  // O saldo pré-Omie é por EMPRESA (independe de segmento) — lista TODAS as
  // empresas. Lê com admin client depois do gate: `companies` tem RLS por
  // user_company_access e um admin sem vínculo perderia linhas (mesmo motivo do
  // módulo Caixa).
  const db = createAdminClientIfAvailable() ?? supabase;

  const { data: companiesData } = await db
    .from("companies")
    .select("id, name, active")
    .order("name");
  const companies = (companiesData ?? []).map((c) => ({
    id: c.id as string,
    name: c.name as string,
    active: Boolean(c.active),
  }));

  const { data: balData } = await db
    .from("cash_flow_opening_balances")
    .select("company_id, amount")
    .eq("period_year", 2022)
    .eq("period_month", 1);
  const initial: Record<string, number> = {};
  (balData ?? []).forEach((b) => {
    initial[b.company_id as string] = Number(b.amount);
  });

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/s/${segmentSlug}/configuracoes`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Configurações
        </Link>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Saldo anterior ao Omie</h1>
        <p className="text-muted-foreground">
          Saldo inicial de caixa de cada empresa em <strong>janeiro/2022</strong>, o corte da
          migração do sistema Mundo Viva para a Omie. O Fluxo de Caixa parte desse valor e encadeia
          os meses seguintes; empresa sem valor começa em zero.
        </p>
      </div>

      <SettingsPreOmieBalances companies={companies} initial={initial} />
    </div>
  );
}
