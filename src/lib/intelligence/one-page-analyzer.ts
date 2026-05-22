import { generateObject, NoObjectGeneratedError } from "ai";
import { createOpenAI } from "@ai-sdk/openai";

import {
  ONE_PAGE_SYSTEM_PROMPT,
  buildOnePageUserPrompt,
} from "@/lib/intelligence/one-page-prompt";
import {
  OnePageAnalysisSchema,
  OnePageInputSchema,
  type OnePageAnalysis,
  type OnePageInput,
} from "@/lib/intelligence/one-page-schema";

// ============================================================================
// Motor de analise por IA do One Page Report.
//
// Contrato:
//   - Entrada: OnePageInput (todos os calculos ja feitos pelo caller).
//   - Saida: OnePageAnalysis (validado por schema).
//   - Falha: lanca OnePageAnalyzerError com causa.
//
// O motor NAO calcula nada e NAO consulta o banco. A unica responsabilidade
// e empacotar o input no formato esperado pelo LLM e validar a resposta.
// ============================================================================

export class OnePageAnalyzerError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "OnePageAnalyzerError";
  }
}

interface AnalyzerOptions {
  // Modelo OpenAI a usar. Default: gpt-4o-mini (mesmo modelo usado nos
  // demais fluxos de intelligence — ja validado em producao).
  model?: string;
  // Temperatura. Default 0.2: alta consistencia para reduzir invencao,
  // ainda permitindo alguma variacao redacional.
  temperature?: number;
  // Tokens maximos. Default 2000 cabe folgadamente o schema cheio.
  maxOutputTokens?: number;
  // API key opcional para sobrescrever OPENAI_API_KEY (usado em testes).
  apiKey?: string;
}

const DEFAULT_OPTIONS: Required<Omit<AnalyzerOptions, "apiKey">> = {
  model: "gpt-4o-mini",
  temperature: 0.2,
  maxOutputTokens: 2000,
};

export async function analyzeOnePage(
  rawInput: unknown,
  options: AnalyzerOptions = {},
): Promise<OnePageAnalysis> {
  // 1. Valida o input do caller antes de gastar token. Garante que o
  //    contrato esta sendo respeitado e da uma mensagem util de erro.
  const parsedInput = OnePageInputSchema.safeParse(rawInput);
  if (!parsedInput.success) {
    throw new OnePageAnalyzerError(
      `Input invalido para o motor One Page: ${parsedInput.error.message}`,
      parsedInput.error,
    );
  }
  const input: OnePageInput = parsedInput.data;

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new OnePageAnalyzerError(
      "OPENAI_API_KEY nao configurada no ambiente.",
    );
  }

  const provider = createOpenAI({ apiKey });
  const userPrompt = buildOnePageUserPrompt(input);

  // 2. Chama o LLM forcando estrutura via schema. O generateObject usa
  //    response_format do OpenAI por baixo e valida internamente — se nao
  //    bater com o schema, lanca NoObjectGeneratedError.
  try {
    const { object } = await generateObject({
      model: provider(opts.model),
      schema: OnePageAnalysisSchema,
      system: ONE_PAGE_SYSTEM_PROMPT,
      prompt: userPrompt,
      temperature: opts.temperature,
      maxOutputTokens: opts.maxOutputTokens,
    });

    // 3. Defesa em profundidade: revalida a saida com o mesmo schema. Cobre
    //    qualquer mudanca futura no SDK que possa relaxar a validacao.
    const verified = OnePageAnalysisSchema.safeParse(object);
    if (!verified.success) {
      throw new OnePageAnalyzerError(
        `Resposta da IA passou no SDK mas falhou na revalidacao: ${verified.error.message}`,
        verified.error,
      );
    }
    return verified.data;
  } catch (err) {
    if (err instanceof OnePageAnalyzerError) throw err;

    // Falha de schema na primeira tentativa — fazemos 1 retry com instrucao
    // de correcao. Se falhar de novo, propagamos sem inventar analise (o
    // caller decide como tratar — UI pode oferecer "tentar novamente").
    if (err instanceof NoObjectGeneratedError) {
      try {
        const { object } = await generateObject({
          model: provider(opts.model),
          schema: OnePageAnalysisSchema,
          system: ONE_PAGE_SYSTEM_PROMPT,
          prompt:
            userPrompt +
            "\n\nSua resposta anterior nao casou com o schema obrigatorio. " +
            "Refaca seguindo o schema EXATAMENTE — todos os campos, todos os tipos.",
          temperature: opts.temperature,
          maxOutputTokens: opts.maxOutputTokens,
        });
        const verified = OnePageAnalysisSchema.safeParse(object);
        if (!verified.success) {
          throw new OnePageAnalyzerError(
            `Retry da IA tambem falhou no schema: ${verified.error.message}`,
            verified.error,
          );
        }
        return verified.data;
      } catch (retryErr) {
        throw new OnePageAnalyzerError(
          "IA falhou em produzir resposta no schema apos 2 tentativas.",
          retryErr,
        );
      }
    }

    throw new OnePageAnalyzerError(
      `Falha ao gerar analise One Page: ${err instanceof Error ? err.message : "erro desconhecido"}`,
      err,
    );
  }
}
