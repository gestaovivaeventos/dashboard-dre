import type { SupabaseClient } from "@supabase/supabase-js";

import { estimateRouteFacts } from "@/lib/viagens/providers/ai-estimator";
import {
  amadeusConfigured,
  searchCheapestFlight,
  searchHotelRate,
} from "@/lib/viagens/providers/amadeus";
import { buildQuotes, type RealFlightByAirport } from "@/lib/viagens/cost";
import { getViagemConfig } from "@/lib/viagens/queries";
import { notifyViagemAprovadores, notifyViagemUser } from "@/lib/viagens/notifications";
import type { ViagemModoCarro } from "@/lib/viagens/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

const ORPHAN_MINUTES = 10;

interface RequestRow {
  id: string;
  request_number: number;
  origem: string;
  destino: string;
  data_ida: string;
  data_volta: string;
  janela_flex_dias: number;
  passageiros: number;
  modo_carro: ViagemModoCarro;
  incluir_hospedagem: boolean;
  monitorar: boolean;
  status: string;
  created_by: string;
}

export interface ProcessResult {
  processed: number;
  failed: number;
}

/**
 * Drena a fila de buscas (viagem_search_runs) — padrão do contracts/process-batch:
 * time-budget pra sair limpo antes do teto da Vercel, runs órfãs varridas pra
 * 'failed', e cada run reservada ('processing') antes do trabalho externo.
 */
export async function processPendingSearchRuns(
  db: DB,
  opts: { maxRuns?: number; timeBudgetMs?: number } = {},
): Promise<ProcessResult> {
  const started = Date.now();
  const timeBudgetMs = opts.timeBudgetMs ?? 250_000;
  const maxRuns = opts.maxRuns ?? 10;
  const timeIsUp = () => Date.now() - started > timeBudgetMs;

  // Varre runs órfãs (processing antigas — função morreu no meio).
  const orphanCutoff = new Date(Date.now() - ORPHAN_MINUTES * 60_000).toISOString();
  await db
    .from("viagem_search_runs")
    .update({ status: "failed", error_log: "orphaned: run exceeded max duration", finished_at: new Date().toISOString() })
    .eq("status", "processing")
    .lt("started_at", orphanCutoff);

  let processed = 0;
  let failed = 0;

  for (let i = 0; i < maxRuns && !timeIsUp(); i++) {
    const { data: run } = await db
      .from("viagem_search_runs")
      .select("id, request_id, kind")
      .eq("status", "pending")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (!run) break;

    // Reserva a run antes da chamada externa (resumibilidade).
    const { data: reserved } = await db
      .from("viagem_search_runs")
      .update({ status: "processing", started_at: new Date().toISOString() })
      .eq("id", run.id)
      .eq("status", "pending")
      .select("id");
    if (!reserved || reserved.length === 0) continue; // outra instância pegou

    try {
      await executeSearchRun(db, run.request_id as string, run.kind as string);
      await db
        .from("viagem_search_runs")
        .update({ status: "completed", finished_at: new Date().toISOString() })
        .eq("id", run.id);
      processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[viagens] search run failed", run.id, msg);
      await db
        .from("viagem_search_runs")
        .update({ status: "failed", error_log: msg.slice(0, 2000), finished_at: new Date().toISOString() })
        .eq("id", run.id);
      if (run.kind === "inicial") {
        await db.from("viagem_requests").update({ status: "erro", updated_at: new Date().toISOString() }).eq("id", run.request_id);
      }
      failed++;
    }
  }

  return { processed, failed };
}

