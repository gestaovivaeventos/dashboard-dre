import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const MODEL = "gpt-4o-mini";

const RouteFactsSchema = z.object({
  distancia_km: z
    .number()
    .describe("Distância rodoviária aproximada (um sentido) entre origem e destino, em km."),
  pedagios_brl: z
    .number()
    .describe("Custo total aproximado de pedágios (um sentido) na rota rodoviária, em reais. 0 se não houver."),
  duracao_carro_horas: z.number().describe("Duração aproximada da viagem de carro (um sentido), em horas."),
  tem_voo_comercial: z
    .boolean()
    .describe("Se existe rota aérea comercial viável entre as cidades (aeroportos próximos)."),
  aeroporto_origem: z.string().nullable().describe("Código IATA do aeroporto mais próximo da origem (ex.: GRU). Null se não houver."),
  aeroporto_destino: z.string().nullable().describe("Código IATA do aeroporto mais próximo do destino. Null se não houver."),
  preco_voo_pp_ida_volta: z
    .number()
    .nullable()
    .describe("Preço típico ATUAL por pessoa (ida e volta, econômica) na rota aérea, em reais. Null se não há voo."),
  duracao_voo_horas: z.number().nullable().describe("Duração aproximada do voo direto/conexão típica (um sentido), horas."),
  tem_onibus: z.boolean().describe("Se existe linha de ônibus rodoviário comercial entre as cidades."),
  preco_onibus_pp_ida_volta: z
    .number()
    .nullable()
    .describe("Preço típico por pessoa (ida e volta, convencional/executivo) de ônibus, em reais. Null se não há linha."),
  duracao_onibus_horas: z.number().nullable().describe("Duração aproximada do trajeto de ônibus (um sentido), horas."),
  hotel_diaria_media: z
    .number()
    .describe("Diária média de hotel 3 estrelas (quarto duplo) no destino, em reais."),
  observacoes: z.string().nullable().describe("Observações relevantes sobre a rota (época, alta temporada, obras). Null se nada."),
});

export type RouteFacts = z.infer<typeof RouteFactsSchema>;

/**
 * Estimador agêntico: usa o LLM para levantar fatos da rota (distância, pedágios,
 * preços típicos de voo/ônibus, diária de hotel). É o fallback quando não há
 * chave de provedor real (Amadeus/Routes) — os valores são marcados como
 * "estimativa" nas cotações e substituídos por preços reais quando as
 * integrações estiverem configuradas.
 */
export async function estimateRouteFacts(params: {
  origem: string;
  destino: string;
  dataIda: string;
  dataVolta: string;
}): Promise<RouteFacts> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Busca indisponível: configure OPENAI_API_KEY (estimativa) ou AMADEUS_CLIENT_ID/SECRET.");
  }
  const provider = createOpenAI({ apiKey });

  const { object } = await generateObject({
    model: provider(MODEL),
    schema: RouteFactsSchema,
    temperature: 0.2,
    system:
      "Você é um agente de viagens corporativas brasileiro. Estime com realismo fatos de rota e preços " +
      "de mercado no Brasil (reais, BRL). Seja conservador: prefira valores típicos a otimistas. " +
      "Não invente rotas aéreas ou linhas de ônibus que não existem.",
    prompt:
      `Rota: ${params.origem} → ${params.destino}.\n` +
      `Período: ida ${params.dataIda}, volta ${params.dataVolta}.\n` +
      "Levante: distância rodoviária e pedágios; existência/duração/preço típico de voo comercial " +
      "(ida e volta, por pessoa); existência/duração/preço típico de ônibus rodoviário (ida e volta, " +
      "por pessoa); e diária média de hotel 3 estrelas no destino.",
  });

  return object;
}
