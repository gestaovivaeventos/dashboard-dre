import { NextRequest } from "next/server";
import { streamText } from "ai";

import { opcoesSdk } from "@/lib/ai/parametros-chat";
import { logResolvedUsage, resolveAiProvider } from "@/lib/ai/provider";
import { getOrcamentoUser, SEM_ACESSO } from "@/lib/orcamento/auth";
import {
  montarPromptViagem,
  persistirConversaViagem,
} from "@/lib/orcamento/actions/viagens-entrevista";
import { extrairCartaoViagem, type MensagemViagem } from "@/lib/viagens/cartao";

// Streaming de UM turno da ENTREVISTA de viagem.
//
// A resposta vai em texto corrido e o cliente a desenha token a token. Dois
// marcadores podem vir no FIM: o cartão [[VIAGEM]]{…}[[/VIAGEM]], que o cliente
// transforma no formulário preenchido, e [[FECHAR]], que libera o botão de
// encerrar. O cliente corta o texto no primeiro "[[" para nenhum deles aparecer
// na tela — ver `extrairCartaoViagem`.
//
// NADA é gravado no orçamento por aqui. O cartão só vira roteiro quando o gestor
// clica, e a gravação passa por `salvarViagem`, que é onde o custo é calculado e
// as travas (validação e finalização) valem.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatBody {
  companyId?: string;
  year?: number;
  viagemId?: string;
  conversa?: MensagemViagem[];
  texto?: string;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function POST(req: NextRequest): Promise<Response> {
  // Conduzir a entrevista é construir o orçamento: liberado a quem tem o módulo.
  // O recorte por empresa e setor é conferido dentro de `montarPromptViagem` —
  // aqui nenhum número entra no orçamento.
  const user = await getOrcamentoUser();
  if (!user) return json(403, { error: SEM_ACESSO });

  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return json(400, { error: "Corpo inválido." });
  }

  const { companyId = "", year = 0, viagemId = "", conversa = [], texto = "" } = body;

  // Prompt e provedor em PARALELO: o preparo do prompt são consultas curtas, e
  // resolver o provedor lê a configuração de IA.
  const [prep, resolved] = await Promise.all([
    montarPromptViagem({ companyId, year, viagemId, texto, conversa }),
    // Segue o PROVEDOR ATIVO do painel, como o resto do sistema. Tela que fixa
    // provedor no código é tela que ninguém consegue reconfigurar — foi o que
    // manteve a entrevista do Planejamento no Gemini depois da troca.
    resolveAiProvider({ capability: "text" }),
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
    // A entrevista PERGUNTA — resposta idêntica a cada rodada soaria de
    // formulário. Mas as famílias novas da OpenAI RECUSAM `temperature` e o
    // stream volta vazio, sem erro visível: por isso passa por `opcoesSdk`.
    ...opcoesSdk(resolved.modelName, { temperature: 0.4 }),
    onFinish: async ({ text, usage }) => {
      // Guarda a mensagem SEM os marcadores: o transcript é o que a diretoria
      // pode ler na validação, e [[VIAGEM]]{…} ali seria ruído.
      const { texto: limpo } = extrairCartaoViagem(text);
      const novaConversa: MensagemViagem[] = [
        ...(Array.isArray(conversa) ? conversa : []),
        ...(textoUsuario ? [{ role: "user" as const, content: textoUsuario }] : []),
        { role: "assistant" as const, content: limpo },
      ];

      await Promise.all([
        persistirConversaViagem(viagemId, novaConversa),
        logResolvedUsage(resolved, "orcamento", usage, { companyId, userId: user.userId }),
      ]);
    },
  });

  return result.toTextStreamResponse();
}
