import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import {
  resolveAiProvider,
  logResolvedUsage,
  generateJsonViaChat,
  type ResolvedAiProvider,
} from "@/lib/ai/provider";

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
  /**
   * Contexto de negocio informado por um humano (tela Validacao Relatorio,
   * acao "Adicionar contexto"). Entra APENAS na leitura textual: e anexado ao
   * user prompt como informacao complementar, nunca substitui, corrige ou
   * recalcula qualquer numero — os valores continuam vindo do payload.
   */
  businessContext?: string;
}

const DEFAULT_OPTIONS: Required<
  Omit<AnalyzerOptions, "apiKey" | "businessContext">
> = {
  model: "gpt-4o-mini",
  temperature: 0.2,
  // Teto generoso: o relatorio cabe em ~2000 tokens na OpenAI (structured
  // output compacto), mas o DeepSeek em json_object gera mais tokens para o
  // mesmo conteudo. Alem disso, nos modelos V4 o RACIOCINIO consome o mesmo
  // orcamento: chamadas reais deste relatorio gastaram 2.6k-5.8k tokens de
  // saida, e com 8000 o raciocinio esgotava o teto e voltava sem JSON. 16000
  // da folga real (o modelo suporta bem mais). Cap, nao cobranca — so e gasto
  // o que o modelo realmente gera.
  maxOutputTokens: 16000,
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
  const basePrompt = buildOnePageReportUserPrompt(input);
  // Contexto de negocio do CSC: entra como bloco delimitado ao final do user
  // prompt, com a regra explicita de que ele NAO altera nenhum numero. Assim a
  // empresa/periodo do relatorio continuam sendo os do payload — o contexto
  // nunca "vaza" para outra empresa porque e sempre passado junto da geracao
  // daquele relatorio especifico.
  const context = options.businessContext?.trim();
  const userPrompt = context
    ? `${basePrompt}

CONTEXTO DE NEGOCIO INFORMADO PELA CONTROLADORIA (CSC)
-----------------------------------------------------
${context}
-----------------------------------------------------
REGRAS PARA USAR ESTE CONTEXTO:
- Ele explica/qualifica os numeros do periodo desta empresa. Incorpore-o ao
  diagnostico, aos destaques, aos pontos de atencao e as acoes recomendadas.
- NAO altere, recalcule, corrija ou substitua NENHUM valor financeiro: todos
  os numeros continuam sendo exatamente os fornecidos acima.
- NAO invente dados que nao estejam nos numeros nem neste contexto.
- Reescreva o contexto com linguagem executiva; nao o copie literalmente.`
    : basePrompt;
  // Seleciona o contexto de negocio conforme o segmento da empresa.
  const systemPrompt = resolveOnePageSystemPrompt(input);

  // OpenAI (nativo) usa generateObject com structured outputs (json_schema).
  // Provedores compatíveis (DeepSeek etc.) só aceitam json_object → caminho cru
  // via generateJsonViaChat, validado pelo mesmo schema Zod.
  const isOpenAi = !resolved || resolved.providerName === "openai";

  // Uma tentativa contra UM provedor. `target` null = OpenAI direto por
  // options.apiKey (testes).
  const runOnce = async (
    target: ResolvedAiProvider | null,
    prompt: string,
  ): Promise<{ object: unknown; usage: unknown }> => {
    const targetIsOpenAi = !target || target.providerName === "openai";
    const targetModel =
      target === resolved ? modelName : (target?.modelName ?? opts.model);

    if (targetIsOpenAi) {
      const provider = target ? target.provider : openaiTest!;
      const { object, usage } = await generateObject({
        model: provider.chat(targetModel),
        schema: OnePageReportSchema,
        system: systemPrompt,
        prompt,
        temperature: opts.temperature,
        maxOutputTokens: opts.maxOutputTokens,
      });
      return { object, usage };
    }
    return generateJsonViaChat(target!, {
      system: systemPrompt,
      prompt,
      temperature: opts.temperature,
      maxTokens: opts.maxOutputTokens,
      modelName: targetModel,
      schemaHint: reportSchemaHint(),
    });
  };

  // Uma tentativa: gera, valida com o schema e loga o consumo. Lança em falha.
  const attempt = async (
    target: ResolvedAiProvider | null,
    prompt: string,
  ): Promise<OnePageReport> => {
    const { object, usage } = await runOnce(target, prompt);
    const verified = OnePageReportSchema.safeParse(object);
    if (!verified.success) {
      throw new OnePageReportError(
        `Resposta da IA nao casou com o schema: ${verified.error.message}`,
        verified.error,
      );
    }
    if (target) await logResolvedUsage(target, "bi", usage);
    return verified.data;
  };

  const schemaNudge =
    "\n\nSua resposta anterior nao casou com o schema obrigatorio. " +
    "Refaca seguindo o schema EXATAMENTE — todos os campos com os tipos e enums corretos.";

  try {
    return await attempt(resolved, userPrompt);
  } catch {
    // Retry unico com instrucao de correcao, no MESMO provedor.
    try {
      return await attempt(resolved, userPrompt + schemaNudge);
    } catch (retryErr) {
      // Ultimo recurso: o provedor ativo nao e a OpenAI e falhou duas vezes.
      // Refaz na OpenAI, que usa structured output NATIVO (json_schema) e nao
      // passa pelo caminho de json_object cru — imune a classe de falha
      // "resposta vazia do provedor" do DeepSeek V4 (raciocinio consumindo o
      // orcamento de tokens ou vazio por sobrecarga).
      //
      // Sem chave da OpenAI configurada, resolveAiProvider lanca e o erro
      // original e preservado abaixo — o fallback nunca mascara a causa real.
      if (!isOpenAi && resolved) {
        try {
          const fallback = await resolveAiProvider({
            capability: "text",
            forceProvider: "openai",
          });
          console.warn(
            `[one-page] ${resolved.providerName}/${modelName} falhou duas vezes ` +
              `(${retryErr instanceof Error ? retryErr.message : "erro desconhecido"}) — ` +
              `refazendo em openai/${fallback.modelName}.`,
          );
          return await attempt(fallback, userPrompt);
        } catch (fallbackErr) {
          console.error(
            "[one-page] Fallback para OpenAI tambem falhou:",
            fallbackErr instanceof Error ? fallbackErr.message : fallbackErr,
          );
        }
      }

      if (retryErr instanceof OnePageReportError) throw retryErr;
      throw new OnePageReportError(
        `Falha ao gerar One Page Report: ${retryErr instanceof Error ? retryErr.message : "erro desconhecido"}`,
        retryErr,
      );
    }
  }
}
