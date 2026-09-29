import { NextRequest } from "next/server";

import { resolveAiProvider, logAiUsage } from "@/lib/ai/provider";
import {
  TRANSCRICAO_MAX_BYTES,
  TRANSCRICAO_MODELO,
  extensaoDoAudio,
  montarDicaTranscricao,
  usoDaTranscricao,
} from "@/lib/ai/transcricao";
import { getOrcamentoUser, SEM_ACESSO } from "@/lib/orcamento/auth";

// Ditado da ENTREVISTA do Planejamento dos gestores: recebe o áudio gravado
// no navegador e devolve SÓ o texto. Nada é gravado — nem o áudio, nem o
// texto (ele só entra no transcript quando o gestor clica em Enviar, pela rota
// do chat).
//
// Sempre OpenAI, qualquer que seja o provedor ativo: Gemini/DeepSeek não têm o
// endpoint de transcrição compatível. A chave é a do painel de IA (ou
// OPENAI_API_KEY), resolvida pelo mesmo `resolveAiProvider`.
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

  let resolved;
  try {
    resolved = await resolveAiProvider({ forceProvider: "openai" });
  } catch {
    return json(503, {
      error: "O ditado precisa de uma chave da OpenAI. Peça ao administrador para cadastrá-la em Painel › IA.",
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
      errorMessage: erro ?? null,
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
