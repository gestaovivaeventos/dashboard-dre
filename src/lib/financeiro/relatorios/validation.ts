import type { SupabaseClient } from "@supabase/supabase-js";

import { BI_VALIDATION_EXTRA_EMAILS } from "@/lib/auth/bi-validation";
import {
  buildOnePageReport,
  renderReportEmailHtml,
  reportEmailSubject,
  type MonthRange,
} from "@/lib/financeiro/relatorios/monthly-bi-sender";
import { sendEmailViaResend } from "@/lib/email/resend";
import type { OnePageApiResponse } from "@/lib/financeiro/relatorios/one-page-report-mapper";

// ============================================================================
// Dominio da VALIDACAO MENSAL dos relatorios BI (tela Validação Relatório).
//
// Fluxo: dia 4 gera → CSC valida (aceitar / revisão / adicionar contexto) →
// envio em 1 clique apos o aceite → dia 10 envia automaticamente o que sobrou.
//
// ISOLAMENTO POR EMPRESA (regra crítica):
//   - a linha de validacao guarda `company_id`; o relatorio (`report_json`)
//     foi gerado com esse mesmo `company_id`;
//   - os destinatarios NUNCA vem do client: sao sempre resolvidos aqui, a
//     partir de `validation.company_id`, em bi_report_subscriptions;
//   - o contexto adicionado e gravado com o `company_id` da linha e so entra
//     na regeracao daquela linha.
// Nao existe caminho em que o relatorio de uma empresa alcance o destinatario
// de outra.
//
// Todas as funcoes recebem um client SERVICE-ROLE (`admin`) — os crons rodam
// sem sessao e a tela ja valida a permissao antes de chamar.
// ============================================================================

export const VALIDATION_STATUSES = [
  "pendente_validacao",
  "em_revisao",
  "contexto_adicionado",
  "aceito",
  "enviado_manual",
  "enviado_automatico",
  "erro_envio",
  "erro_geracao",
] as const;

export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

// NOTA: 'em_revisao' é o valor gravado (constraint CHECK da tabela). O RÓTULO
// exibido é "Envio bloqueado" — foi renomeado para dizer o que o estado faz:
// impedir o envio, inclusive o automático do dia 10. Mudar o valor exigiria
// migration e não traria ganho.
export const VALIDATION_STATUS_LABEL: Record<ValidationStatus, string> = {
  pendente_validacao: "Pendente de validação",
  em_revisao: "Envio bloqueado",
  contexto_adicionado: "Contexto adicionado",
  aceito: "Aceito",
  enviado_manual: "Enviado manualmente",
  enviado_automatico: "Enviado automaticamente",
  erro_envio: "Erro no envio",
  erro_geracao: "Erro na geração",
};

/** Status em que o relatorio ainda NAO foi enviado ao gestor. */
export const NOT_SENT_STATUSES: ValidationStatus[] = [
  "pendente_validacao",
  "em_revisao",
  "contexto_adicionado",
  "aceito",
  "erro_envio",
  "erro_geracao",
];

