import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { resolveAiProvider, logResolvedUsage, generateJsonViaChat } from "@/lib/ai/provider";

import {
  resolveOnePageSystemPrompt,
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
  // Teto generoso: o relatorio cabe em ~2000 tokens na OpenAI (structured
  // output compacto), mas o DeepSeek em json_object gera mais tokens para o
  // mesmo conteudo — 6000 evita truncar o JSON. Cap, nao cobranca.
  maxOutputTokens: 6000,
};

// JSON Schema textual do relatorio — injetado no prompt dos provedores que nao
// suportam json_schema nativo (DeepSeek etc.) para seguirem a estrutura exata,
// incluindo as descricoes de cada campo. Memoizado; se a conversao falhar,
// segue sem o hint.
let cachedReportSchemaHint: string | null | undefined;
function reportSchemaHint(): string | undefined {
  if (cachedReportSchemaHint === undefined) {
    try {
      cachedReportSchemaHint = JSON.stringify(z.toJSONSchema(OnePageReportSchema));
    } catch {
      cachedReportSchemaHint = null;
    }
  }
  return cachedReportSchemaHint ?? undefined;
}

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

  // Resolve o provedor ativo (OpenAI/DeepSeek/etc.) via config no banco.
  // `options.apiKey` força OpenAI direto (usado em testes) e pula a medição.
  const resolved = options.apiKey ? null : await resolveAiProvider({ capability: "text" });
  const openaiTest = options.apiKey ? createOpenAI({ apiKey: options.apiKey }) : null;
  const modelName = options.model ?? resolved?.modelName ?? opts.model;
  const userPrompt = buildOnePageReportUserPrompt(input);
  // Seleciona o contexto de negocio conforme o segmento da empresa.
  const systemPrompt = resolveOnePageSystemPrompt(input);

  // OpenAI (nativo) usa generateObject com structured outputs (json_schema).
  // Provedores compatíveis (DeepSeek etc.) só aceitam json_object → caminho cru
  // via generateJsonViaChat, validado pelo mesmo schema Zod.
  const isOpenAi = !resolved || resolved.providerName === "openai";

  const runOnce = async (prompt: string): Promise<{ object: unknown; usage: unknown }> => {
    if (isOpenAi) {
      const provider = resolved ? resolved.provider : openaiTest!;
      const { object, usage } = await generateObject({
        model: provider.chat(modelName),
        schema: OnePageReportSchema,
        system: systemPrompt,
        prompt,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
      });
      return { object, usage };
    }
    return generateJsonViaChat(resolved!, {
      system: systemPrompt,
      prompt,
      temperature: opts.temperature,
      maxTokens: opts.maxOutputTokens,
      modelName,
      schemaHint: reportSchemaHint(),
    });
  };

  // Uma tentativa: gera, valida com o schema e loga o consumo. Lança em falha.
  const attempt = async (prompt: string): Promise<OnePageReport> => {
    const { object, usage } = await runOnce(prompt);
    const verified = OnePageReportSchema.safeParse(object);
    if (!verified.success) {
      throw new OnePageReportError(
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
    // Retry unico com instrucao de correcao. Se falhar de novo, propaga.
    try {
      return await attempt(
        userPrompt +
          "\n\nSua resposta anterior nao casou com o schema obrigatorio. " +
          "Refaca seguindo o schema EXATAMENTE — todos os campos com os tipos e enums corretos.",
      );
    } catch (retryErr) {
      if (retryErr instanceof OnePageReportError) throw retryErr;
      throw new OnePageReportError(
        `Falha ao gerar One Page Report: ${retryErr instanceof Error ? retryErr.message : "erro desconhecido"}`,
        retryErr,
      );
    }
  }
}
