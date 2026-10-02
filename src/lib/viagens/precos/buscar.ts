import { generateObject, generateText } from "ai";
import { z } from "zod";

import { logResolvedUsage, resolveAiProvider } from "@/lib/ai/provider";

// =============================================================================
// BUSCA DE PREÇOS na web, para o orçamento de viagem.
//
// ── Por que isto existe, e o que substituiu ────────────────────────────────
// Havia parâmetros de R$/km para passagem aérea e de ônibus, e uma diária de
// hotel padrão. Era errado: passagem e hotel são preço de MERCADO, com
// sazonalidade grande — um R$/km não distingue janeiro de julho nem rota
// concorrida de rota sem concorrência, e o número saía plausível sem ninguém
// conseguir reconstruí-lo. Agora o motor não estima passagem nem hotel: o preço
// vem da cotação de quem pede, ou desta busca.
//
// ── O limite que NENHUMA busca resolve, e que a tela precisa dizer ─────────
// O orçamento é do ano que vem. A tarifa de setembro de 2027 **não existe em
// lugar nenhum hoje** — nem na web, nem em API de companhia aérea: ela ainda não
// foi publicada. O que a busca devolve é o menor preço ENCONTRADO AGORA para
// aquela rota, naquele mês, com a fonte. Isso é uma referência muito melhor do
// que R$/km, mas é referência — não cotação. Por isso o resultado é uma
// PROPOSTA que a pessoa confirma, e o que entra no roteiro fica marcado como
// valor informado (o motor não distingue cotação de referência; quem distingue é
// quem confirmou).
//
// ── Por TRECHO DE IDA, e não ida-e-volta ──────────────────────────────────
// O módulo antigo (`providers/web-search.ts`, dormente) busca ida-e-volta por
// aeroporto candidato — formato do fluxo dele. Aqui o roteiro é uma sequência de
// trechos de uma via (JF → Curitiba → Floripa → JF são três), então um preço de
// ida-e-volta não tem onde encaixar sem ser rateado por metade, o que inventaria
// precisão. Por isso a pergunta é outra, embora o mecanismo (buscar em prosa →
// estruturar num segundo passe) seja o mesmo que já se provou lá.
// =============================================================================

const HARD_TIMEOUT_MS = 150_000;

const PrecosSchema = z.object({
  trechos: z
    .array(
      z.object({
        id: z.string().describe("O identificador do trecho, copiado EXATAMENTE da lista pedida."),
        preco_por_pessoa: z
          .number()
          .describe("Menor preço ENCONTRADO para o trecho, SÓ IDA, por pessoa, em reais."),
        companhia: z.string().nullable().describe("Companhia do menor preço, se identificada."),
        fonte: z.string().nullable().describe("Site onde o preço foi encontrado."),
      }),
    )
    .describe("Um item por trecho que teve preço encontrado. OMITA o trecho sem preço claro."),
  hoteis: z
    .array(
      z.object({
        cidade: z.string().describe("A cidade, copiada EXATAMENTE da lista pedida."),
        diaria: z.number().describe("Diária de hotel 3 estrelas na cidade, em reais, por quarto."),
        hotel: z.string().nullable(),
        fonte: z.string().nullable(),
      }),
    )
    .describe("Um item por cidade que teve diária encontrada. OMITA a cidade sem preço claro."),
});

export type PrecosEncontrados = z.infer<typeof PrecosSchema>;

export interface TrechoParaCotar {
  /** Chave estável para a tela casar a resposta com a linha do roteiro. */
  id: string;
  de: string;
  para: string;
  /** Só avião e ônibus se cotam: carro tem o R$/km da empresa. */
  modal: "aviao" | "onibus";
}

export interface CidadeParaCotar {
  cidade: string;
  noites: number;
}

export type BuscaPrecosOutcome =
  | { ok: true; data: PrecosEncontrados; fontes: string[]; engine: string }
  | { ok: false; error: string };

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`busca de preços excedeu ${ms}ms`)), ms),
    ),
  ]);
}

