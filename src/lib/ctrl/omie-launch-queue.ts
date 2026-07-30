import type { SupabaseClient } from "@supabase/supabase-js";

import { launchRequestToOmie } from "@/lib/ctrl/actions/contapagar-launch";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

/**
 * Espaçamento mínimo entre dois lançamentos na MESMA empresa pagadora.
 *
 * A Omie bloqueia por "consumo redundante" (proteção contra duplicidade)
 * chamadas equivalentes repetidas dentro de ~40s — era isso que derrubava o
 * envio em massa. A janela é por conta Omie, então empresas pagadoras
 * diferentes não precisam esperar uma pela outra.
 */
export const OMIE_LAUNCH_SPACING_MS = 50_000;

/** Reserva sem conclusão por mais que isso = função morreu no meio; devolve à fila. */
const ORPHAN_MINUTES = 10;

export interface DrainResult {
  launched: number;
  failed: number;
  /** Empresas puladas por causa do espaçamento (voltam no próximo minuto). */
  throttled: number;
  remaining: number;
}

interface QueuedRow {
  id: string;
  paying_company_id: string;
  /** `undefined` enquanto a migration 20260730120000 não tiver sido aplicada. */
  omie_previsao_codigo?: number | null;
}

/**
 * Drena a fila de lançamento no Omie: no máximo UMA requisição por empresa
 * pagadora a cada execução. Com o cron rodando de minuto em minuto isso dá
 * ~60s entre lançamentos da mesma empresa, folgado sobre a janela da Omie.
 *
 * O ritmo é derivado do banco (`omie_launched_at`), não de `sleep` em memória:
 * duas execuções sobrepostas do cron continuam respeitando o espaçamento.
 */
export async function drainOmieLaunchQueue(db: DB): Promise<DrainResult> {
  const agora = Date.now();

  // Requisições reservadas que nunca concluíram voltam para a fila.
  const orphanCutoff = new Date(agora - ORPHAN_MINUTES * 60_000).toISOString();
  await db
    .from("ctrl_requests")
    .update({ omie_launched_at: null })
    .eq("omie_launch_status", "pendente")
    .not("omie_launched_at", "is", null)
    .lt("omie_launched_at", orphanCutoff);

  // Fila: aprovadas, marcadas como 'pendente' e ainda não reservadas.
  // `select("*")` de propósito: listar `omie_previsao_codigo` explicitamente
  // derrubaria a leitura inteira (42703) enquanto a migration 20260730120000
  // não estiver aplicada, e a fila pararia por causa de um campo opcional.
  const { data: fila, error: filaErr } = await db
    .from("ctrl_requests")
    .select("*")
    .eq("status", "aprovado")
    .eq("omie_launch_status", "pendente")
    .is("omie_launched_at", null)
    .is("deleted_at", null)
    .not("paying_company_id", "is", null)
    .order("sent_to_payment_at", { ascending: true, nullsFirst: true })
    .limit(200);

  // Falha de leitura não pode virar "fila vazia" silenciosa — o lote sumiria
  // sem rastro. Propaga para o cron registrar o erro.
  if (filaErr) throw new Error(`Falha ao ler a fila de lançamento: ${filaErr.message}`);

  const pendentes = (fila ?? []) as QueuedRow[];
  if (pendentes.length === 0) {
    return { launched: 0, failed: 0, throttled: 0, remaining: 0 };
  }

  // Uma por empresa pagadora nesta rodada.
  const proximaPorEmpresa = new Map<string, QueuedRow>();
  for (const row of pendentes) {
    if (!proximaPorEmpresa.has(row.paying_company_id)) {
      proximaPorEmpresa.set(row.paying_company_id, row);
    }
  }

  let launched = 0;
  let failed = 0;
  let throttled = 0;

  for (const [companyId, row] of Array.from(proximaPorEmpresa.entries())) {
    if (!(await podeLancarAgora(db, companyId))) {
      throttled++;
      continue;
    }

    // Reserva antes da chamada externa. O par de filtros garante que uma
    // execução concorrente do cron não pegue a mesma requisição.
    const { data: reservada } = await db
      .from("ctrl_requests")
      .update({ omie_launched_at: new Date().toISOString() })
      .eq("id", row.id)
      .eq("omie_launch_status", "pendente")
      .is("omie_launched_at", null)
      .select("id");

    if (!reservada || reservada.length === 0) continue; // outra execução pegou

    try {
      const res = await launchRequestToOmie(
        db,
        row.id,
        companyId,
        row.omie_previsao_codigo ?? undefined,
      );

      if ("error" in res) {
        // launchRequestToOmie já gravou omie_launch_status = 'erro'.
        // Reafirmamos para cobrir os erros de pré-lançamento (mapeamento
        // incompleto), que retornam antes de qualquer escrita.
        await db
          .from("ctrl_requests")
          .update({
            omie_launch_status: "erro",
            omie_launch_error: res.error,
            updated_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        failed++;
        continue;
      }

      // Lançou: sai de "Aguardando Envio" e vai para "Enviados".
      // A previsão só é limpa se estava preenchida — assim o update não depende
      // da migration 20260730120000 quando ninguém usou essa opção.
      const conclusao: Record<string, unknown> = {
        status: "agendado",
        updated_at: new Date().toISOString(),
      };
      if (row.omie_previsao_codigo != null) conclusao.omie_previsao_codigo = null;

      await db.from("ctrl_requests").update(conclusao).eq("id", row.id);
      launched++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[omie-queue] falha ao lançar requisição", row.id, msg);
      await db
        .from("ctrl_requests")
        .update({
          omie_launch_status: "erro",
          omie_launch_error: msg.slice(0, 2000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return {
    launched,
    failed,
    throttled,
    remaining: Math.max(0, pendentes.length - launched - failed),
  };
}

/** Último lançamento desta empresa foi há mais de OMIE_LAUNCH_SPACING_MS? */
async function podeLancarAgora(db: DB, companyId: string): Promise<boolean> {
  const { data } = await db
    .from("ctrl_requests")
    .select("omie_launched_at")
    .eq("paying_company_id", companyId)
    .not("omie_launched_at", "is", null)
    .order("omie_launched_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const ultimo = data?.omie_launched_at as string | null | undefined;
  if (!ultimo) return true;
  return Date.now() - new Date(ultimo).getTime() >= OMIE_LAUNCH_SPACING_MS;
}
