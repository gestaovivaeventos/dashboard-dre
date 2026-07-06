import type { ViagemConfigRow, ViagemModal, ViagemModoCarro } from "@/lib/viagens/types";
import type { AirportOption, RouteFacts } from "@/lib/viagens/providers/ai-estimator";

/** Linha exibível do orçamento (label + valor), gravada em detalhes.linhas. */
export interface QuoteLine {
  label: string;
  valor: number;
}

/** Alternativa de aeroporto avaliada (gravada em detalhes.alternativas do avião). */
export interface FlightAlternative {
  iata: string;
  nome: string;
  transfer_modo: string;
  transfer_total: number;
  voo_total: number;
  total_porta_a_porta: number;
  preco_real: boolean;
  escolhida: boolean;
}

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
  viavel: boolean;
}

/** Preço real (Amadeus) por aeroporto de partida — chave = IATA. */
export interface RealFlightByAirport {
  [iata: string]: { totalGrupo: number; dataIda: string; dataVolta: string; companhia: string | null };
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
  realFlights?: RealFlightByAirport;
  hotelRealDiaria?: number | null;
  hotelRealNome?: string | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtBRL = (n: number) => `R$ ${n.toFixed(2).replace(".", ",")}`;

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(`${b}T12:00:00Z`).getTime() - new Date(`${a}T12:00:00Z`).getTime()) / 86_400_000);
}

/**
 * Monta os 3 orçamentos porta-a-porta com breakdown completo:
 * - Carro: gasolina (litros × preço atual), pedágios detalhados, comparação
 *   reembolso-por-km × aluguel.
 * - Ônibus: passagem + uber casa↔rodoviária nas duas pontas.
 * - Avião: avalia TODOS os aeroportos de partida viáveis (ex.: JF → IZA, GIG,
 *   CNF), somando transfer terrestre + voo + uber aeroporto↔centro no destino,
 *   e escolhe o melhor total porta-a-porta.
 * Custos comuns: hospedagem e alimentação.
 */
export function buildQuotes(input: BuildQuotesInput): QuoteBreakdown[] {
  const { config, facts } = input;
  const noites = Math.max(0, daysBetween(input.dataIda, input.dataVolta));
  const dias = noites + 1;
  const quartos = Math.max(1, Math.ceil(input.passageiros / 2));
  const hotelDiaria = input.hotelRealDiaria ?? facts.hotel_diaria_media ?? config.hotel_diaria_padrao;

  const hospedagem = input.incluirHospedagem ? round2(noites * hotelDiaria * quartos) : 0;
  const alimentacao = round2(dias * config.diaria_alimentacao * input.passageiros);
  const linhasComuns: QuoteLine[] = [];
  if (hospedagem > 0) linhasComuns.push({ label: `Hotel: ${noites} noites × ${fmtBRL(hotelDiaria)} × ${quartos} quarto(s)`, valor: hospedagem });
  if (alimentacao > 0) linhasComuns.push({ label: `Alimentação: ${dias} dias × ${fmtBRL(config.diaria_alimentacao)} × ${input.passageiros} pax`, valor: alimentacao });

  return [
    buildCarro(input, hospedagem, alimentacao, linhasComuns),
    buildOnibus(input, hospedagem, alimentacao, linhasComuns),
    buildAviao(input, hospedagem, alimentacao, linhasComuns),
  ];
}

