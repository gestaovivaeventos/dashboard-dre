export type ViagemStatus =
  | "rascunho"
  | "buscando"
  | "cotado"
  | "aprovado"
  | "reservado"
  | "concluido"
  | "rejeitado"
  | "erro"
  | "cancelado";

export type ViagemModal = "carro" | "onibus" | "aviao";
export type ViagemModoCarro = "km" | "aluguel" | "ambos";

export interface ViagemRequestInput {
  origem: string;
  destino: string;
  data_ida: string;
  data_volta: string;
  /** Busca o melhor preço em ±N dias ao redor do período pedido. */
  janela_flex_dias: number;
  passageiros: number;
  modo_carro: ViagemModoCarro;
  incluir_hospedagem: boolean;
  /** Re-cota periodicamente e alerta quando o preço cai. */
  monitorar: boolean;
  observacao?: string | null;
}

export interface ViagemQuoteRow {
  id: string;
  modal: ViagemModal;
  provider: string;
  titulo: string | null;
  detalhes: Record<string, unknown> | null;
  custo_transporte: number;
  custo_hospedagem: number;
  custo_traslados: number;
  custo_alimentacao: number;
  custo_taxas: number;
  total: number;
  booking_link: string | null;
  selected: boolean;
  captured_at: string;
}

export interface ViagemRequestListRow {
  id: string;
  request_number: number;
  origem: string;
  destino: string;
  data_ida: string;
  data_volta: string;
  passageiros: number;
  status: ViagemStatus;
  monitorar: boolean;
  created_by_name: string;
  created_at: string;
  melhor_total: number | null;
}

export interface ViagemRequestDetail {
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
  observacao: string | null;
  status: ViagemStatus;
  chosen_quote_id: string | null;
  approved_by_name: string | null;
  approved_at: string | null;
  rejected_reason: string | null;
  reservado_em: string | null;
  created_by: string;
  created_by_name: string;
  created_at: string;
  quotes: ViagemQuoteRow[];
  snapshots: Array<{ modal: ViagemModal; total: number; captured_at: string }>;
  history: Array<{ action: string; comment: string | null; user_name: string | null; created_at: string }>;
}

export interface ViagemConfigRow {
  rate_per_km: number;
  aluguel_diaria: number;
  preco_combustivel_litro: number;
  consumo_km_litro: number;
  tarifa_onibus_km: number;
  diaria_alimentacao: number;
  hotel_diaria_padrao: number;
}
