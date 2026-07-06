import type { ViagemConfigRow, ViagemModal, ViagemModoCarro } from "@/lib/viagens/types";
import type { RouteFacts } from "@/lib/viagens/providers/ai-estimator";

export interface QuoteBreakdown {
  modal: ViagemModal;
  provider: string;
  titulo: string;
  detalhes: Record<string, unknown>;
  custo_transporte: number;
  custo_hospedagem: number;
  custo_traslados: number;
  custo_alimentacao: number;
  custo_taxas: number;
  total: number;
  booking_link: string | null;
  /** false quando o modal não é viável na rota (sem voo/ônibus). */
  viavel: boolean;
}

export interface BuildQuotesInput {
  origem: string;
  destino: string;
  dataIda: string;
  dataVolta: string;
  passageiros: number;
  modoCarro: ViagemModoCarro;
  incluirHospedagem: boolean;
  config: ViagemConfigRow;
  facts: RouteFacts;
  /** Preço real de voo (Amadeus) — sobrepõe a estimativa quando presente. */
  vooRealTotal?: number | null;
  vooRealInfo?: { dataIda: string; dataVolta: string; companhia: string | null } | null;
  /** Diária real de hotel (Amadeus) — sobrepõe a estimativa quando presente. */
  hotelRealDiaria?: number | null;
  hotelRealNome?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

/**
 * Monta os 3 orçamentos (carro, ônibus, avião) com breakdown completo.
 * Custos comuns a todos os modais: hospedagem (noites × diária × quartos) e
 * alimentação (dias × diária × passageiros). O que muda é transporte + traslados.
 */
export function buildQuotes(input: BuildQuotesInput): QuoteBreakdown[] {
  const { config, facts } = input;
  const noites = Math.max(0, daysBetween(input.dataIda, input.dataVolta));
  const dias = noites + 1;
  const quartos = Math.max(1, Math.ceil(input.passageiros / 2));
  const hotelDiaria = input.hotelRealDiaria ?? facts.hotel_diaria_media ?? config.hotel_diaria_padrao;

  const hospedagem = input.incluirHospedagem ? round2(noites * hotelDiaria * quartos) : 0;
  const alimentacao = round2(dias * config.diaria_alimentacao * input.passageiros);

  const distIdaVolta = facts.distancia_km * 2;
  const pedagiosIdaVolta = round2(facts.pedagios_brl * 2);

  // ── Carro — dois modelos, configurável por viagem ─────────────────────
  const custoKm = round2(distIdaVolta * config.rate_per_km + pedagiosIdaVolta);
  const combustivel = round2((distIdaVolta / Math.max(config.consumo_km_litro, 1)) * config.preco_combustivel_litro);
  const custoAluguel = round2(dias * config.aluguel_diaria + combustivel + pedagiosIdaVolta);

  let carroTransporte: number;
  let carroModelo: string;
  if (input.modoCarro === "km") {
    carroTransporte = custoKm;
    carroModelo = "reembolso_km";
  } else if (input.modoCarro === "aluguel") {
    carroTransporte = custoAluguel;
    carroModelo = "aluguel";
  } else {
    carroTransporte = Math.min(custoKm, custoAluguel);
    carroModelo = custoKm <= custoAluguel ? "reembolso_km" : "aluguel";
  }

  const carro: QuoteBreakdown = {
    modal: "carro",
    provider: "estimativa",
    titulo: `Carro (${carroModelo === "reembolso_km" ? "reembolso por km" : "aluguel"}) — ${Math.round(facts.distancia_km)} km/trecho`,
    detalhes: {
      modelo: carroModelo,
      distancia_km_trecho: facts.distancia_km,
      pedagios_ida_volta: pedagiosIdaVolta,
      duracao_horas_trecho: facts.duracao_carro_horas,
      custo_reembolso_km: custoKm,
      custo_aluguel: custoAluguel,
      rate_per_km: config.rate_per_km,
    },
    custo_transporte: carroTransporte,
    custo_hospedagem: hospedagem,
    custo_traslados: 0,
    custo_alimentacao: alimentacao,
    custo_taxas: 0,
    total: round2(carroTransporte + hospedagem + alimentacao),
    booking_link: null,
    viavel: facts.distancia_km > 0,
  };

  // ── Ônibus ────────────────────────────────────────────────────────────
  const onibusPp =
    facts.preco_onibus_pp_ida_volta ?? round2(distIdaVolta * config.tarifa_onibus_km);
  const onibusTransporte = round2(onibusPp * input.passageiros);
  const onibusTraslados = round2(60 * 2); // táxi/app rodoviária, ida e volta (estimativa fixa)
  const onibus: QuoteBreakdown = {
    modal: "onibus",
    provider: "estimativa",
    titulo: `Ônibus — ${facts.duracao_onibus_horas ? `${Math.round(facts.duracao_onibus_horas)}h/trecho` : "rodoviário"}`,
    detalhes: {
      preco_pp_ida_volta: onibusPp,
      duracao_horas_trecho: facts.duracao_onibus_horas,
      tem_linha: facts.tem_onibus,
    },
    custo_transporte: onibusTransporte,
    custo_hospedagem: hospedagem,
    custo_traslados: onibusTraslados,
    custo_alimentacao: alimentacao,
    custo_taxas: 0,
    total: round2(onibusTransporte + hospedagem + onibusTraslados + alimentacao),
    booking_link: null,
    viavel: facts.tem_onibus,
  };

  // ── Avião ─────────────────────────────────────────────────────────────
  const vooReal = input.vooRealTotal != null && input.vooRealTotal > 0;
  const vooTotalGrupo = vooReal
    ? round2(input.vooRealTotal!)
    : facts.preco_voo_pp_ida_volta != null
      ? round2(facts.preco_voo_pp_ida_volta * input.passageiros)
      : 0;
  const aviaoTraslados = round2(120 * 2); // aeroporto ↔ centro, ida e volta (estimativa fixa)
  const rotaIata =
    facts.aeroporto_origem && facts.aeroporto_destino
      ? `${facts.aeroporto_origem}→${facts.aeroporto_destino}`
      : null;
  const aviao: QuoteBreakdown = {
    modal: "aviao",
    provider: vooReal ? "amadeus" : "estimativa",
    titulo: `Avião${rotaIata ? ` ${rotaIata}` : ""}${input.vooRealInfo?.companhia ? ` (${input.vooRealInfo.companhia})` : ""}`,
    detalhes: {
      rota: rotaIata,
      preco_real: vooReal,
      datas_otimizadas: input.vooRealInfo ? { ida: input.vooRealInfo.dataIda, volta: input.vooRealInfo.dataVolta } : null,
      duracao_voo_horas: facts.duracao_voo_horas,
      hotel: input.hotelRealNome ?? null,
    },
    custo_transporte: vooTotalGrupo,
    custo_hospedagem: hospedagem,
    custo_traslados: aviaoTraslados,
    custo_alimentacao: alimentacao,
    custo_taxas: 0,
    total: round2(vooTotalGrupo + hospedagem + aviaoTraslados + alimentacao),
    booking_link: buildFlightLink(input, facts),
    viavel: facts.tem_voo_comercial && vooTotalGrupo > 0,
  };

  return [carro, onibus, aviao];
}

/** Link de busca do Google Flights (checkout manual). */
function buildFlightLink(input: BuildQuotesInput, facts: RouteFacts): string | null {
  if (!facts.tem_voo_comercial) return null;
  const o = facts.aeroporto_origem ?? input.origem;
  const d = facts.aeroporto_destino ?? input.destino;
  const q = encodeURIComponent(`voos de ${o} para ${d} ${input.dataIda} volta ${input.dataVolta}`);
  return `https://www.google.com/travel/flights?q=${q}`;
}
