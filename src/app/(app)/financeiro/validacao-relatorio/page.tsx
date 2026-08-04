import { redirect } from "next/navigation";

import { ValidacaoRelatorioClient } from "@/components/financeiro/relatorios/ValidacaoRelatorioClient";
import type { ValidacaoRelatorioItem } from "@/components/financeiro/relatorios/ValidacaoRelatorioClient";
import { canAccessBiValidation } from "@/lib/auth/bi-validation";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { getPreviousMonthRange } from "@/lib/financeiro/relatorios/monthly-bi-sender";
import type { ValidationStatus } from "@/lib/financeiro/relatorios/validation";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// /financeiro/validacao-relatorio  — tela "Validação Relatório"
//
// O CSC valida aqui os relatórios BI mensais ANTES do envio aos gestores das
// unidades. Cada linha é uma empresa × período, com o relatório gerado
// automaticamente no dia 4.
//
// Acesso (whitelist fechada — ver @/lib/auth/bi-validation):
//   perfil CSC · Admin · marcela@quokka.net.br · marcelo@quokka.net.br
//
// A leitura usa service-role porque a tela é a autoridade de permissão (o RLS
// de bi_report_validations replica a mesma regra como defesa em profundidade).
// ============================================================================

export const dynamic = "force-dynamic";

interface ValidationDbRow {
  id: string;
  company_id: string;
  period_from: string;
  period_to: string;
  period_label: string;
  status: ValidationStatus;
  version: number;
  generated_at: string | null;
  generation_error: string | null;
  extra_context: string | null;
  accepted_at: string | null;
  accepted_by: string | null;
  review_at: string | null;
  review_by: string | null;
  review_note: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_mode: "manual" | "automatico" | null;
  sent_recipients: string[] | null;
  send_error: string | null;
}

export default async function ValidacaoRelatorioPage() {
  const { user, profile } = await getCurrentSessionContext();
  if (!user) redirect("/login");
  if (!canAccessBiValidation(profile)) redirect("/home");

  const admin = createAdminClient();

  // Marca como lidas as notificações de pendência deste usuário — a pendência
  // se resolve exatamente aqui, então o sino não deve continuar aceso.
  if (profile?.id) {
    await admin
      .from("ctrl_notifications")
      .update({ is_read: true })
      .eq("user_id", profile.id)
      .eq("type", "bi_validacao")
      .eq("is_read", false);
  }

  // Períodos disponíveis (mais recentes primeiro) + o período ativo (default:
  // mês anterior, que é o gerado no dia 4).
  const { data: rowsData, error } = await admin
    .from("bi_report_validations")
    .select(
      "id, company_id, period_from, period_to, period_label, status, version, generated_at, generation_error, extra_context, accepted_at, accepted_by, review_at, review_by, review_note, sent_at, sent_by, sent_mode, sent_recipients, send_error",
    )
    .order("period_from", { ascending: false })
    .limit(500);

  const rows = (rowsData ?? []) as ValidationDbRow[];

  // Nomes de empresa e de usuário resolvidos em lote (evita N+1).
  const companyIds = Array.from(new Set(rows.map((r) => r.company_id)));
  const userIds = Array.from(
    new Set(
      rows
        .flatMap((r) => [r.accepted_by, r.review_by, r.sent_by])
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [{ data: companiesData }, { data: usersData }, { data: subsData }] =
    await Promise.all([
      companyIds.length > 0
        ? admin.from("companies").select("id,name").in("id", companyIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
      userIds.length > 0
        ? admin.from("users").select("id,name,email").in("id", userIds)
        : Promise.resolve({ data: [] as Array<{ id: string; name: string | null; email: string }> }),
      admin
        .from("bi_report_subscriptions")
        .select(
          "company_id, users!bi_report_subscriptions_user_id_fkey(email,active), companies!bi_report_subscriptions_company_id_fkey(active)",
        )
        .eq("active", true),
    ]);

  const companyName = new Map(
    (companiesData ?? []).map((c) => [c.id as string, c.name as string]),
  );
  const userLabel = new Map(
    (usersData ?? []).map((u) => [
      u.id as string,
      ((u.name as string | null)?.trim() || (u.email as string)) as string,
    ]),
  );

  // Destinatários por empresa — exibidos na linha para o CSC conferir ANTES de
  // enviar (a lista em si é gerenciada em Plataforma > Relatório BI).
  const recipientsByCompany = new Map<string, string[]>();
  for (const row of (subsData ?? []) as unknown as Array<{
    company_id: string;
    users: { email: string; active: boolean } | null;
    companies: { active: boolean } | null;
  }>) {
    if (!row.users?.active || !row.companies?.active) continue;
    const list = recipientsByCompany.get(row.company_id) ?? [];
    if (!list.includes(row.users.email)) list.push(row.users.email);
    recipientsByCompany.set(row.company_id, list);
  }

  const items: ValidacaoRelatorioItem[] = rows.map((r) => ({
    id: r.id,
    companyId: r.company_id,
    companyName: companyName.get(r.company_id) ?? "(empresa removida)",
    periodFrom: r.period_from,
    periodTo: r.period_to,
    periodLabel: r.period_label,
    status: r.status,
    version: r.version,
    generatedAt: r.generated_at,
    generationError: r.generation_error,
    hasContext: Boolean(r.extra_context?.trim()),
    acceptedAt: r.accepted_at,
    acceptedBy: r.accepted_by ? (userLabel.get(r.accepted_by) ?? null) : null,
    reviewAt: r.review_at,
    reviewBy: r.review_by ? (userLabel.get(r.review_by) ?? null) : null,
    reviewNote: r.review_note,
    sentAt: r.sent_at,
    sentBy: r.sent_by ? (userLabel.get(r.sent_by) ?? null) : null,
    sentMode: r.sent_mode,
    sentRecipients: r.sent_recipients ?? [],
    sendError: r.send_error,
    recipients: recipientsByCompany.get(r.company_id) ?? [],
  }));

  const defaultPeriod =
    items[0]?.periodLabel ?? getPreviousMonthRange(new Date()).periodLabel;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-4 p-4 sm:p-6">
      <ValidacaoRelatorioClient
        items={items}
        defaultPeriod={defaultPeriod}
        loadError={error?.message ?? null}
      />
    </div>
  );
}
