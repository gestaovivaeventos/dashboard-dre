import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const SEARCH_MODEL = "gpt-4o-mini";
const HARD_TIMEOUT_MS = 120_000;

const WebPricesSchema = z.object({
  voos: z
    .array(
      z.object({
        origem_iata: z.string().describe("Código IATA do aeroporto de partida pesquisado."),
        preco_pp_ida_volta: z.number().describe("Menor preço ENCONTRADO na pesquisa, por pessoa, ida e volta, em reais."),
        companhia: z.string().nullable().describe("Companhia aérea do menor preço. Null se não identificada."),
        fonte: z.string().nullable().describe("Site/fonte onde o preço foi encontrado. Null se não claro."),
      }),
    )
    .describe("Um item por aeroporto de partida que teve preço encontrado na pesquisa. Omita aeroportos sem preço claro."),
  onibus: z
    .object({
      preco_pp_ida_volta: z.number().describe("Menor preço encontrado, por pessoa, ida e volta, em reais."),
      empresa: z.string().nullable(),
      fonte: z.string().nullable(),
    })
    .nullable()
    .describe("Preço de ônibus encontrado na pesquisa. Null se nada claro."),
  gasolina_litro: z.number().nullable().describe("Preço atual da gasolina comum na região de origem, R$/litro, se encontrado."),
  hotel_diaria: z.number().nullable().describe("Diária de hotel 3 estrelas no destino nas datas, em reais, se encontrada."),
});

export type WebPrices = z.infer<typeof WebPricesSchema>;

export interface WebSearchResult {
  data: WebPrices;
  fontes: string[];
}

/**
 * Pesquisa preços REAIS na web agora (via OpenAI web search): voos por
 * aeroporto de partida candidato, ônibus, gasolina e hotel. Dois passos:
 * 1) generateText com a tool web_search faz as buscas e relata o que achou;
 * 2) generateObject estrutura o relato (sem inventar — omite o que não achou).
 * Retorna null em qualquer falha — o chamador cai na estimativa.
 */
export async function searchWebPrices(params: {
  origem: string;
  destino: string;
  destinoIata: string | null;
  dataIda: string;
  dataVolta: string;
  candidatos: Array<{ iata: string; cidade: string }>;
}): Promise<WebSearchResult | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  const provider = createOpenAI({ apiKey });

  const rotas = params.candidatos
    .map((c) => `${c.iata} (${c.cidade})${params.destinoIata ? ` → ${params.destinoIata}` : ` → ${params.destino}`}`)
    .join("; ");

  try {
    const res = await Promise.race([
      generateText({
        model: provider(SEARCH_MODEL),
        tools: { web_search: provider.tools.webSearch({ searchContextSize: "medium" }) },
        system:
          "Você é um pesquisador de preços de viagem. Use a busca na web para encontrar preços REAIS e ATUAIS " +
          "no Brasil, em reais. Reporte apenas o que encontrar de fato, sempre citando o valor e a fonte. " +
          "Se não encontrar um preço, diga explicitamente que não encontrou.",
        prompt:
          `Pesquise na web os preços reais para uma viagem de ${params.origem} a ${params.destino}, ` +
          `ida ${params.dataIda} e volta ${params.dataVolta}:\n` +
          `1) PASSAGEM AÉREA ida-e-volta em classe econômica, por pessoa, para cada rota: ${rotas}. ` +
          "Busque em Google Flights, LATAM, GOL, Azul, Kayak ou Skyscanner.\n" +
          `2) PASSAGEM DE ÔNIBUS ida-e-volta por pessoa ${params.origem} → ${params.destino} (ClickBus, Buser, sites das viações).\n` +
          `3) Preço médio ATUAL da gasolina comum em ${params.origem}.\n` +
          `4) Diária de hotel 3 estrelas em ${params.destino} nessas datas (Booking/Google Hotels).\n\n` +
          "Liste cada preço encontrado com valor em R$ e a fonte.",
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`web search timeout after ${HARD_TIMEOUT_MS}ms`)), HARD_TIMEOUT_MS),
      ),
    ]);

    const fontes = Array.from(
      new Set(
        (res.sources ?? [])
          .map((s) => ("url" in s && typeof s.url === "string" ? s.url : null))
          .filter((u): u is string => Boolean(u)),
      ),
    ).slice(0, 10);

    if (!res.text?.trim()) return null;

    const { object } = await generateObject({
      model: provider(SEARCH_MODEL),
      schema: WebPricesSchema,
      temperature: 0,
      prompt:
        "Extraia os preços do relatório de pesquisa abaixo. NÃO invente valores — inclua apenas o que tem " +
        "número claro em reais; omita rotas/itens sem preço encontrado.\n\n" +
        res.text,
    });

    return { data: object, fontes };
  } catch (err) {
    console.warn("[viagens] web search prices failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
