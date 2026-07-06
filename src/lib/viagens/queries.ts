import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  ViagemConfigRow,
  ViagemModal,
  ViagemQuoteRow,
  ViagemRequestDetail,
  ViagemRequestListRow,
} from "@/lib/viagens/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

export async function getViagemRequests(): Promise<ViagemRequestListRow[]> {
  const db = await getDb();
  const { data } = await db
    .from("viagem_requests")
    .select(
      `id, request_number, origem, destino, data_ida, data_volta, passageiros,
       status, monitorar, created_at, users!viagem_requests_created_by_fkey(name),
       viagem_quotes(total)`,
    )
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((r) => {
    const totals = ((r.viagem_quotes ?? []) as Array<{ total: number }>)
      .map((q) => Number(q.total))
      .filter((t) => t > 0);
    return {
      id: r.id,
      request_number: r.request_number,
      origem: r.origem,
      destino: r.destino,
      data_ida: r.data_ida,
      data_volta: r.data_volta,
      passageiros: r.passageiros,
      status: r.status,
      monitorar: Boolean(r.monitorar),
      created_by_name: r.users?.name ?? "—",
      created_at: r.created_at,
      melhor_total: totals.length ? Math.min(...totals) : null,
    };
  });
}

export async function getViagemRequestDetail(id: string): Promise<ViagemRequestDetail | null> {
  const db = await getDb();
  const { data: r } = await db
    .from("viagem_requests")
    .select(
      `id, request_number, origem, destino, data_ida, data_volta, janela_flex_dias,
       passageiros, modo_carro, incluir_hospedagem, monitorar, observacao, status,
       chosen_quote_id, approved_at, rejected_reason, reservado_em, created_by, created_at,
       creator:users!viagem_requests_created_by_fkey(name),
       approver:users!viagem_requests_approved_by_fkey(name)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!r) return null;

  const [{ data: quotes }, { data: snapshots }, { data: history }] = await Promise.all([
    db
      .from("viagem_quotes")
      .select(
        "id, modal, provider, titulo, detalhes, custo_transporte, custo_hospedagem, custo_traslados, custo_alimentacao, custo_taxas, total, booking_link, selected, captured_at",
      )
      .eq("request_id", id)
      .order("total"),
    db
      .from("viagem_price_snapshots")
      .select("modal, total, captured_at")
      .eq("request_id", id)
      .order("captured_at", { ascending: false })
      .limit(60),
    db
      .from("viagem_history")
      .select("action, comment, created_at, users(name)")
      .eq("request_id", id)
      .order("created_at", { ascending: false })
      .limit(30),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rr = r as any;
  return {
    id: rr.id,
    request_number: rr.request_number,
    origem: rr.origem,
    destino: rr.destino,
    data_ida: rr.data_ida,
    data_volta: rr.data_volta,
    janela_flex_dias: rr.janela_flex_dias,
    passageiros: rr.passageiros,
    modo_carro: rr.modo_carro,
    incluir_hospedagem: Boolean(rr.incluir_hospedagem),
    monitorar: Boolean(rr.monitorar),
    observacao: rr.observacao,
    status: rr.status,
    chosen_quote_id: rr.chosen_quote_id,
    approved_by_name: rr.approver?.name ?? null,
    approved_at: rr.approved_at,
    rejected_reason: rr.rejected_reason,
    reservado_em: rr.reservado_em,
    created_by: rr.created_by,
    created_by_name: rr.creator?.name ?? "—",
    created_at: rr.created_at,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    quotes: ((quotes ?? []) as any[]).map(mapQuote),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    snapshots: ((snapshots ?? []) as any[]).map((s) => ({
      modal: s.modal as ViagemModal,
      total: Number(s.total),
      captured_at: s.captured_at,
    })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    history: ((history ?? []) as any[]).map((h) => ({
      action: h.action,
      comment: h.comment,
      user_name: h.users?.name ?? null,
      created_at: h.created_at,
    })),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapQuote(q: any): ViagemQuoteRow {
  return {
    id: q.id,
    modal: q.modal,
    provider: q.provider,
    titulo: q.titulo,
    detalhes: q.detalhes ?? null,
    custo_transporte: Number(q.custo_transporte),
    custo_hospedagem: Number(q.custo_hospedagem),
    custo_traslados: Number(q.custo_traslados),
    custo_alimentacao: Number(q.custo_alimentacao),
    custo_taxas: Number(q.custo_taxas),
    total: Number(q.total),
    booking_link: q.booking_link,
    selected: Boolean(q.selected),
    captured_at: q.captured_at,
  };
}

const CONFIG_DEFAULTS: ViagemConfigRow = {
  rate_per_km: 1.8,
  aluguel_diaria: 150,
  preco_combustivel_litro: 6.2,
  consumo_km_litro: 11,
  tarifa_onibus_km: 0.42,
  diaria_alimentacao: 80,
  hotel_diaria_padrao: 250,
};

export async function getViagemConfig(): Promise<ViagemConfigRow> {
  const db = await getDb();
  const { data } = await db.from("viagem_config").select("*").eq("id", 1).maybeSingle();
  if (!data) return CONFIG_DEFAULTS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = data as any;
  return {
    rate_per_km: Number(d.rate_per_km),
    aluguel_diaria: Number(d.aluguel_diaria),
    preco_combustivel_litro: Number(d.preco_combustivel_litro),
    consumo_km_litro: Number(d.consumo_km_litro),
    tarifa_onibus_km: Number(d.tarifa_onibus_km),
    diaria_alimentacao: Number(d.diaria_alimentacao),
    hotel_diaria_padrao: Number(d.hotel_diaria_padrao),
  };
}
