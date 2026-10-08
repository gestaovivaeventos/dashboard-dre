import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAllowedCompanyIds } from "@/lib/dashboard/dre";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import {
  agruparDetalheOrcado,
  contarDespesas,
  totalDoDetalhe,
  type LinhaDetalheOrcado,
} from "@/lib/orcamento/budget-detalhe";
import { sourceFinalizacao } from "@/lib/orcamento/finalizacao";

/**
 * O que foi ORÇADO numa conta — a abertura por nome de despesa.
 *
 * O Budget soma por conta (`reprocess.ts` agrega `budget_uploads_raw` por
 * `dre_account_id`), então o nome da despesa se perde no caminho. Esta rota lê
 * a abertura que a FINALIZAÇÃO guardou ao lado, em `orcamento_budget_detalhe`.
 * Nada aqui entra em número nenhum do Financeiro — é só leitura.
 *
 * ── A lista sai por SETOR (08/10/2026) ─────────────────────────────────────
 * Numa conta que vários setores alimentam, a lista corrida dizia quanto foi
 * orçado sem dizer por quem. O setor não está na linha do detalhe: ele vive na
 * `source` da fatia, e é reconstruído aqui com a MESMA `sourceFinalizacao` que o
 * escritor usou — parsear a string daria um segundo entendimento da chave.
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
    .select("company_id, nome, valor, month, source")
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

  // ── source → setor ──
  // A chave inclui a EMPRESA: `orc:pessoal:-:-` é idêntica em toda empresa que não
  // orça por setor, e sem ela duas empresas cairiam no mesmo grupo.
  const setorIdPorFatia = new Map<string, string | null>();
  const { data: finRows } = await db
    .from("orcamento_finalizacoes")
    .select("company_id, metodo, category_code, setor_id")
    .eq("year", year)
    .in("company_id", scoped);
  for (const r of (finRows ?? []) as Array<Record<string, unknown>>) {
    const source = sourceFinalizacao({
      metodo: r.metodo as never,
      categoryCode: ((r.category_code as string | null) ?? "").trim(),
      setorId: (r.setor_id as string | null) ?? null,
    });
    setorIdPorFatia.set(`${r.company_id as string}|${source}`, (r.setor_id as string | null) ?? null);
  }

  const setorIds = Array.from(
    new Set(Array.from(setorIdPorFatia.values()).filter((v): v is string => Boolean(v))),
  );
  const nomeDoSetor = new Map<string, string>();
  if (setorIds.length > 0) {
    const { data: setorRows } = await db
      .from("orcamento_setores")
      .select("id, name")
      .in("id", setorIds);
    for (const r of setorRows ?? []) nomeDoSetor.set(r.id as string, (r.name as string) ?? "");
  }

  const comEmpresa = scoped.length > 1;
  const linhas = (data ?? []) as LinhaDetalheOrcado[];
  const grupos = agruparDetalheOrcado(linhas, {
    setorDaLinha: (l) => {
      const setorId = setorIdPorFatia.get(`${l.company_id}|${l.source ?? ""}`) ?? null;
      // Fatia não encontrada (reaberta no meio da leitura, ou linha antiga) cai no
      // mesmo balde de "empresa sem setor": o valor continua à vista, que é o que
      // importa — sumir com ele faria o total do drilldown não bater com a conta.
      const base = setorId ? nomeDoSetor.get(setorId) || "Setor removido" : "Sem setor";
      const empresa = comEmpresa ? companyNameById.get(l.company_id) ?? "" : "";
      return { rotulo: empresa ? `${base} · ${empresa}` : base, semSetor: !setorId };
    },
  });

  return NextResponse.json({
    grupos,
    total: totalDoDetalhe(grupos),
    despesas: contarDespesas(grupos),
  });
}