const MESES = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2027-05-04" → "maio de 2027". O mês é o que importa para a tarifa. */
export function mesAno(iso: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec((iso ?? "").trim());
  if (!m) return null;
  const mes = Number(m[2]);
  if (mes < 1 || mes > 12) return null;
  return `${MESES[mes - 1]} de ${m[1]}`;
}

/** Só http(s): estas URLs viram link na tela. */
function fontesLimpas(brutas: unknown[]): string[] {
  return Array.from(
    new Set(
      (brutas as Array<Record<string, unknown>>)
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
  ).slice(0, 12);
}

/** O texto da pergunta — exportado para o teste cobrar as regras que não podem cair. */
export function montarPerguntaPrecos(params: {
  trechos: readonly TrechoParaCotar[];
  cidades: readonly CidadeParaCotar[];
  quando: string | null;
}): string {
  const quando = params.quando ?? "o mês da viagem (não informado)";
  const aereos = params.trechos.filter((t) => t.modal === "aviao");
  const rodoviarios = params.trechos.filter((t) => t.modal === "onibus");

  const linhas: string[] = [
    `Pesquise na web os preços REAIS e ATUAIS, em reais, para uma viagem em ${quando}.`,
    "",
    "Peça-se preço de IDA (uma via) por trecho, por pessoa — NÃO ida e volta. Cada trecho tem um",
    "identificador entre colchetes: use-o exatamente como está ao reportar.",
    "",
  ];

  if (aereos.length > 0) {
    linhas.push(
      "PASSAGEM AÉREA, classe econômica, só ida, por pessoa:",
      ...aereos.map((t) => `  [${t.id}] ${t.de} → ${t.para}`),
      "Faça uma busca POR TRECHO. Sites de companhia (LATAM/GOL/Azul) e o Google Flights não mostram",
      "preço em busca — use agregadores que publicam tarifa em página indexada: Voopter, Kayak,",
      "Skyscanner, Melhores Destinos, Passagens Promo, Decolar. Aceite o menor preço \"a partir de\"",
      `que encontrar para ${quando}, informando a fonte.`,
      "",
    );
  }
  if (rodoviarios.length > 0) {
    linhas.push(
      "PASSAGEM DE ÔNIBUS, só ida, por pessoa (ClickBus, Buser, sites das viações):",
      ...rodoviarios.map((t) => `  [${t.id}] ${t.de} → ${t.para}`),
      "",
    );
  }
  if (params.cidades.length > 0) {
    linhas.push(
      "DIÁRIA DE HOTEL 3 estrelas, por quarto, em cada cidade (Booking, Google Hotels):",
      ...params.cidades.map(
        (c) => `  ${c.cidade} — ${c.noites} noite(s)`,
      ),
      "",
    );
  }

  linhas.push(
    "REGRAS:",
    "- reporte SÓ o que encontrar de fato, sempre com o valor em R$ e a fonte;",
    "- se não encontrar o preço de um trecho ou de uma cidade, diga explicitamente que NÃO",
    "  encontrou. Não estime, não interpole, não use média de outra rota: um valor inventado aqui",
    "  entra num orçamento e ninguém consegue conferi-lo depois;",
    `- a viagem é em ${quando}. Se a data for distante e ainda não houver tarifa publicada, diga`,
    "  isso e informe o preço que encontrar para o mês mais próximo comparável, dizendo qual foi.",
  );

  return linhas.join("\n");
}

/**
 * Busca os preços. Exige OpenAI (a tool de web search é exclusiva dela), e o
 * resolver força OpenAI mesmo que o provedor ativo do painel seja outro.
 *
 * Mecanismo em dois passes, o mesmo já provado no módulo antigo: a tool devolve
 * PROSA com o que achou, e um segundo modelo extrai os números. Extrair no mesmo
 * turno fazia o modelo preencher campo que ele não tinha achado.
 */
export async function buscarPrecos(params: {
  trechos: readonly TrechoParaCotar[];
  cidades: readonly CidadeParaCotar[];
  /** Mês da viagem, já formatado por `mesAno`. */
  quando: string | null;
  /**
   * Teto por tentativa. O padrão é generoso (uso fora de conversa); a CONVERSA
   * passa um valor curto, porque lá a pessoa está olhando a tela esperando — e
   * silêncio longo é lido como travado, não como pesquisa.
   */
  timeoutMs?: number;
}): Promise<BuscaPrecosOutcome> {
  if (params.trechos.length === 0 && params.cidades.length === 0) {
    return { ok: false, error: "Nada para cotar: o roteiro não tem trecho de avião/ônibus nem noite de hotel." };
  }

  const resolved = await resolveAiProvider({ capability: "web_search" }).catch(() => null);
  if (!resolved) {
    return { ok: false, error: "Busca de preços indisponível: falta a chave da OpenAI." };
  }
  const provider = resolved.provider;

  const system =
    "Você é um pesquisador de preços de viagem no Brasil. Use a busca na web para encontrar preços " +
    "REAIS e ATUAIS, em reais. Reporte apenas o que encontrar de fato, sempre com o valor e a fonte. " +
    "Quando não encontrar, diga que não encontrou — nunca estime.";
  const prompt = montarPerguntaPrecos(params);
  const teto = params.timeoutMs ?? HARD_TIMEOUT_MS;

  const attempts: Array<{
    engine: string;
    run: () => Promise<{ text: string; sources?: unknown[]; usage?: unknown }>;
  }> = [
    {
      engine: "gpt-5-mini/web_search",
      run: () =>
        withTimeout(
          generateText({
            model: provider("gpt-5-mini"),
            system,
            prompt,
            tools: { web_search: provider.tools.webSearch({ searchContextSize: "high" }) },
            toolChoice: { type: "tool", toolName: "web_search" },
          }),
          teto,
        ),
    },
    {
      // A tool GA não aceita gpt-4o-mini; o combo preview é o documentado no
      // cookbook do AI SDK e serve de rede.
      engine: "gpt-4o-mini/web_search_preview",
      run: () =>
        withTimeout(
          generateText({
            model: provider.responses("gpt-4o-mini"),
            system,
            prompt,
            tools: { web_search_preview: provider.tools.webSearchPreview({}) },
          }),
          teto,
        ),
    },
  ];

  const erros: string[] = [];
  for (const attempt of attempts) {
    try {
      const res = await attempt.run();
      if (!res.text?.trim()) {
        erros.push(`${attempt.engine}: resposta vazia`);
        continue;
      }

      const { object, usage: structUsage } = await generateObject({
        model: provider("gpt-4o-mini"),
        schema: PrecosSchema,
        temperature: 0,
        prompt:
          "Extraia os preços do relatório de pesquisa abaixo. NÃO invente valores: inclua apenas o " +
          "que tem número claro em reais, e OMITA o trecho ou a cidade cujo preço não foi " +
          "encontrado. Copie os identificadores de trecho exatamente como aparecem.\n\n" +
          res.text,
      });

      // Consumo no módulo `orcamento` (não `viagens`): é o orçamento que gastou.
      await logResolvedUsage(resolved, "orcamento", res.usage);
      await logResolvedUsage(resolved, "orcamento", structUsage);
      return {
        ok: true,
        data: object,
        fontes: fontesLimpas(res.sources ?? []),
        engine: attempt.engine,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      erros.push(`${attempt.engine}: ${msg.slice(0, 300)}`);
    }
  }

  const error = erros.join(" | ");
  console.warn("[orcamento/viagens] busca de preços falhou:", error);
  return { ok: false, error: "Não consegui pesquisar os preços agora. " + error.slice(0, 200) };
}
