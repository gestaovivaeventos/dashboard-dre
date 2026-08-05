import { NextResponse } from "next/server";

import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/bi-validation/[id]/contextos
//
// Histórico dos contextos de negócio adicionados a UM relatório (empresa ×
// período) na tela "Validação Relatório": o que foi escrito, por quem, quando
// e em qual versão do relatório aquele texto entrou.
//
// Rota separada do GET do relatório de propósito: o histórico precisa abrir
// mesmo quando `report_json` está vazio (erro de geração) e mesmo depois do
// envio, e não deve carregar o `report_json` inteiro só para listar textos.
//
// ISOLAMENTO: o client informa apenas o ID da linha. A empresa vem da própria
// linha e é aplicada como segundo filtro na consulta dos contextos — o mesmo
// par (validation_id, company_id) gravado em addValidationContext.
// ============================================================================

export const runtime = "nodejs";

interface ContextRow {
  id: string;
  context_text: string;
  applied_version: number | null;
  created_by: string | null;
  created_at: string;
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (!canAccessBiValidation(profile)) {
    return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
  }

  const admin = createAdminClient();

  const { data: validation, error: validationError } = await admin
    .from("bi_report_validations")
    .select("id, company_id, period_label, version")
    .eq("id", params.id)
    .maybeSingle<{
      id: string;
      company_id: string;
      period_label: string;
      version: number;
    }>();

  if (validationError) {
    return NextResponse.json({ error: validationError.message }, { status: 400 });
  }
  if (!validation) {
    return NextResponse.json({ error: "Relatório não encontrado." }, { status: 404 });
  }

  const { data, error } = await admin
    .from("bi_report_validation_contexts")
    .select("id, context_text, applied_version, created_by, created_at")
    .eq("validation_id", validation.id)
    .eq("company_id", validation.company_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  const rows = (data ?? []) as ContextRow[];

  // Autores resolvidos em lote (evita N+1) — nome, com fallback no e-mail.
  const authorIds = Array.from(
    new Set(rows.map((r) => r.created_by).filter((id): id is string => Boolean(id))),
  );
  const { data: usersData } = authorIds.length
    ? await admin.from("users").select("id,name,email").in("id", authorIds)
    : { data: [] as Array<{ id: string; name: string | null; email: string }> };

  const authorLabel = new Map(
    (usersData ?? []).map((u) => [
      u.id as string,
      ((u.name as string | null)?.trim() || (u.email as string)) as string,
    ]),
  );

  return NextResponse.json({
    id: validation.id,
    periodLabel: validation.period_label,
    currentVersion: validation.version,
    contexts: rows.map((r) => ({
      id: r.id,
      text: r.context_text,
      appliedVersion: r.applied_version,
      createdAt: r.created_at,
      authorLabel: r.created_by
        ? (authorLabel.get(r.created_by) ?? "Usuário removido")
        : "Control Hub (automático)",
    })),
  });
}