export interface ValidationRow {
  id: string;
  company_id: string;
  period_from: string;
  period_to: string;
  period_label: string;
  status: ValidationStatus;
  version: number;
  report_json: OnePageApiResponse | null;
  generated_at: string | null;
  generation_error: string | null;
  extra_context: string | null;
  accepted_by: string | null;
  accepted_at: string | null;
  review_by: string | null;
  review_at: string | null;
  review_note: string | null;
  sent_at: string | null;
  sent_by: string | null;
  sent_mode: "manual" | "automatico" | null;
  sent_recipients: string[];
  send_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ValidationActor {
  id: string | null;
  label: string;
}

/** Ator "sistema" — usado pelos crons (dias 4 e 10). */
export const SYSTEM_ACTOR: ValidationActor = { id: null, label: "Control Hub (automático)" };

// ─── Log de auditoria ───────────────────────────────────────────────────────

export async function logValidationEvent(
  admin: SupabaseClient,
  params: {
    validationId: string;
    companyId: string;
    action: string;
    actor: ValidationActor;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await admin.from("bi_report_validation_events").insert({
    validation_id: params.validationId,
    company_id: params.companyId,
    action: params.action,
    actor_id: params.actor.id,
    actor_label: params.actor.label,
    detail: params.detail ?? {},
  });
  // Log nunca derruba a operacao principal — mas nao some silenciosamente.
  if (error) console.error("[bi-validation] Falha ao gravar evento:", error.message);
}

// ─── Destinatarios (sempre por empresa) ─────────────────────────────────────

export interface CompanyRecipients {
  companyId: string;
  companyName: string;
  emails: string[];
}

/**
 * Destinatarios cadastrados em Plataforma > Relatório BI para UMA empresa.
 * Descarta assinatura inativa, usuario inativo e empresa inativa — a mesma
 * regra do cron mensal. NAO altera a lista cadastrada; apenas a le.
 */
export async function getCompanyRecipients(
  admin: SupabaseClient,
  companyId: string,
): Promise<CompanyRecipients | null> {
  const { data, error } = await admin
    .from("bi_report_subscriptions")
    .select(
      "company_id, users!bi_report_subscriptions_user_id_fkey(email,active), companies!bi_report_subscriptions_company_id_fkey(id,name,active)",
    )
    .eq("active", true)
    .eq("company_id", companyId);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<{
    company_id: string;
    users: { email: string; active: boolean } | null;
    companies: { id: string; name: string; active: boolean } | null;
  }>;

  const emails = new Set<string>();
  let companyName: string | null = null;
  for (const row of rows) {
    if (!row.users?.active || !row.companies?.active) continue;
    // Blindagem extra: ignora qualquer linha que nao seja da empresa pedida.
    if (row.company_id !== companyId) continue;
    companyName = row.companies.name;
    emails.add(row.users.email);
  }

  if (!companyName) return null;
  return { companyId, companyName, emails: Array.from(emails) };
}

/** Todas as empresas com pelo menos um destinatario ativo cadastrado. */
export async function listCompaniesWithRecipients(
  admin: SupabaseClient,
): Promise<CompanyRecipients[]> {
  const { data, error } = await admin
    .from("bi_report_subscriptions")
    .select(
      "company_id, users!bi_report_subscriptions_user_id_fkey(email,active), companies!bi_report_subscriptions_company_id_fkey(id,name,active,sync_enabled)",
    )
    .eq("active", true);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as unknown as Array<{
    company_id: string;
    users: { email: string; active: boolean } | null;
    companies: {
      id: string;
      name: string;
      active: boolean;
      sync_enabled: boolean | null;
    } | null;
  }>;

  const byCompany = new Map<string, { companyName: string; emails: Set<string> }>();
  for (const row of rows) {
    if (!row.users?.active || !row.companies?.active) continue;
    // Empresa fora do pacote (sync desligado) não entra no ciclo mensal: sem
    // sync, o mês seguinte ao desligamento não tem dado real, então gerar o
    // relatório só produz uma linha vazia para o CSC bloquear todo mês. É o
    // caso da Viva Cuiabá (contrato encerrado em 31/05/2026). `active` NÃO
    // serve para isso — ele controla visibilidade, não o ciclo de dados.
    // null é tratado como ligado (empresas anteriores à coluna).
    if (row.companies.sync_enabled === false) continue;
    const entry =
      byCompany.get(row.company_id) ??
      { companyName: row.companies.name, emails: new Set<string>() };
    entry.emails.add(row.users.email);
    byCompany.set(row.company_id, entry);
  }

  return Array.from(byCompany.entries()).map(([companyId, v]) => ({
    companyId,
    companyName: v.companyName,
    emails: Array.from(v.emails),
  }));
}

// ─── Geracao / regeracao ────────────────────────────────────────────────────

export interface GenerateValidationArgs {
  admin: SupabaseClient;
  companyId: string;
  range: MonthRange;
  actor: ValidationActor;
  /** Contexto de negocio a aplicar na analise da IA (opcional). */
  businessContext?: string | null;
  /**
   * Status a gravar no sucesso. Default "pendente_validacao" (geracao do dia
   * 4). Regeracoes usam "pendente_validacao" tambem — o relatorio volta para a
   * fila de validacao —, exceto quando ha contexto, que marca
   * "contexto_adicionado".
   */
  statusOnSuccess?: ValidationStatus;
  /** Evento a registrar ("gerado" | "regerado" | "contexto_aplicado"). */
  eventAction?: string;
}

export interface GenerateValidationResult {
  ok: boolean;
  validationId?: string;
  error?: string;
}

/**
 * Gera (ou regera) o relatorio de uma empresa/periodo e grava em
 * bi_report_validations. Idempotente por (empresa, periodo): reexecutar
 * atualiza a MESMA linha em vez de criar outra.
 *
 * NUNCA sobrescreve um relatorio ja ENVIADO — meses fechados/validados ficam
 * intactos (regra 13.10).
 */
export async function generateValidationReport({
  admin,
  companyId,
  range,
  actor,
  businessContext,
  statusOnSuccess,
  eventAction,
}: GenerateValidationArgs): Promise<GenerateValidationResult> {
  // Linha existente (se houver) — define versao e trava relatorios ja enviados.
  const { data: existing } = await admin
    .from("bi_report_validations")
    .select("id, version, status, sent_at")
    .eq("company_id", companyId)
    .eq("period_from", range.dateFrom)
    .eq("period_to", range.dateTo)
    .maybeSingle<{ id: string; version: number; status: ValidationStatus; sent_at: string | null }>();

  if (existing?.sent_at) {
    return {
      ok: false,
      validationId: existing.id,
      error: "Relatório já enviado ao gestor — não pode ser regerado.",
    };
  }

  const built = await buildOnePageReport({ admin, companyId, range, businessContext });

  const baseRow = {
    company_id: companyId,
    period_from: range.dateFrom,
    period_to: range.dateTo,
    period_label: range.periodLabel,
  };

  if (!built.ok) {
    const failedRow = {
      ...baseRow,
      status: "erro_geracao" as ValidationStatus,
      generation_error: built.error,
      generated_at: new Date().toISOString(),
      version: existing?.version ?? 1,
    };
    const { data, error } = await admin
      .from("bi_report_validations")
      .upsert(failedRow, { onConflict: "company_id,period_from,period_to" })
      .select("id")
      .single<{ id: string }>();
    if (error) return { ok: false, error: error.message };
    await logValidationEvent(admin, {
      validationId: data.id,
      companyId,
      action: "erro_geracao",
      actor,
      detail: { error: built.error, periodo: range.periodLabel },
    });
    return { ok: false, validationId: data.id, error: built.error };
  }

  const version = existing ? existing.version + 1 : 1;
  const row = {
    ...baseRow,
    status: statusOnSuccess ?? ("pendente_validacao" as ValidationStatus),
    version,
    report_json: built.report as unknown as Record<string, unknown>,
    generated_at: new Date().toISOString(),
    generation_error: null,
    extra_context: businessContext?.trim() || null,
    // Regeracao invalida o aceite anterior: o CSC precisa validar a nova versao.
    accepted_by: null,
    accepted_at: null,
    // ...e encerra a revisao: a nova versao SUPERA o motivo que a originou
    // ("faltou lancar a nota X" deixa de valer depois do ajuste + regeracao).
    // Manter o motivo aqui faria a versao nova nascer parecendo sinalizada.
    // O historico segue em bi_report_validation_events.
    review_by: null,
    review_at: null,
    review_note: null,
    send_error: null,
  };

  const { data, error } = await admin
    .from("bi_report_validations")
    .upsert(row, { onConflict: "company_id,period_from,period_to" })
    .select("id")
    .single<{ id: string }>();

  if (error) return { ok: false, error: error.message };

  await logValidationEvent(admin, {
    validationId: data.id,
    companyId,
    action: eventAction ?? (existing ? "regerado" : "gerado"),
    actor,
    detail: {
      periodo: range.periodLabel,
      versao: version,
      comContexto: Boolean(businessContext?.trim()),
    },
  });

  return { ok: true, validationId: data.id };
}

// ─── Leva mensal (rotina do dia 4 e o botao "Gerar relatórios do mês") ──────

export interface MonthlyRunResult {
  companyId: string;
  companyName: string;
  ok: boolean;
  /** true quando a empresa ja tinha relatorio pronto e foi pulada. */
  skipped?: boolean;
  error?: string;
}

/**
 * Gera a leva do mes para TODAS as empresas com destinatarios cadastrados.
 *
 * Retomavel: por padrao PULA as empresas que ja tem relatorio gerado com
 * sucesso naquele periodo. Isso importa porque cada geracao chama a IA + varias
 * RPCs pesadas — se a invocacao estourar o tempo da Vercel no meio da lista,
 * rodar de novo completa a cauda em vez de refazer tudo do zero (e sem gastar
 * IA de novo com quem ja estava pronto).
 *
 * Cada empresa que falha e retentada UMA vez ao final: a causa mais comum de
 * falha e resposta vazia/transitoria do provedor de IA, que costuma passar na
 * segunda.
 */
export async function runMonthlyGeneration(
  admin: SupabaseClient,
  params: {
    range: MonthRange;
    actor: ValidationActor;
    /** true = regera tudo, inclusive o que ja estava pronto (nunca o enviado). */
    force?: boolean;
  },
): Promise<MonthlyRunResult[]> {
  const { range, actor, force } = params;
  const companies = await listCompaniesWithRecipients(admin);

  // Empresas que ja tem relatorio pronto (ou ja enviado) neste periodo.
  const { data: existingRows } = await admin
    .from("bi_report_validations")
    .select("company_id, status, report_json, sent_at")
    .eq("period_from", range.dateFrom)
    .eq("period_to", range.dateTo);

  const alreadyDone = new Set<string>();
  for (const row of (existingRows ?? []) as Array<{
    company_id: string;
    status: ValidationStatus;
    report_json: unknown;
    sent_at: string | null;
  }>) {
    // Enviado nunca e regerado, nem com force.
    if (row.sent_at) {
      alreadyDone.add(row.company_id);
      continue;
    }
    if (!force && row.report_json && row.status !== "erro_geracao") {
      alreadyDone.add(row.company_id);
    }
  }

  const results: MonthlyRunResult[] = [];
  const retryQueue: CompanyRecipients[] = [];

  // Serial de proposito: cada geracao chama a IA + varias RPCs de agregacao.
  // Em paralelo estouraria o rate limit do provedor e o statement_timeout.
  for (const company of companies) {
    if (alreadyDone.has(company.companyId)) {
      results.push({
        companyId: company.companyId,
        companyName: company.companyName,
        ok: true,
        skipped: true,
      });
      continue;
    }

    const result = await generateValidationReport({
      admin,
      companyId: company.companyId,
      range,
      actor,
      eventAction: "gerado",
    });

    if (result.ok) {
      results.push({ companyId: company.companyId, companyName: company.companyName, ok: true });
    } else {
      retryQueue.push(company);
      results.push({
        companyId: company.companyId,
        companyName: company.companyName,
        ok: false,
        error: result.error,
      });
    }
  }

  // Segunda passada nas falhas. Falha de IA ("resposta vazia do provedor") e
  // tipicamente transitoria; refazer ao final da leva, ja com o provedor mais
  // folgado, resolve a maioria sem intervencao humana.
  for (const company of retryQueue) {
    const retry = await generateValidationReport({
      admin,
      companyId: company.companyId,
      range,
      actor,
      eventAction: "gerado_retry",
    });
    const index = results.findIndex((r) => r.companyId === company.companyId);
    if (index >= 0) {
      results[index] = {
        companyId: company.companyId,
        companyName: company.companyName,
        ok: retry.ok,
        error: retry.ok ? undefined : retry.error,
      };
    }
  }

  return results;
}

// ─── Acoes do CSC: aceitar / revisão / adicionar contexto ───────────────────

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Carrega a linha e recusa qualquer acao sobre relatorio ja enviado. */
async function loadEditableRow(
  admin: SupabaseClient,
  validationId: string,
): Promise<{ ok: true; row: ValidationRow } | { ok: false; error: string }> {
  const { data, error } = await admin
    .from("bi_report_validations")
    .select("*")
    .eq("id", validationId)
    .maybeSingle<ValidationRow>();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Relatório não encontrado." };
  if (data.sent_at) {
    return { ok: false, error: "Relatório já enviado ao gestor — não pode mais ser alterado." };
  }
  return { ok: true, row: data };
}

/** Aceite: registra usuario + data/hora e libera o envio em 1 clique. */
export async function acceptValidation(
  admin: SupabaseClient,
  params: { validationId: string; actor: ValidationActor },
): Promise<ActionResult> {
  const loaded = await loadEditableRow(admin, params.validationId);
  if (!loaded.ok) return loaded;
  if (!loaded.row.report_json) {
    return { ok: false, error: "Relatório sem conteúdo gerado. Gere novamente antes de aceitar." };
  }

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("bi_report_validations")
    .update({
      status: "aceito",
      accepted_by: params.actor.id,
      accepted_at: nowIso,
      // Aceitar ENCERRA a revisão pendente. Limpa também autor e motivo: um
      // relatório aceito não pode continuar exibindo "o que precisa ser
      // revisado" — isso o faria parecer ainda sinalizado. O histórico não se
      // perde: o motivo fica em bi_report_validation_events (action=revisao).
      review_by: null,
      review_at: null,
      review_note: null,
    })
    .eq("id", params.validationId);
  if (error) return { ok: false, error: error.message };

  await logValidationEvent(admin, {
    validationId: params.validationId,
    companyId: loaded.row.company_id,
    action: "aceito",
    actor: params.actor,
    detail: { periodo: loaded.row.period_label, versao: loaded.row.version },
  });
  return { ok: true };
}

/**
 * BLOQUEIO DE ENVIO (exibido como "Bloquear envio" / "Envio bloqueado"; valor
 * gravado: 'em_revisao'). Registra quem/quando/por quê e — este é o ponto —
 * impede o envio AUTOMATICO do dia 10 (ver bi-monthly-autosend). E o unico
 * estado com esse efeito: um relatorio apenas nao-aceito continua saindo no
 * dia 10. Sai do bloqueio ao ser gerado novamente ou aceito.
 */
export async function markValidationForReview(
  admin: SupabaseClient,
  params: { validationId: string; actor: ValidationActor; note?: string | null },
): Promise<ActionResult> {
  const loaded = await loadEditableRow(admin, params.validationId);
  if (!loaded.ok) return loaded;

  const nowIso = new Date().toISOString();
  const { error } = await admin
    .from("bi_report_validations")
    .update({
      status: "em_revisao",
      review_by: params.actor.id,
      review_at: nowIso,
      review_note: params.note?.trim() || null,
      // Revisão invalida o aceite: o envio volta a ficar bloqueado.
      accepted_by: null,
      accepted_at: null,
    })
    .eq("id", params.validationId);
  if (error) return { ok: false, error: error.message };

  await logValidationEvent(admin, {
    validationId: params.validationId,
    companyId: loaded.row.company_id,
    action: "revisao",
    actor: params.actor,
    detail: { periodo: loaded.row.period_label, motivo: params.note?.trim() || null },
  });
  return { ok: true };
}

/**
 * Adicionar contexto: grava o texto no historico (vinculado a empresa e ao
 * relatorio) e REGERA o relatorio pedindo a IA que incorpore o contexto. Os
 * numeros nao mudam — so a leitura textual.
 */
export async function addValidationContext(
  admin: SupabaseClient,
  params: { validationId: string; actor: ValidationActor; context: string },
): Promise<ActionResult> {
  const context = params.context.trim();
  if (!context) return { ok: false, error: "Informe o contexto a ser considerado." };

  const loaded = await loadEditableRow(admin, params.validationId);
  if (!loaded.ok) return loaded;
  const row = loaded.row;

  const { error: ctxError } = await admin.from("bi_report_validation_contexts").insert({
    validation_id: row.id,
    company_id: row.company_id,
    context_text: context,
    created_by: params.actor.id,
  });
  if (ctxError) return { ok: false, error: ctxError.message };

  // Contexto ACUMULA: as observações anteriores continuam valendo na nova
  // versão (o histórico completo fica em bi_report_validation_contexts).
  const merged = [row.extra_context?.trim(), context].filter(Boolean).join("\n\n");

  const regenerated = await generateValidationReport({
    admin,
    companyId: row.company_id,
    range: {
      dateFrom: row.period_from,
      dateTo: row.period_to,
      periodLabel: row.period_label,
    },
    actor: params.actor,
    businessContext: merged,
    statusOnSuccess: "contexto_adicionado",
    eventAction: "contexto_aplicado",
  });

  if (!regenerated.ok) {
    return { ok: false, error: regenerated.error ?? "Falha ao reprocessar o relatório." };
  }

  // Marca a versão em que o contexto entrou.
  const { data: updated } = await admin
    .from("bi_report_validations")
    .select("version")
    .eq("id", row.id)
    .maybeSingle<{ version: number }>();
  if (updated) {
    await admin
      .from("bi_report_validation_contexts")
      .update({ applied_version: updated.version })
      .eq("validation_id", row.id)
      .is("applied_version", null);
  }

  return { ok: true };
}

// ─── Envio ──────────────────────────────────────────────────────────────────

export interface SendValidationArgs {
  admin: SupabaseClient;
  validationId: string;
  mode: "manual" | "automatico";
  actor: ValidationActor;
  appUrl?: string;
  /**
   * Exige aceite previo. `true` no envio manual (so envia o que foi aceito);
   * `false` no cron do dia 10, que envia a versao mais recente disponivel.
   */
  requireAccepted: boolean;
}

export interface SendValidationResult {
  ok: boolean;
  recipients?: string[];
  error?: string;
}

/**
 * Envia o relatorio de UMA linha de validacao para os destinatarios da PROPRIA
 * empresa, via Resend. Registra data/hora, usuario, modo, destinatarios e
 * status (sucesso ou falha).
 *
 * Nunca reenvia um relatorio ja enviado (protecao contra duplicidade entre o
 * envio manual e o cron do dia 10).
 */
export async function sendValidationReport({
  admin,
  validationId,
  mode,
  actor,
  appUrl,
  requireAccepted,
}: SendValidationArgs): Promise<SendValidationResult> {
  const { data: row, error } = await admin
    .from("bi_report_validations")
    .select("*")
    .eq("id", validationId)
    .maybeSingle<ValidationRow>();

  if (error) return { ok: false, error: error.message };
  if (!row) return { ok: false, error: "Relatório não encontrado." };

  if (row.sent_at) {
    return { ok: false, error: "Relatório já enviado — envio duplicado bloqueado." };
  }
  if (!row.report_json) {
    return { ok: false, error: "Relatório sem conteúdo gerado. Gere novamente antes de enviar." };
  }
  if (requireAccepted && !row.accepted_at) {
    return { ok: false, error: "Relatório ainda não foi aceito." };
  }

  // Destinatarios SEMPRE derivados da empresa da linha — nunca do caller.
  let recipients: CompanyRecipients | null = null;
  try {
    recipients = await getCompanyRecipients(admin, row.company_id);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Falha ao carregar destinatários.",
    };
  }

  if (!recipients || recipients.emails.length === 0) {
    const message =
      "Nenhum destinatário ativo cadastrado para esta empresa em Plataforma > Relatório BI.";
    await admin
      .from("bi_report_validations")
      .update({ status: "erro_envio", send_error: message })
      .eq("id", validationId);
    await logValidationEvent(admin, {
      validationId,
      companyId: row.company_id,
      action: "erro_envio",
      actor,
      detail: { modo: mode, error: message },
    });
    return { ok: false, error: message };
  }

  const html = renderReportEmailHtml(row.report_json, appUrl);
  const subject = reportEmailSubject(recipients.companyName, row.period_label);

  const result = await sendEmailViaResend({
    to: recipients.emails,
    subject,
    html,
  });

  const nowIso = new Date().toISOString();

  if (!result.ok) {
    const message = result.error ?? "Falha desconhecida no envio.";
    await admin
      .from("bi_report_validations")
      .update({ status: "erro_envio", send_error: message, sent_mode: mode })
      .eq("id", validationId);
    await logValidationEvent(admin, {
      validationId,
      companyId: row.company_id,
      action: "erro_envio",
      actor,
      detail: { modo: mode, destinatarios: recipients.emails, error: message },
    });
    // Registro no historico de relatorios, mesmo padrao do cron mensal.
    await admin.from("ai_reports").insert({
      type: "one-page-monthly",
      company_ids: [row.company_id],
      period_from: row.period_from,
      period_to: row.period_to,
      content_html: "",
      content_json: {},
      recipients: recipients.emails,
      status: "error",
      error_message: message,
    });
    return { ok: false, error: message };
  }

  await admin
    .from("bi_report_validations")
    .update({
      status: mode === "manual" ? "enviado_manual" : "enviado_automatico",
      sent_at: nowIso,
      sent_by: actor.id,
      sent_mode: mode,
      sent_recipients: recipients.emails,
      send_error: null,
    })
    .eq("id", validationId);

  await logValidationEvent(admin, {
    validationId,
    companyId: row.company_id,
    action: mode === "manual" ? "enviado_manual" : "enviado_automatico",
    actor,
    detail: {
      modo: mode,
      destinatarios: recipients.emails,
      periodo: row.period_label,
      versao: row.version,
    },
  });

  await admin.from("ai_reports").insert({
    type: "one-page-monthly",
    company_ids: [row.company_id],
    period_from: row.period_from,
    period_to: row.period_to,
    content_html: html,
    content_json: row.report_json as unknown as Record<string, unknown>,
    recipients: recipients.emails,
    sent_at: nowIso,
    status: "sent",
  });

  return { ok: true, recipients: recipients.emails };
}

// ─── Pendencia / notificacao para o CSC ─────────────────────────────────────

/**
 * Cria a pendencia de validacao como notificacao do Control Hub para os
 * usuarios do perfil CSC (e para os admins ativos, que tambem enxergam a
 * tela). Best-effort: falha aqui nao derruba a rotina do dia 4.
 */
export async function notifyCscPendingValidation(
  admin: SupabaseClient,
  params: { periodLabel: string; total: number },
): Promise<number> {
  if (params.total <= 0) return 0;

  const { data, error } = await admin
    .from("users")
    .select("id, profile, role, email")
    .eq("active", true);

  if (error) {
    console.error("[bi-validation] Falha ao carregar destinatários da pendência:", error.message);
    return 0;
  }

  // Mesmo conjunto da tela: perfil CSC, admins e os e-mails nominais.
  const targets = (data ?? []).filter((u) => {
    const profile = (u.profile as string | null) ?? null;
    const email = String(u.email ?? "").trim().toLowerCase();
    return (
      profile === "csc" ||
      profile === "admin" ||
      u.role === "admin" ||
      BI_VALIDATION_EXTRA_EMAILS.has(email)
    );
  });

  if (targets.length === 0) return 0;

  const title = "Relatórios BI pendentes de validação";
  const message =
    `${params.total} relatório(s) de ${params.periodLabel} foram gerados e aguardam validação ` +
    "em Financeiro > Validação Relatório. Sem aceite até o dia 10, o envio aos gestores é automático.";

  const { error: insertError } = await admin.from("ctrl_notifications").insert(
    targets.map((u) => ({
      user_id: u.id as string,
      title,
      message,
      type: "bi_validacao",
    })),
  );

  if (insertError) {
    console.error("[bi-validation] Falha ao criar notificações:", insertError.message);
    return 0;
  }

  return targets.length;
}