// ── Carro ─────────────────────────────────────────────────────────────────
function buildCarro(
  input: BuildQuotesInput,
  hospedagem: number,
  alimentacao: number,
  linhasComuns: QuoteLine[],
): QuoteBreakdown {
  const { config, facts } = input;
  const distIdaVolta = facts.distancia_km * 2;
  const pedagios = round2(facts.pedagios_brl * 2);
  const precoGasolina = facts.preco_gasolina_litro > 0 ? facts.preco_gasolina_litro : config.preco_combustivel_litro;
  const litros = round2(distIdaVolta / Math.max(config.consumo_km_litro, 1));
  const combustivel = round2(litros * precoGasolina);
  const dias = Math.max(1, daysBetween(input.dataIda, input.dataVolta) + 1);

  const custoKm = round2(distIdaVolta * config.rate_per_km + pedagios);
  const custoAluguel = round2(dias * config.aluguel_diaria + combustivel + pedagios);

  let transporte: number;
  let modelo: "reembolso_km" | "aluguel";
  if (input.modoCarro === "km") {
    transporte = custoKm;
    modelo = "reembolso_km";
  } else if (input.modoCarro === "aluguel") {
    transporte = custoAluguel;
    modelo = "aluguel";
  } else {
    modelo = custoKm <= custoAluguel ? "reembolso_km" : "aluguel";
    transporte = Math.min(custoKm, custoAluguel);
  }

  const linhas: QuoteLine[] =
    modelo === "reembolso_km"
      ? [
          { label: `Reembolso: ${Math.round(distIdaVolta)} km × ${fmtBRL(config.rate_per_km)}/km (combustível + desgaste)`, valor: round2(distIdaVolta * config.rate_per_km) },
          { label: `Pedágios ida+volta${facts.pedagios_detalhe ? ` (${facts.pedagios_detalhe})` : ""}`, valor: pedagios },
          ...linhasComuns,
        ]
      : [
          { label: `Aluguel: ${dias} diárias × ${fmtBRL(config.aluguel_diaria)}`, valor: round2(dias * config.aluguel_diaria) },
          { label: `Gasolina: ${litros.toFixed(0)} L × ${fmtBRL(precoGasolina)}/L (${Math.round(distIdaVolta)} km, ${config.consumo_km_litro} km/L)`, valor: combustivel },
          { label: `Pedágios ida+volta${facts.pedagios_detalhe ? ` (${facts.pedagios_detalhe})` : ""}`, valor: pedagios },
          ...linhasComuns,
        ];

  return {
    modal: "carro",
    provider: "estimativa",
    titulo: `Carro (${modelo === "reembolso_km" ? "reembolso por km" : "aluguel"}) — ${Math.round(facts.distancia_km)} km/trecho, ~${facts.duracao_carro_horas.toFixed(1)}h`,
    detalhes: {
      modelo,
      distancia_km_trecho: facts.distancia_km,
      duracao_horas_trecho: facts.duracao_carro_horas,
      preco_gasolina_litro: precoGasolina,
      litros_ida_volta: litros,
      combustivel_ida_volta: combustivel,
      pedagios_ida_volta: pedagios,
      pedagios_detalhe: facts.pedagios_detalhe,
      comparativo: { reembolso_km: custoKm, aluguel: custoAluguel },
      linhas,
    },
    custo_transporte: transporte,
    custo_hospedagem: hospedagem,
    custo_traslados: 0,
    custo_alimentacao: alimentacao,
    custo_taxas: 0,
    total: round2(transporte + hospedagem + alimentacao),
    booking_link: null,
    viavel: facts.distancia_km > 0,
  };
}

// ── Ônibus ────────────────────────────────────────────────────────────────
function buildOnibus(
  input: BuildQuotesInput,
  hospedagem: number,
  alimentacao: number,
  linhasComuns: QuoteLine[],
): QuoteBreakdown {
  const { config, facts } = input;
  const passagemPp = facts.preco_onibus_pp_ida_volta ?? round2(facts.distancia_km * 2 * config.tarifa_onibus_km);
  const transporte = round2(passagemPp * input.passageiros);
  // 4 trechos de uber: casa→rodoviária, rodoviária→hotel (ida) e o inverso (volta).
  const transferTrecho = Math.max(0, facts.rodoviaria_transfer_trecho_brl);
  const traslados = round2(transferTrecho * 4);

  const linhas: QuoteLine[] = [
    { label: `Passagem: ${fmtBRL(passagemPp)} ida+volta × ${input.passageiros} pax`, valor: transporte },
    { label: `Uber casa↔rodoviária e rodoviária↔hotel (4 trechos × ${fmtBRL(transferTrecho)})`, valor: traslados },
    ...linhasComuns,
  ];

  return {
    modal: "onibus",
    provider: "estimativa",
    titulo: `Ônibus — ${facts.duracao_onibus_horas ? `~${Math.round(facts.duracao_onibus_horas)}h/trecho` : "rodoviário"}`,
    detalhes: {
      preco_pp_ida_volta: passagemPp,
      duracao_horas_trecho: facts.duracao_onibus_horas,
      transfer_trecho: transferTrecho,
      linhas,
    },
    custo_transporte: transporte,
    custo_hospedagem: hospedagem,
    custo_traslados: traslados,
    custo_alimentacao: alimentacao,
    custo_taxas: 0,
    total: round2(transporte + hospedagem + traslados + alimentacao),
    booking_link: null,
    viavel: facts.tem_onibus,
  };
}

