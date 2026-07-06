import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const MODEL = "gpt-4o-mini";

const AirportOptionSchema = z.object({
  iata: z.string().describe("Código IATA do aeroporto (ex.: IZA, GIG, SDU, CNF, GRU)."),
  nome: z.string().describe("Nome do aeroporto."),
  cidade: z.string().describe("Cidade do aeroporto."),
  distancia_km: z.number().describe("Distância rodoviária da cidade de partida até este aeroporto, em km."),
  transfer_modo: z
    .enum(["uber", "taxi", "onibus_executivo", "van_transfer"])
    .describe("Meio terrestre mais razoável até este aeroporto: uber/táxi para até ~100km; ônibus executivo ou van/transfer para distâncias maiores."),
  transfer_custo_trecho_brl: z
    .number()
    .describe("Custo do deslocamento POR TRECHO até este aeroporto, em reais. Uber/táxi/van: custo do carro inteiro. Ônibus executivo: por pessoa."),
  transfer_por_pessoa: z.boolean().describe("true se o custo do transfer é por pessoa (ônibus executivo); false se é por veículo (uber/táxi/van)."),
  transfer_duracao_h: z.number().describe("Duração do deslocamento terrestre até o aeroporto, em horas."),
  preco_voo_pp_ida_volta: z
    .number()
    .nullable()
    .describe("Preço típico ATUAL por pessoa (ida e volta, econômica) partindo deste aeroporto até o aeroporto principal do destino, em reais. Null se não há voo comercial viável."),
  frequencia_voos: z.string().nullable().describe("Frequência aproximada de voos na rota (ex.: 'diários', '3x/semana'). Null se desconhecida."),
});

const RouteFactsSchema = z.object({
  distancia_km: z.number().describe("Distância rodoviária (um sentido) entre origem e destino, em km."),
  pedagios_brl: z.number().describe("Custo total de pedágios (um sentido) na rota rodoviária, para carro de passeio, em reais. 0 se não houver."),
  pedagios_detalhe: z.string().nullable().describe("Resumo das praças de pedágio/rodovias (ex.: 'BR-040: 4 praças ~R$45'). Null se não houver."),
  duracao_carro_horas: z.number().describe("Duração da viagem de carro (um sentido), em horas."),
  preco_gasolina_litro: z.number().describe("Preço ATUAL médio da gasolina comum na região de origem, em R$/litro."),
  aeroportos_origem: z
    .array(AirportOptionSchema)
    .min(0)
    .max(4)
    .describe(
      "Aeroportos de PARTIDA viáveis num raio de ~300km da origem, incluindo o local (se houver) e alternativas maiores que costumam ter voo mais barato/frequente. Ex.: para Juiz de Fora liste IZA (Goianá), SDU/GIG (Rio, ~180km) e CNF (BH, ~260km). Ordene do mais próximo ao mais distante.",
    ),
  aeroporto_destino: z
    .object({
      iata: z.string(),
      nome: z.string(),
      distancia_centro_km: z.number().describe("Distância do aeroporto ao centro/região de hotéis do destino, km."),
      transfer_custo_trecho_brl: z.number().describe("Custo típico de uber/táxi do aeroporto ao centro do destino, por trecho (por veículo), em reais."),
      transfer_duracao_h: z.number(),
    })
    .nullable()
    .describe("Aeroporto principal do destino. Null se o destino não tem aeroporto comercial num raio razoável."),
  tem_onibus: z.boolean().describe("Se existe linha de ônibus rodoviário comercial entre as cidades."),
  preco_onibus_pp_ida_volta: z.number().nullable().describe("Preço típico por pessoa (ida e volta, convencional/executivo) de ônibus, em reais. Null se não há linha."),
  duracao_onibus_horas: z.number().nullable().describe("Duração do trajeto de ônibus (um sentido), horas."),
  rodoviaria_transfer_trecho_brl: z
    .number()
    .describe("Custo médio de uber/táxi por trecho casa↔rodoviária (origem) e rodoviária↔hotel (destino), em reais."),
  hotel_diaria_media: z.number().describe("Diária média de hotel 3 estrelas (quarto duplo) no destino, em reais."),
  observacoes: z.string().nullable().describe("Observações relevantes (alta temporada, obras, rota com balsa etc.). Null se nada."),
});

export type AirportOption = z.infer<typeof AirportOptionSchema>;
export type RouteFacts = z.infer<typeof RouteFactsSchema>;

/**
 * Estimador agêntico: levanta fatos da rota porta-a-porta — distância, pedágios,
 * preço atual da gasolina, AEROPORTOS ALTERNATIVOS de partida (com custo do
 * deslocamento terrestre até cada um), transfer no destino, ônibus e hotel.
 * É o fallback/complemento do Amadeus; valores marcados como "estimativa".
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
      "Você é um agente de viagens corporativas brasileiro, meticuloso com custos porta-a-porta. " +
      "Estime com realismo preços ATUAIS de mercado no Brasil (reais, BRL). Seja conservador. " +
      "Não invente rotas aéreas, aeroportos ou linhas de ônibus que não existem. " +
      "Pense proativamente em alternativas: partir de um aeroporto maior a 200-300km costuma sair " +
      "mais barato mesmo somando o deslocamento terrestre — sempre liste essas opções.",
    prompt:
      `Origem: ${params.origem}. Destino: ${params.destino}.\n` +
      `Período: ida ${params.dataIda}, volta ${params.dataVolta}.\n\n` +
      "Levante:\n" +
      "1) Rota de carro: distância, duração, pedágios (valor total e resumo das praças) e preço atual da gasolina na região.\n" +
      "2) Aeroportos de partida viáveis (raio ~300km da origem): o local, se houver, E as alternativas maiores. " +
      "Para cada um: distância por terra, melhor meio de chegar (uber até ~100km; ônibus executivo/van além disso), " +
      "custo e duração desse deslocamento, e o preço típico do voo ida-e-volta por pessoa até o destino.\n" +
      "3) Aeroporto principal do destino + custo do uber/táxi até o centro.\n" +
      "4) Ônibus rodoviário: existência, preço ida-e-volta por pessoa, duração, e custo do uber casa↔rodoviária.\n" +
      "5) Diária média de hotel 3 estrelas no destino.",
  });

  return object;
}