/** Executa a busca de uma requisição: levanta fatos, cota real quando possível, grava as 3 cotações. */
async function executeSearchRun(db: DB, requestId: string, kind: string): Promise<void> {
  const { data: req } = await db
    .from("viagem_requests")
    .select(
      "id, request_number, origem, destino, data_ida, data_volta, janela_flex_dias, passageiros, modo_carro, incluir_hospedagem, monitorar, status, created_by",
    )
    .eq("id", requestId)
    .maybeSingle();
  if (!req) throw new Error("Requisição não encontrada.");
  const r = req as RequestRow;

  // Requisição já decidida — monitor run não deve sobrescrever nada.
  if (["aprovado", "reservado", "concluido", "rejeitado", "cancelado"].includes(r.status) && kind === "monitor") {
    return;
  }

  const config = await getViagemConfig();

  // 1) Fatos da rota (distância, pedágios, preços típicos) via agente IA.
  const facts = await estimateRouteFacts({
    origem: r.origem,
    destino: r.destino,
    dataIda: r.data_ida,
    dataVolta: r.data_volta,
  });

  // 2) Preços reais quando o Amadeus estiver configurado — cota CADA aeroporto
  //    de partida candidato (ex.: JF → IZA, GIG e CNF) até o destino.
  const realFlights: RealFlightByAirport = {};
  let hotelRealDiaria: number | null = null;
  let hotelRealNome: string | null = null;

  if (amadeusConfigured() && facts.aeroporto_destino) {
    const destinoIata = facts.aeroporto_destino.iata;
    for (const candidate of (facts.aeroportos_origem ?? []).slice(0, 4)) {
      const flight = await searchCheapestFlight({
        origemIata: candidate.iata,
        destinoIata,
        dataIda: r.data_ida,
        dataVolta: r.data_volta,
        janelaFlexDias: r.janela_flex_dias,
        passageiros: r.passageiros,
      });
      if (flight) {
        realFlights[candidate.iata] = {
          totalGrupo: flight.totalBrl,
          dataIda: flight.dataIda,
          dataVolta: flight.dataVolta,
          companhia: flight.companhia,
        };
      }
    }
    if (r.incluir_hospedagem) {
      const hotel = await searchHotelRate({
        cityCode: destinoIata,
        checkIn: r.data_ida,
        checkOut: r.data_volta,
        adults: r.passageiros,
      });
      if (hotel) {
        hotelRealDiaria = hotel.diariaMediaBrl;
        hotelRealNome = hotel.hotelNome;
      }
    }
  }

  // 3) Monta os 3 orçamentos porta-a-porta.
  const quotes = buildQuotes({
    origem: r.origem,
    destino: r.destino,
    dataIda: r.data_ida,
    dataVolta: r.data_volta,
    passageiros: r.passageiros,
    modoCarro: r.modo_carro,
    incluirHospedagem: r.incluir_hospedagem,
    config,
    facts,
    realFlights,
    hotelRealDiaria,
    hotelRealNome,
  });

  // Melhor total anterior (pra detectar queda de preço no monitoramento).
  const { data: prevQuotes } = await db
    .from("viagem_quotes")
    .select("modal, total")
    .eq("request_id", requestId);
  const prevBest = ((prevQuotes ?? []) as Array<{ total: number }>)
    .map((q) => Number(q.total))
    .filter((t) => t > 0)
    .reduce((min, t) => Math.min(min, t), Infinity);

  // 4) Grava cotações (upsert por modal) + snapshots.
  const now = new Date().toISOString();
  for (const q of quotes) {
    if (!q.viavel) {
      // Modal inviável (sem voo/ônibus na rota): remove cotação anterior se houver.
      await db.from("viagem_quotes").delete().eq("request_id", requestId).eq("modal", q.modal);
      continue;
    }
    await db.from("viagem_quotes").upsert(
      {
        request_id: requestId,
        modal: q.modal,
        provider: q.provider,
        titulo: q.titulo,
        detalhes: q.detalhes,
        custo_transporte: q.custo_transporte,
        custo_hospedagem: q.custo_hospedagem,
        custo_traslados: q.custo_traslados,
        custo_alimentacao: q.custo_alimentacao,
        custo_taxas: q.custo_taxas,
        total: q.total,
        booking_link: q.booking_link,
        captured_at: now,
      },
      { onConflict: "request_id,modal" },
    );
    await db.from("viagem_price_snapshots").insert({
      request_id: requestId,
      modal: q.modal,
      total: q.total,
      captured_at: now,
    });
  }

  const viaveis = quotes.filter((q) => q.viavel);
  if (viaveis.length === 0) throw new Error("Nenhum modal viável encontrado para a rota.");
  const newBest = Math.min(...viaveis.map((q) => q.total));

  // 5) Atualiza status + notifica.
  if (kind === "inicial") {
    await db
      .from("viagem_requests")
      .update({ status: "cotado", updated_at: now })
      .eq("id", requestId);
    await db.from("viagem_history").insert({
      request_id: requestId,
      action: "cotado",
      metadata: { melhor_total: newBest, modais: viaveis.map((q) => q.modal) },
    });
    await notifyViagemAprovadores(db, {
      requestId,
      title: `Viagem #${r.request_number} cotada`,
      message: `${r.origem} → ${r.destino}: 3 orçamentos prontos (melhor: R$ ${newBest.toFixed(2)}). Escolha uma opção.`,
    });
  } else {
    // Monitor: alerta em queda de preço relevante (>2%).
    if (Number.isFinite(prevBest) && newBest < prevBest * 0.98) {
      await db.from("viagem_history").insert({
        request_id: requestId,
        action: "queda_preco",
        metadata: { de: prevBest, para: newBest },
      });
      const msg = `${r.origem} → ${r.destino}: melhor orçamento caiu de R$ ${prevBest.toFixed(2)} para R$ ${newBest.toFixed(2)}.`;
      await notifyViagemAprovadores(db, {
        requestId,
        title: `Preço caiu — viagem #${r.request_number}`,
        message: msg,
        type: "queda_preco",
      });
      await notifyViagemUser(db, {
        userId: r.created_by,
        requestId,
        title: `Preço caiu — viagem #${r.request_number}`,
        message: msg,
        type: "queda_preco",
      });
    }
  }
}

/**
 * Enfileira re-cotações (monitoramento contínuo) para requisições com
 * monitorar=true ainda não decididas e sem re-cotação nas últimas ~20h.
 */
export async function enqueueMonitorRuns(db: DB): Promise<number> {
  const { data: requests } = await db
    .from("viagem_requests")
    .select("id")
    .eq("monitorar", true)
    .in("status", ["cotado"]);
  if (!requests || requests.length === 0) return 0;

  const cutoff = new Date(Date.now() - 20 * 3600_000).toISOString();
  let enqueued = 0;
  for (const r of requests as Array<{ id: string }>) {
    // Sem run recente (pending/processing/completed nas últimas 20h)?
    const { data: recent } = await db
      .from("viagem_search_runs")
      .select("id")
      .eq("request_id", r.id)
      .or(`status.in.(pending,processing),and(status.eq.completed,finished_at.gte.${cutoff})`)
      .limit(1);
    if (recent && recent.length > 0) continue;
    await db.from("viagem_search_runs").insert({ request_id: r.id, kind: "monitor" });
    enqueued++;
  }
  return enqueued;
}
