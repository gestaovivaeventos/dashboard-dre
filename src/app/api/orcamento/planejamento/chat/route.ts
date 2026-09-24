import { NextRequest } from "next/server";
import { streamText } from "ai";

import { resolveAiProvider, logResolvedUsage } from "@/lib/ai/provider";
import { getOrcamentoUser, SEM_ACESSO } from "@/lib/orcamento/auth";
import {
  montarPromptEntrevista,
  persistirConversaEntrevista,
  type EntrevistaRealizadoCache,
} from "@/lib/orcamento/actions/planejamento-entrevista";
import { extrairCartaoDespesa, type PlanejamentoMensagem } from "@/lib/orcamento/planejamento-calc";

// Streaming de UM turno da ENTREVISTA (Planejamento dos gestores).
//
// A resposta vai em texto corrido e o cliente a desenha token a token. Dois
// marcadores podem vir no FIM: o cartão [[DESPESA]]{…}[[/DESPESA]], que o
// cliente transforma no cartão de confirmação, e [[FECHAR]], que libera o botão
// de encerrar. O cliente corta o texto no primeiro "[[" para nenhum deles
// aparecer na tela — ver `extrairCartaoDespesa`.
//
// O modo 'fechamento' usa a MESMA rota: muda só o prompt (a IA escreve a
// justificativa final em vez de perguntar).
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
  setorId?: string | null;
  conversa?: PlanejamentoMensagem[];
  texto?: string;
  modo?: "entrevista" | "fechamento";
  realizadoCache?: EntrevistaRealizadoCache | null;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Conduzir a entrevista é construir o orçamento: liberado a quem tem o
  // módulo. O recorte por empresa/setor é conferido dentro de
  // `montarPromptEntrevista`, e o de ESCRITA vale quando a despesa é gravada
  // (`adicionarDespesa`) — aqui nenhum número entra no orçamento.
  const user = await getOrcamentoUser();
  if (!user) return json(403, { error: SEM_ACESSO });

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
    setorId = null,
    conversa = [],
    texto = "",
    modo = "entrevista",
    realizadoCache = null,
  } = body;

  // Prompt e provedor em PARALELO — o preparo do prompt são consultas curtas,
  // e resolver o provedor lê a configuração de IA.
  const [prep, resolved] = await Promise.all([
    montarPromptEntrevista({
      companyId,
      year,
      categoryCode,
      setorId,
      texto,
      conversa,
      modo,
      realizadoCache,
    }),
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
    onFinish: async ({ text, usage }) => {
      // Guarda a mensagem SEM os marcadores: o transcript é o que a diretoria
      // lê na validação, e [[DESPESA]]{…} ali seria ruído.
      const { texto: limpo } = extrairCartaoDespesa(text);
      const novaConversa: PlanejamentoMensagem[] =
        modo === "fechamento"
          ? Array.isArray(conversa)
            ? conversa
            : []
          : [
              ...(Array.isArray(conversa) ? conversa : []),
              ...(textoUsuario ? [{ role: "user" as const, content: textoUsuario }] : []),
              { role: "assistant" as const, content: limpo },
            ];

      await Promise.all([
        persistirConversaEntrevista(
          companyId,
          year,
          categoryCode,
          setorId,
          categoryName,
          novaConversa,
          // No fechamento, a resposta INTEIRA é a justificativa.
          modo === "fechamento" ? limpo : undefined,
        ),
        logResolvedUsage(resolved, "orcamento", usage, { companyId, userId: user.userId }),
      ]);
    },
  });

  return result.toTextStreamResponse();
}
