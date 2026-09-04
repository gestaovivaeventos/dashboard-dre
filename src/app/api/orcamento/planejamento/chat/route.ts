import { NextRequest } from "next/server";
import { streamText } from "ai";

import { resolveAiProvider, logResolvedUsage } from "@/lib/ai/provider";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import {
  montarPromptEntrevista,
  persistirConversaEntrevista,
  type PlanejamentoContextoItem,
  type PlanejamentoPromptContexto,
} from "@/lib/orcamento/actions/planejamento-socios";
import { limparMarcadorFechar, type PlanejamentoMensagem } from "@/lib/orcamento/planejamento-calc";

// Streaming de UM turno da ENTREVISTA (Planejamento dos gestores). Retorna a
// resposta da IA em texto corrido (o cliente lê o stream e vai desenhando).
// O ENCERRAR (que gera a proposta em JSON) NÃO passa por aqui — segue no server
// action `enviarMensagemPlanejamento`, que precisa da resposta estruturada.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesmo roteamento do módulo: força Gemini (texto) com fallback ao provedor ativo.
async function resolverProvedor() {
  try {
    return await resolveAiProvider({ forceProvider: "gemini", capability: "text" });
  } catch {
    return await resolveAiProvider({ capability: "text" });
  }
}

interface ChatBody {
  companyId?: string;
  year?: number;
  categoryCode?: string;
  categoryName?: string;
  conversa?: PlanejamentoMensagem[];
  texto?: string;
  itensContexto?: PlanejamentoContextoItem[];
  promptCtx?: PlanejamentoPromptContexto;
  /** Setor da tela: o planejamento da categoria é o deste setor. */
  setorId?: string | null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return json(403, { error: "Acesso restrito a administradores." });

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return json(400, { error: "Corpo inválido." });
  }

  const {
    companyId = "",
    year = 0,
    categoryCode = "",
    categoryName = "",
    conversa = [],
    texto = "",
    itensContexto = [],
    promptCtx,
    setorId = null,
  } = body;

  // Prompt (system + messages) e provedor em PARALELO.
  const [prep, resolved] = await Promise.all([
    montarPromptEntrevista(
      companyId,
      year,
      categoryCode,
      categoryName,
      conversa,
      texto,
      itensContexto,
      promptCtx,
      setorId ?? null,
    ),
    resolverProvedor(),
  ]);
  if (prep.needsMigration) return json(409, { needsMigration: true });
  if (prep.error || !prep.system || !prep.messages) {
    return json(400, { error: prep.error ?? "Falha ao preparar a entrevista." });
  }

  const textoUsuario = (texto ?? "").trim();

  const result = streamText({
    model: resolved.provider.chat(resolved.modelName),
    system: prep.system,
    messages: prep.messages,
    temperature: 0.4,
    // Depois de gerar a resposta completa, persiste a conversa (sem o marcador)
    // e registra o consumo — tudo server-side, o cliente não precisa esperar.
    onFinish: async ({ text, usage }) => {
      const { texto: limpo } = limparMarcadorFechar(text);
      const novaConversa: PlanejamentoMensagem[] = [
        ...(Array.isArray(conversa) ? conversa : []),
        ...(textoUsuario ? [{ role: "user" as const, content: textoUsuario }] : []),
        { role: "assistant" as const, content: limpo },
      ];
      await Promise.all([
        persistirConversaEntrevista(companyId, year, categoryCode, categoryName, novaConversa),
        logResolvedUsage(resolved, "orcamento", usage, { companyId, userId: admin.userId }),
      ]);
    },
  });

  return result.toTextStreamResponse();
}
