import { NextResponse } from "next/server";

import { getCaixaUser } from "@/lib/caixa/auth";
import {
  listCaixaCompanies,
  refreshCompanyBalances,
  syncCompanyAccounts,
} from "@/lib/caixa/sync";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
// Uma EMPRESA por requisição. A maior vista até aqui (Terrazzo, 11 contas)
// levou 27s; 120s dá folga larga sem chegar perto do teto da Vercel.
export const maxDuration = 120;

/**
 * POST /api/caixa/sync — varre UMA empresa.
 *
 * Body: { kind: "cadastro" | "saldos", companyId }
 *
 * - "cadastro" → ListarContasCorrentes (1 chamada Omie), descobre contas novas
 * - "saldos"   → ListarExtrato por conta ativa (a parte lenta)
 *
 * Deliberadamente NÃO varre o grupo inteiro numa requisição: a tela chama isto
 * empresa a empresa para mostrar progresso e para que a falha de uma unidade
 * não perca o trabalho das outras. A varredura completa em uma tacada existe
 * só no cron (runCaixaSweep, com paralelismo por empresa).
 */
export async function POST(request: Request) {
  const user = await getCaixaUser();
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  let body: { kind?: string; companyId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const kind = body.kind;
  if (kind !== "cadastro" && kind !== "saldos") {
    return NextResponse.json({ error: 'kind deve ser "cadastro" ou "saldos".' }, { status: 400 });
  }
  if (!body.companyId) {
    return NextResponse.json({ error: "Informe companyId." }, { status: 400 });
  }

  try {
    const admin = createAdminClient();
    const companies = await listCaixaCompanies(admin);
    const company = companies.find((c) => c.id === body.companyId);
    if (!company) {
      return NextResponse.json(
        { error: "Empresa sem credencial Omie ou inativa." },
        { status: 404 },
      );
    }

    const result =
      kind === "cadastro"
        ? await syncCompanyAccounts(admin, company)
        : await refreshCompanyBalances(admin, company, "manual");

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha na sincronização.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
