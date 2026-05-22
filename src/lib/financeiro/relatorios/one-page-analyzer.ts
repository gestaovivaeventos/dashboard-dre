import { generateObject, NoObjectGeneratedError } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import {
  ONE_PAGE_REPORT_SYSTEM_PROMPT,
  buildOnePageReportUserPrompt,
} from "@/lib/financeiro/relatorios/one-page-prompt";
import {
  OnePageReportSchema,
  type OnePageReport,
} from "@/lib/financeiro/relatorios/one-page-schema";
// Reaproveita o schema de INPUT do motor antigo — o contrato com a rota
// nao muda, so a forma da saida.
import {
  OnePageInputSchema,
  type OnePageInput,
} from "@/lib/intelligence/one-page-schema";

// ============================================================================
// Motor de analise por IA do One Page Report — versao do menu Financeiro >
// Relatorios. Substitui (semanticamente) o motor antigo em
// `src/lib/intelligence/one-page-analyzer.ts` para padronizar a saida no
// schema portugues camelCase (statusGeral, notaGeral, destaques, etc.).
//
// Contrato:
//   - Entrada: OnePageInput (mesmo shape do motor antigo, montado pela rota).
//   - Saida: OnePageReport (novo schema, validado por Zod).
//   - Falha: lanca OnePageReportError com causa.
//
// O motor NAO calcula nada e NAO consulta o banco. Toda a aritmetica fica
// na rota — aqui apenas empacotamos o input e validamos a resposta da IA.
//
// Provedor: OpenAI via Vercel AI SDK (mesmos pacotes do motor antigo).
// Modelo padrao: gpt-4o-mini (mesmo do motor antigo).
// ============================================================================

export class OnePageReportError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OnePageReportError";
  }
}

interface AnalyzerOptions {
  // Modelo OpenAI a usar. Default: gpt-4o-mini.
  model?: string;
  // Temperatura. Default 0.2 — alta consistencia para reduzir invencao,
  // permitindo variacao redacional minima.
  temperature?: number;
  // Tokens maximos. Default 2000 cabe folgadamente a estrutura cheia.
  maxOutputTokens?: number;
  // API key opcional (sobrescreve OPENAI_API_KEY) — util em testes.
  apiKey?: string;
}

const DEFAULT_OPTIONS: Required<Omit<AnalyzerOptions, "apiKey">> = {
  model: "gpt-4o-mini",
  temperature: 0.2,
  maxOutputTokens: 2000,
};

export async function analyzeOnePageReport(
  rawInput: unknown,
  options: AnalyzerOptions = {},
): Promise<OnePageReport> {
  // 1. Valida o input do caller. Garante que a rota esta enviando o shape
  //    esperado e da uma mensagem util de erro caso contrario.
  const parsedInput = OnePageInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new OnePageReportError(
      `Input invalido para o One Page Report: ${parsedInput.error.message}`,
      parsedInput.error,
    );
  }
  const input: OnePageInput = parsedInput.data;

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OnePageReportError(
      "OPENAI_API_KEY nao configurada no ambiente. Defina a variavel em .env.local para usar o motor de analise.",
    );
  }

  const provider = createOpenAI({ apiKey });
  const userPrompt = buildOnePageReportUserPrompt(input);

  // 2. Chama o LLM forcando estrutura via schema. O generateObject usa o
  //    response_format do OpenAI por baixo e valida internamente — quando
  //    nao bate com o schema, lanca NoObjectGeneratedError.
  try {
    const { object } = await generateObject({
      model: provider(opts.model),
      schema: OnePageReportSchema,
      system: ONE_PAGE_REPORT_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
    });

    // 3. Defesa em profundidade: revalida com o mesmo schema. Cobre qualquer
    //    relaxamento futuro do AI SDK.
    const verified = OnePageReportSchema.safeParse(object);
    if (!verified.success) {
      throw new OnePageReportError(
        `Resposta da IA passou no SDK mas falhou na revalidacao: ${verified.error.message}`,
        verified.error,
      );
    }
    return verified.data;
  } catch (err) {
    if (err instanceof OnePageReportError) throw err;

    // Falha de schema na primeira tentativa — retry unico com instrucao
    // adicional. Se falhar de novo, propaga sem inventar analise.
    if (err instanceof NoObjectGeneratedError) {
      try {
        const { object } = await generateObject({
          model: provider(opts.model),
          schema: OnePageReportSchema,
          system: ONE_PAGE_REPORT_SYSTEM_PROMPT,
          prompt:
            userPrompt +
            "\n\nSua resposta anterior nao casou com o schema obrigatorio. " +
            "Refaca seguindo o schema EXATAMENTE — todos os campos com os tipos e enums corretos.",
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
        });
        const verified = OnePageReportSchema.safeParse(object);
        if (!verified.success) {
          throw new OnePageReportError(
            `Retry da IA tambem falhou no schema: ${verified.error.message}`,
            verified.error,
          );
        }
        return verified.data;
      } catch (retryErr) {
        if (retryErr instanceof OnePageReportError) throw retryErr;
        throw new OnePageReportError(
          "IA falhou em produzir resposta no schema apos 2 tentativas.",
          retryErr,
        );
      }
    }

    throw new OnePageReportError(
      `Falha ao gerar One Page Report: ${err instanceof Error ? err.message : "erro desconhecido"}`,
      err,
    );
  }
}
