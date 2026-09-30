import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { agruparDetalheOrcado } from "@/lib/orcamento/budget-detalhe";

/**
 * O que foi ORÇADO numa conta — a abertura por nome de despesa.
 *
 * O Budget soma por conta (`reprocess.ts` agrega `budget_uploads_raw` por
 * `dre_account_id`), então o nome da despesa se perde no caminho. Esta rota lê
 * a abertura que a FINALIZAÇÃO guardou ao lado, em `orcamento_budget_detalhe`.
 * Nada aqui entra em número nenhum do Financeiro — é só leitura.
 *
 * ── Autorização ────────────────────────────────────────────────────────────
 * Quem abre o Budget é do FINANCEIRO e pode não ter o módulo Orçamento, então
 * o gate é o mesmo das outras rotas do dashboard (`resolveAllowedCompanyIds`) e
 * a leitura usa o admin client depois dele — mesmo enquadramento das páginas
 * de /contratos e do Caixa. A RLS da tabela (que exige o módulo Orçamento)
 * continua valendo como segunda linha de defesa para acesso direto.
 */
export async function GET(request: Request) {
  const { supabase, user, profile } = await getCurrentSessionContext();
  if (!user) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const url = new URL(request.url);
  const accountId = url.searchParams.get("accountId");
  const year = Number(url.searchParams.get("year") ?? "");
  const monthFrom = Number(url.searchParams.get("monthFrom") ?? "1");
  const monthTo = Number(url.searchParams.get("monthTo") ?? "12");
  const requestedCompanyIds =
    url.searchParams.get("companyIds")?.split(",").filter(Boolean) ?? [];

  if (!accountId || !Number.isInteger(year)) {
    return NextResponse.json(
      { error: "Parâmetros obrigatórios: accountId, year." },
      { status: 400 },
    );
  }

  const { data: companiesData } = await supabase.from("companies").select("id,name");
  const allCompanyIds = (companiesData ?? []).map((c) => c.id as string);
  const companyNameById = new Map(
    (companiesData ?? []).map((c) => [c.id as string, c.name as string]),
  );
  const allowedCompanyIds = await resolveAllowedCompanyIds(supabase, profile, allCompanyIds);
  const scoped =
    requestedCompanyIds.length > 0
      ? requestedCompanyIds.filter((id) => allowedCompanyIds.includes(id))
      : allowedCompanyIds;
  if (scoped.length === 0) return NextResponse.json({ itens: [], total: 0 });

  const db = createAdminClientIfAvailable() ?? supabase;
  const { data, error } = await db
    .from("orcamento_budget_detalhe")
    .select("company_id, nome, valor, month")
    .eq("year", year)
    .eq("dre_account_id", accountId)
    .in("company_id", scoped)
    .gte("month", Math.max(1, monthFrom))
    .lte("month", Math.min(12, monthTo));

  if (error) {
    // Migration pendente: a tela mostra "nada finalizado ainda" em vez de erro.
    if (/does not exist|schema cache/i.test(error.message)) {
      return NextResponse.json({ itens: [], total: 0 });
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  const itens = agruparDetalheOrcado(
    (data ?? []) as Array<{ company_id: string; nome: string; valor: number | string }>,
    (id) => companyNameById.get(id) ?? "",
    scoped.length > 1,
  );
  return NextResponse.json({
    itens,
    total: itens.reduce((a, i) => a + i.valor, 0),
  });
}