// ── Avião — avalia todos os aeroportos de partida ─────────────────────────
function buildAviao(
  input: BuildQuotesInput,
  hospedagem: number,
  alimentacao: number,
  linhasComuns: QuoteLine[],
): QuoteBreakdown {
  const { facts } = input;
  const destino = facts.aeroporto_destino;
  const candidatos = (facts.aeroportos_origem ?? []).filter(
    (a) => a.preco_voo_pp_ida_volta != null || input.realFlights?.[a.iata],
  );

  if (!destino || candidatos.length === 0) {
    return {
      modal: "aviao",
      provider: "estimativa",
      titulo: "Avião",
      detalhes: { motivo: "Sem rota aérea viável identificada." },
      custo_transporte: 0,
      custo_hospedagem: hospedagem,
      custo_traslados: 0,
      custo_alimentacao: alimentacao,
      custo_taxas: 0,
      total: 0,
      booking_link: null,
      viavel: false,
    };
  }

  // Transfer no destino: aeroporto↔centro, ida e volta (por veículo).
  const transferDestino = round2(Math.max(0, destino.transfer_custo_trecho_brl) * 2);

  interface Evaluated {
    airport: AirportOption;
    vooTotal: number;
    transferOrigem: number;
    total: number;
    real: boolean;
    realInfo?: { dataIda: string; dataVolta: string; companhia: string | null };
  }

  const avaliados: Evaluated[] = candidatos.map((a) => {
    const real = input.realFlights?.[a.iata];
    const vooTotal = real ? round2(real.totalGrupo) : round2((a.preco_voo_pp_ida_volta ?? 0) * input.passageiros);
    // Transfer até o aeroporto de partida: ida e volta. Por pessoa (ônibus
    // executivo) multiplica pelos passageiros; por veículo, não.
    const unit = Math.max(0, a.transfer_custo_trecho_brl);
    const transferOrigem = round2(unit * 2 * (a.transfer_por_pessoa ? input.passageiros : 1));
    return {
      airport: a,
      vooTotal,
      transferOrigem,
      total: round2(vooTotal + transferOrigem),
      real: Boolean(real),
      realInfo: real ? { dataIda: real.dataIda, dataVolta: real.dataVolta, companhia: real.companhia } : undefined,
    };
  });

  avaliados.sort((x, y) => x.total - y.total);
  const best = avaliados[0];
  const a = best.airport;

  const traslados = round2(best.transferOrigem + transferDestino);
  const transporte = best.vooTotal;

  const transferLabel =
    a.transfer_modo === "onibus_executivo"
      ? `Ônibus executivo ${input.origem.split("/")[0]}↔${a.iata} (${Math.round(a.distancia_km)} km, ida+volta${a.transfer_por_pessoa ? ` × ${input.passageiros} pax` : ""})`
      : `Uber/táxi até ${a.iata} (${Math.round(a.distancia_km)} km, ida+volta)`;

  const linhas: QuoteLine[] = [
    { label: `Voo ${a.iata}→${destino.iata} (${input.passageiros} pax, ida+volta)${best.real ? "" : " — estimado"}`, valor: transporte },
    { label: transferLabel, valor: best.transferOrigem },
    { label: `Uber ${destino.iata}↔centro no destino (ida+volta)`, valor: transferDestino },
    ...linhasComuns,
  ];

  const alternativas: FlightAlternative[] = avaliados.map((e) => ({
    iata: e.airport.iata,
    nome: e.airport.nome,
    transfer_modo: e.airport.transfer_modo,
    transfer_total: e.transferOrigem,
    voo_total: e.vooTotal,
    total_porta_a_porta: round2(e.total + transferDestino),
    preco_real: e.real,
    escolhida: e === best,
  }));

  // Recomendação proativa: se o melhor NÃO é o aeroporto mais próximo, explica a economia.
  let recomendacao: string | null = null;
  if (avaliados.length > 1) {
    const maisProximo = [...avaliados].sort((x, y) => x.airport.distancia_km - y.airport.distancia_km)[0];
    if (maisProximo !== best) {
      const economia = round2(maisProximo.total - best.total);
      recomendacao =
        `Compensa sair de ${a.iata} (${a.cidade}): mesmo somando ${fmtBRL(best.transferOrigem)} de deslocamento, ` +
        `fica ${fmtBRL(economia)} mais barato que voar de ${maisProximo.airport.iata}.`;
    } else {
      recomendacao = `Melhor opção: sair de ${a.iata} (${a.cidade}). Alternativas avaliadas: ${avaliados
        .slice(1)
        .map((e) => `${e.airport.iata} (+${fmtBRL(round2(e.total - best.total))})`)
        .join(", ")}.`;
    }
  }

  const q = encodeURIComponent(`voos de ${a.iata} para ${destino.iata} ${input.dataIda} volta ${input.dataVolta}`);

  return {
    modal: "aviao",
    provider: best.real ? "amadeus" : "estimativa",
    titulo: `Avião ${a.iata}→${destino.iata}${best.realInfo?.companhia ? ` (${best.realInfo.companhia})` : ""}${a.frequencia_voos ? ` · voos ${a.frequencia_voos}` : ""}`,
    detalhes: {
      rota: `${a.iata}→${destino.iata}`,
      aeroporto_partida: { iata: a.iata, nome: a.nome, cidade: a.cidade, distancia_km: a.distancia_km },
      datas_otimizadas: best.realInfo ? { ida: best.realInfo.dataIda, volta: best.realInfo.dataVolta } : null,
      alternativas,
      recomendacao,
      hotel: input.hotelRealNome ?? null,
      linhas,
    },
    custo_transporte: transporte,
    custo_hospedagem: hospedagem,
    custo_traslados: traslados,
    custo_alimentacao: alimentacao,
    custo_taxas: 0,
    total: round2(transporte + traslados + hospedagem + alimentacao),
    booking_link: `https://www.google.com/travel/flights?q=${q}`,
    viavel: transporte > 0,
  };
}
