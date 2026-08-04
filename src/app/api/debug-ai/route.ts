import { NextResponse } from "next/server";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveAiProvider } from "@/lib/ai/provider";
import { buildOnePageReportUserPrompt } from "@/lib/financeiro/relatorios/one-page-prompt";
import { resolveOnePageSystemPrompt } from "@/lib/financeiro/relatorios/one-page-prompt";
import { buildOnePagePayload } from "@/lib/financeiro/relatorios/one-page-payload";
import { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// GET /api/debug-ai  (admin)
//
// Diagnóstico do provedor de IA. Existe porque "resposta vazia do provedor" é
// um sintoma, não uma causa: esta rota mostra a resposta CRUA da API (
// finish_reason, usage, tamanho do conteúdo e do raciocínio) em vez de deixar
// o erro genérico chegar na tela.
//
// Uso:
//   /api/debug-ai
//       → provedor ativo, modelo, presença de chave + uma chamada mínima.
//   /api/debug-ai?companyId=<uuid>&dateFrom=2026-07-01&dateTo=2026-07-31
//       → REPRODUZ a chamada real do relatório de BI daquela empresa/período,
//         com o mesmo system prompt, o mesmo tamanho de entrada e o mesmo
//         max_tokens. É esta a que responde "por que o relatório falha".
//
// NUNCA devolve a chave de API — apenas se existe e o tamanho.
// ============================================================================

export const runtime = "nodejs";
export const maxDuration = 300;

const DEFAULT_MAX_TOKENS = 16000;

interface RawChoice {
  message?: { content?: string; reasoning_content?: string };
  finish_reason?: string;
}
interface RawChat {
  choices?: RawChoice[];
  usage?: Record<string, number>;
  error?: unknown;
}

/** Chamada crua, sem retentativa — queremos ver o que o provedor devolve. */
async function rawCall(params: {
  url: string;
  apiKey: string;
  model: string;
  system: string;
  prompt: string;
  maxTokens: number;
  thinkingDisabled: boolean;
}) {
  const started = Date.now();
  const res = await fetch(params.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        { role: "system", content: params.system },
        { role: "user", content: params.prompt },
      ],
      temperature: 0.2,
      max_tokens: params.maxTokens,
      response_format: { type: "json_object" },
      ...(params.thinkingDisabled ? { thinking: { type: "disabled" } } : {}),
    }),
  });

  const elapsedMs = Date.now() - started;
  const bodyText = await res.text().catch(() => "");

  if (!res.ok) {
    return {
      httpStatus: res.status,
      elapsedMs,
      erro: bodyText.slice(0, 600),
    };
  }

  let json: RawChat = {};
  try {
    json = JSON.parse(bodyText) as RawChat;
  } catch {
    return { httpStatus: res.status, elapsedMs, erro: "resposta não é JSON", amostra: bodyText.slice(0, 300) };
  }

  const choice = json.choices?.[0];
  const content = choice?.message?.content ?? "";
  const reasoning = choice?.message?.reasoning_content ?? "";

  return {
    httpStatus: res.status,
    elapsedMs,
    temChoice: Boolean(choice),
    finishReason: choice?.finish_reason ?? null,
    conteudoChars: content.length,
    raciocinioChars: reasoning.length,
    usage: json.usage ?? null,
    // Só o começo — o objetivo é confirmar que veio JSON, não ler o relatório.
    amostraConteudo: content.slice(0, 200),
    diagnostico: content
      ? "OK — o provedor devolveu conteúdo."
      : reasoning
        ? "VAZIO com raciocínio: o modo thinking consumiu o max_tokens antes do JSON."
        : choice?.finish_reason === "length"
          ? "VAZIO com finish_reason=length e sem raciocínio: o teto de tokens é baixo demais."
          : "VAZIO sem raciocínio: provável sobrecarga/instabilidade do provedor.",
  };
}

export async function GET(request: Request) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    return NextResponse.json({ error: "Não autenticado." }, { status: 401 });
  }
  if (profile.profile !== "admin" && profile.role !== "admin") {
    return NextResponse.json({ error: "Acesso restrito ao admin." }, { status: 403 });
  }

  const url = new URL(request.url);
  const companyId = url.searchParams.get("companyId");
  const dateFrom = url.searchParams.get("dateFrom");
  const dateTo = url.searchParams.get("dateTo");

  let resolved;
  try {
    resolved = await resolveAiProvider({ capability: "text" });
  } catch (error) {
    return NextResponse.json(
      {
        etapa: "resolveAiProvider",
        error: error instanceof Error ? error.message : "falha desconhecida",
        dica: "Nenhum provedor com chave configurada. Verifique /admin/ia e as env vars.",
      },
      { status: 400 },
    );
  }

  const info = {
    provedorAtivo: resolved.providerName,
    modelo: resolved.modelName,
    endpoint: resolved.chatCompletionsUrl,
    chaveConfigurada: Boolean(resolved.apiKey),
    chaveTamanho: resolved.apiKey?.length ?? 0,
    caminho:
      resolved.providerName === "openai"
        ? "generateObject (structured output nativo)"
        : "generateJsonViaChat (json_object cru)",
    maxTokensDoRelatorio: DEFAULT_MAX_TOKENS,
    openaiDisponivelComoFallback: Boolean(process.env.OPENAI_API_KEY),
  };

  const thinkingDisabled = resolved.providerName === "deepseek";

  // ── Modo 1: sonda mínima ────────────────────────────────────────────────
  if (!companyId || !dateFrom || !dateTo) {
    const probe = await rawCall({
      url: resolved.chatCompletionsUrl,
      apiKey: resolved.apiKey,
      model: resolved.modelName,
      system: "Você responde apenas com JSON válido.",
      prompt: 'Responda com {"ok": true} e nada mais.',
      maxTokens: DEFAULT_MAX_TOKENS,
      thinkingDisabled,
    });
    return NextResponse.json({
      modo: "sonda mínima",
      info,
      thinkingDesligado: thinkingDisabled,
      resultado: probe,
      proximoPasso:
        "Para reproduzir a falha real do relatório, chame de novo com ?companyId=<uuid>&dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD",
    });
  }

  // ── Modo 2: reproduz a chamada real do relatório ────────────────────────
  const admin = createAdminClient();
  const payload = await buildOnePagePayload(admin, {
    companyId,
    dateFrom,
    dateTo,
  });
  if (!payload.ok) {
    return NextResponse.json(
      { etapa: "buildOnePagePayload", error: payload.error },
      { status: payload.status },
    );
  }

  const systemPrompt = resolveOnePageSystemPrompt(payload.payload.input);
  const userPrompt =
    buildOnePageReportUserPrompt(payload.payload.input) +
    "\n\nResponda APENAS com um único objeto JSON válido, sem texto fora do JSON.";

  const real = await rawCall({
    url: resolved.chatCompletionsUrl,
    apiKey: resolved.apiKey,
    model: resolved.modelName,
    system: systemPrompt,
    prompt: userPrompt,
    maxTokens: DEFAULT_MAX_TOKENS,
    thinkingDisabled,
  });

  return NextResponse.json({
    modo: "chamada real do relatório",
    info,
    thinkingDesligado: thinkingDisabled,
    empresa: payload.payload.input.empresa,
    periodo: payload.payload.input.periodo,
    tamanhoPromptChars: {
      system: systemPrompt.length,
      user: userPrompt.length,
      totalAproxTokens: Math.round((systemPrompt.length + userPrompt.length) / 4),
    },
    resultado: real,
  });
}
