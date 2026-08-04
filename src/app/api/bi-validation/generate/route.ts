import { NextResponse } from "next/server";

import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { getPreviousMonthRange } from "@/lib/financeiro/relatorios/monthly-bi-sender";
import {
  notifyCscPendingValidation,
  runMonthlyGeneration,
  type ValidationActor,
} from "@/lib/financeiro/relatorios/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// POST /api/bi-validation/generate
//
// Dispara MANUALMENTE a mesma leva da rotina do dia 4: monta o relatório do mês
// anterior de CADA empresa com destinatários cadastrados em
// Plataforma > Relatório BI e coloca tudo na fila de validação.
//
// Por padrão só COMPLETA a leva — empresas que já têm relatório pronto no
// período são puladas (não faz sentido gastar IA de novo). É assim que se
// recupera de uma geração parcial ou de falhas pontuais do dia 4. Para refazer
// uma empresa específica, use "Gerar novamente" na linha dela; para refazer a
// leva inteira, envie `{ "force": true }`.
//
// Relatórios JÁ ENVIADOS nunca são regerados, nem com force.
//
// Acesso: CSC, admin e os e-mails nominais.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

interface Body {
  force?: boolean;
}

export async function POST(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!canAccessBiValidation(profile)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as Body;
  const admin = createAdminClient();
  const range = getPreviousMonthRange(new Date());
  const actor: ValidationActor = {
    id: profile.id,
    label: profile.name?.trim() || profile.email,
  };

  let results;
  try {
    results = await runMonthlyGeneration(admin, {
      range,
      actor,
      force: body.force === true,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Falha ao gerar a leva do mês." },
      { status: 400 },
    );
  }

  const generated = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;

  if (generated > 0) {
    await notifyCscPendingValidation(admin, {
      periodLabel: range.periodLabel,
      total: generated,
    });
  }

  return NextResponse.json({
    ok: failed === 0,
    period: range.periodLabel,
    companies: results.length,
    generated,
    skipped,
    failed,
    results,
  });
}
