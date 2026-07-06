import { generateObject, generateText } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const HARD_TIMEOUT_MS = 150_000;

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

export type WebSearchOutcome =
  | { ok: true; data: WebPrices; fontes: string[]; engine: string }
  | { ok: false; error: string };

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`web search timeout after ${HARD_TIMEOUT_MS}ms`)), HARD_TIMEOUT_MS),
    ),
  ]);
}

/**
 * Pesquisa preços REAIS na web agora (via OpenAI web search): voos por
 * aeroporto de partida candidato, ônibus, gasolina e hotel.
 *
 * Cadeia de tentativas (a tool web_search GA não suporta gpt-4o-mini):
 * 1) gpt-5-mini + webSearch (GA)
 * 2) gpt-4o-mini + webSearchPreview (combo documentado no cookbook do AI SDK)
 * Depois um generateObject estrutura o relato sem inventar valores.
 * Nunca lança: devolve { ok:false, error } pro chamador logar e cair na estimativa.
 */
export async function searchWebPrices(params: {
  origem: string;
  destino: string;
  destinoIata: string | null;
  dataIda: string;
  dataVolta: string;
  candidatos: Array<{ iata: string; cidade: string }>;
}): Promise<WebSearchOutcome> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY ausente" };
  const provider = createOpenAI({ apiKey });

  const rotas = params.candidatos
    .map((c) => `${c.iata} (${c.cidade})${params.destinoIata ? ` → ${params.destinoIata}` : ` → ${params.destino}`}`)
    .join("; ");

  const system =
    "Você é um pesquisador de preços de viagem. Use a busca na web para encontrar preços REAIS e ATUAIS " +
    "no Brasil, em reais. Reporte apenas o que encontrar de fato, sempre citando o valor e a fonte. " +
    "Se não encontrar um preço, diga explicitamente que não encontrou.";
  const prompt =
    `Pesquise na web os preços reais para uma viagem de ${params.origem} a ${params.destino}, ` +
    `ida ${params.dataIda} e volta ${params.dataVolta}:\n` +
    `1) PASSAGEM AÉREA ida-e-volta em classe econômica, por pessoa, para cada rota: ${rotas}. ` +
    "Busque em Google Flights, LATAM, GOL, Azul, Kayak ou Skyscanner.\n" +
    `2) PASSAGEM DE ÔNIBUS ida-e-volta por pessoa ${params.origem} → ${params.destino} (ClickBus, Buser, sites das viações).\n` +
    `3) Preço médio ATUAL da gasolina comum em ${params.origem}.\n` +
    `4) Diária de hotel 3 estrelas em ${params.destino} nessas datas (Booking/Google Hotels).\n\n` +
    "Liste cada preço encontrado com valor em R$ e a fonte.";

  const attempts: Array<{ engine: string; run: () => Promise<{ text: string; sources?: unknown[] }> }> = [
    {
      engine: "gpt-5-mini/web_search",
      run: () =>
        withTimeout(
          generateText({
            model: provider("gpt-5-mini"),
            system,
            prompt,
            tools: { web_search: provider.tools.webSearch({ searchContextSize: "medium" }) },
            toolChoice: { type: "tool", toolName: "web_search" },
          }),
        ),
    },
    {
      engine: "gpt-4o-mini/web_search_preview",
      run: () =>
        withTimeout(
          generateText({
            model: provider.responses("gpt-4o-mini"),
            system,
            prompt,
            tools: { web_search_preview: provider.tools.webSearchPreview({}) },
          }),
        ),
    },
  ];

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const res = await attempt.run();
      if (!res.text?.trim()) {
        errors.push(`${attempt.engine}: resposta vazia`);
        continue;
      }

      // Só http(s) — essas URLs viram <a href> na UI; bloqueia javascript:/data:.
      const fontes = Array.from(
        new Set(
          ((res.sources ?? []) as Array<Record<string, unknown>>)
            .map((s) => (typeof s?.url === "string" ? s.url : null))
            .filter((u): u is string => {
              if (!u) return false;
              try {
                const p = new URL(u).protocol;
                return p === "http:" || p === "https:";
              } catch {
                return false;
              }
            }),
        ),
      ).slice(0, 10);

      const { object } = await generateObject({
        model: provider("gpt-4o-mini"),
        schema: WebPricesSchema,
        temperature: 0,
        prompt:
          "Extraia os preços do relatório de pesquisa abaixo. NÃO invente valores — inclua apenas o que tem " +
          "número claro em reais; omita rotas/itens sem preço encontrado.\n\n" +
          res.text,
      });

      return { ok: true, data: object, fontes, engine: attempt.engine };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${attempt.engine}: ${msg.slice(0, 300)}`);
    }
  }

  const error = errors.join(" | ");
  console.warn("[viagens] web search prices failed:", error);
  return { ok: false, error };
}
