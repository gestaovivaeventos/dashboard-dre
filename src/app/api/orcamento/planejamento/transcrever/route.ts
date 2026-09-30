import { NextRequest } from "next/server";

import {
  resolveAiProvider,
  logAiUsage,
  transcreverAudioNative,
  type ResolvedAiProvider,
} from "@/lib/ai/provider";
import {
  TRANSCRICAO_MAX_BYTES,
  TRANSCRICAO_MODELO,
  TRANSCRICAO_MODELO_GEMINI,
  extensaoDoAudio,
  limparTranscricao,
  mimeParaGemini,
  montarDicaTranscricao,
  montarPromptGemini,
  usoDaTranscricao,
  usoGemini,
} from "@/lib/ai/transcricao";
import { getOrcamentoUser, SEM_ACESSO } from "@/lib/orcamento/auth";

// Ditado da ENTREVISTA do Planejamento dos gestores: recebe o áudio gravado
// no navegador e devolve SÓ o texto. Nada é gravado — nem o áudio, nem o
// texto (ele só entra no transcript quando o gestor clica em Enviar, pela rota
// do chat).
//
// Transcreve no GEMINI, pela API nativa (`generateContent` com o áudio em
// inline_data) — não existe `/v1/audio/transcriptions` do lado do Google, e a
// camada de compatibilidade OpenAI dele cobre chat e embeddings, não áudio.
// A OpenAI fica como plano B, e o recuo é REGISTRADO em ai_usage_log.
// As chaves são as do painel de IA, resolvidas por `resolveAiProvider`.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Mesmo gate do chat: quem pode conversar pode ditar. O áudio não toca em
  // dado nenhum da empresa, então não há recorte por setor aqui.
  const user = await getOrcamentoUser();
  if (!user) return json(403, { error: SEM_ACESSO });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return json(400, { error: "Não recebi o áudio." });
  }

  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) {
    return json(400, { error: "A gravação veio vazia. Tente falar de novo." });
  }
  if (audio.size > TRANSCRICAO_MAX_BYTES) {
    return json(413, { error: "A gravação ficou longa demais. Divida em partes menores." });
  }
  const ext = extensaoDoAudio(audio.type);
  if (!ext) {
    return json(415, { error: "Este navegador gravou num formato que não consigo ler." });
  }

  const companyId = String(form.get("companyId") ?? "") || null;
  let grupos: string[] = [];
  try {
    const bruto = JSON.parse(String(form.get("grupos") ?? "[]"));
    if (Array.isArray(bruto)) grupos = bruto.filter((g): g is string => typeof g === "string");
  } catch {
    // Dica é opcional — sem ela a transcrição só acerta menos nomes próprios.
  }
  const dica = montarDicaTranscricao({
    categoria: String(form.get("categoria") ?? ""),
    grupos,
  });

  // ── 1) GEMINI, pela API nativa ────────────────────────────────────────────
  // O transcritor padrão desde 29/09/2026. Modelo FIXO (`TRANSCRICAO_MODELO_GEMINI`),
  // não o do painel: o do painel é escolhido para texto/visão e pode ser trocado
  // por um que não ouça.
  const buffer = Buffer.from(await audio.arrayBuffer());
  const prompt = montarPromptGemini(dica);

  let motivoRecuo: string | null = null;
  let gemini: ResolvedAiProvider | null = null;
  try {
    gemini = await resolveAiProvider({ forceProvider: "gemini" });
  } catch {
    gemini = null; // sem chave cadastrada — cai no plano B
  }

  /** Registro do que o GEMINI consumiu (ou do motivo de ele ter falhado). */
  const registrarGemini = (usage: ReturnType<typeof usoGemini>, erro?: string) =>
    logAiUsage({
      module: "orcamento",
      providerName: "gemini",
      modelName: TRANSCRICAO_MODELO_GEMINI,
      usage,
      modelPrices: gemini?.modelPrices ?? {},
      usdBrlRate: gemini?.usdBrlRate ?? 0,
      companyId,
      userId: user.userId,
      success: !erro,
      errorMessage: erro ?? null,
    });

  if (gemini) {
    try {
      const { texto: cru, payload } = await transcreverAudioNative(gemini, {
        prompt,
        data: buffer,
        mediaType: mimeParaGemini(audio.type),
        modelName: TRANSCRICAO_MODELO_GEMINI,
      });
      await registrarGemini(usoGemini(payload));
      const texto = limparTranscricao(cru);
      if (!texto) {
        return json(200, {
          texto: "",
          aviso: "Não entendi nada na gravação. Fale mais perto do microfone.",
        });
      }
      return json(200, { texto });
    } catch (e) {
      motivoRecuo = e instanceof Error ? e.message : String(e);
      console.warn(`[transcrever] Gemini falhou, recuando para a OpenAI: ${motivoRecuo}`);
      await registrarGemini(null, motivoRecuo);
    }
  }

  // ── 2) OpenAI, plano B ────────────────────────────────────────────────────
  // O recuo NUNCA é silencioso: a falha do Gemini já foi registrada acima com o
  // motivo, então o painel de IA mostra que ele não transcreveu. O ditado parar
  // no meio de uma entrevista é pior do que gastar na OpenAI — mas ninguém pode
  // descobrir meses depois que o Gemini nunca funcionou.
  let resolved;
  try {
    resolved = await resolveAiProvider({ forceProvider: "openai" });
  } catch {
    return json(503, {
      error: gemini
        ? "O ditado falhou no Gemini e não há chave da OpenAI para tentar de novo. Avise o administrador."
        : "O ditado precisa de uma chave do Gemini ou da OpenAI. Peça ao administrador para cadastrá-la em Painel › IA.",
    });
  }

  const corpo = new FormData();
  corpo.append("file", audio, `ditado.${ext}`);
  corpo.append("model", TRANSCRICAO_MODELO);
  corpo.append("language", "pt");
  corpo.append("response_format", "json");
  corpo.append("prompt", dica);

  const base = resolved.baseURL ?? "https://api.openai.com/v1";
  const registrar = (usage: ReturnType<typeof usoDaTranscricao>, erro?: string) =>
    logAiUsage({
      module: "orcamento",
      providerName: "openai",
      modelName: TRANSCRICAO_MODELO,
      usage,
      modelPrices: resolved.modelPrices,
      usdBrlRate: resolved.usdBrlRate,
      companyId,
      userId: user.userId,
      success: !erro,
      // Sucesso AQUI ainda é um recuo: sem dizer isso, o painel mostraria uso
      // normal da OpenAI e ninguém perceberia que o Gemini parou de transcrever.
      errorMessage: erro ?? (motivoRecuo ? `plano B apos falha do Gemini: ${motivoRecuo}` : null),
    });

  try {
    const res = await fetch(`${base}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${resolved.apiKey}` },
      body: corpo,
      signal: AbortSignal.timeout(55_000),
    });
    if (!res.ok) {
      const detalhe = (await res.text().catch(() => "")).slice(0, 300);
      console.warn(`[transcrever] OpenAI HTTP ${res.status}: ${detalhe}`);
      await registrar(null, `HTTP ${res.status}: ${detalhe}`);
      return json(502, { error: "Não consegui transcrever agora. Tente de novo ou digite a resposta." });
    }

    const payload = (await res.json()) as { text?: string };
    await registrar(usoDaTranscricao(payload));
    const texto = (payload.text ?? "").trim();
    if (!texto) return json(200, { texto: "", aviso: "Não entendi nada na gravação. Fale mais perto do microfone." });
    return json(200, { texto });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn(`[transcrever] falhou: ${msg}`);
    await registrar(null, msg);
    return json(502, { error: "Não consegui transcrever agora. Tente de novo ou digite a resposta." });
  }
}
