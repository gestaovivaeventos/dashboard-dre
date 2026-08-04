import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { resolveAiProvider, logResolvedUsage, generateJsonViaChat } from "@/lib/ai/provider";

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
  // Teto generoso p/ nao truncar o JSON no DeepSeek (json_object gera mais
  // tokens que o structured output da OpenAI) e para caber o RACIOCINIO dos
  // modelos V4, que consome o mesmo orcamento da resposta. Cap, nao cobranca.
  maxOutputTokens: 16000,
};

// JSON Schema textual da analise — injetado no prompt de provedores sem
// json_schema nativo (DeepSeek etc.). Memoizado; falha na conversao → sem hint.
let cachedAnalysisSchemaHint: string | null | undefined;
function analysisSchemaHint(): string | undefined {
  if (cachedAnalysisSchemaHint === undefined) {
    try {
      cachedAnalysisSchemaHint = JSON.stringify(z.toJSONSchema(OnePageAnalysisSchema));
    } catch {
      cachedAnalysisSchemaHint = null;
    }
  }
  return cachedAnalysisSchemaHint ?? undefined;
}

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

  // Resolve o provedor ativo. `options.apiKey` força OpenAI direto (testes).
  const resolved = options.apiKey ? null : await resolveAiProvider({ capability: "text" });
  const openaiTest = options.apiKey ? createOpenAI({ apiKey: options.apiKey }) : null;
  const modelName = options.model ?? resolved?.modelName ?? opts.model;
  const userPrompt = buildOnePageUserPrompt(input);

  // OpenAI usa generateObject (json_schema); compatíveis (DeepSeek) usam
  // json_object via generateJsonViaChat, validado pelo mesmo schema Zod.
  const isOpenAi = !resolved || resolved.providerName === "openai";

  const runOnce = async (prompt: string): Promise<{ object: unknown; usage: unknown }> => {
    if (isOpenAi) {
      const provider = resolved ? resolved.provider : openaiTest!;
      const { object, usage } = await generateObject({
        model: provider.chat(modelName),
        schema: OnePageAnalysisSchema,
        system: ONE_PAGE_SYSTEM_PROMPT,
        prompt,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
      });
      return { object, usage };
    }
    return generateJsonViaChat(resolved!, {
      system: ONE_PAGE_SYSTEM_PROMPT,
      prompt,
      temperature: opts.temperature,
      maxTokens: opts.maxOutputTokens,
      modelName,
      schemaHint: analysisSchemaHint(),
    });
  };

  const attempt = async (prompt: string): Promise<OnePageAnalysis> => {
    const { object, usage } = await runOnce(prompt);
    const verified = OnePageAnalysisSchema.safeParse(object);
    if (!verified.success) {
      throw new OnePageAnalyzerError(
        `Resposta da IA nao casou com o schema: ${verified.error.message}`,
        verified.error,
      );
    }
    if (resolved) await logResolvedUsage(resolved, "bi", usage);
    return verified.data;
  };

  try {
    return await attempt(userPrompt);
  } catch {
    try {
      return await attempt(
        userPrompt +
          "\n\nSua resposta anterior nao casou com o schema obrigatorio. " +
          "Refaca seguindo o schema EXATAMENTE — todos os campos, todos os tipos.",
      );
    } catch (retryErr) {
      if (retryErr instanceof OnePageAnalyzerError) throw retryErr;
      throw new OnePageAnalyzerError(
        `Falha ao gerar analise One Page: ${retryErr instanceof Error ? retryErr.message : "erro desconhecido"}`,
        retryErr,
      );
    }
  }
}
