import { NextRequest } from "next/server";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { opcoesSdk } from "@/lib/ai/parametros-chat";
import { logResolvedUsage, resolveAiProvider } from "@/lib/ai/provider";
import { getOrcamentoUser, SEM_ACESSO } from "@/lib/orcamento/auth";
import {
  montarPromptViagem,
  persistirConversaViagem,
} from "@/lib/orcamento/actions/viagens-entrevista";
import { buscarPrecos, mesAno } from "@/lib/viagens/precos/buscar";
import { extrairCartaoViagem, type MensagemViagem } from "@/lib/viagens/cartao";

// Streaming de UM turno do AGENTE DE VIAGEM.
//
// A resposta vai em texto corrido e o cliente a desenha token a token. Dois
// marcadores podem vir no FIM: o cartão [[VIAGEM]]{…}[[/VIAGEM]], que o cliente
// transforma no roteiro preenchido, e [[FECHAR]]. O cliente corta o texto no
// primeiro "[[" para nenhum deles aparecer na tela.
//
// ── A FERRAMENTA de busca de preços ───────────────────────────────────────
// O agente não é um entrevistador: ele PESQUISA antes de propor. Por isso o turno
// tem a tool `buscar_precos`, e `stopWhen: stepCountIs(4)` para o modelo poder
// chamá-la (às vezes mais de uma vez, comparando duas formas de fazer o trajeto)
// e depois continuar escrevendo a resposta. Sem o `stopWhen`, o SDK para no
// primeiro passo e a chamada da ferramenta nunca viraria texto.
//
// Consequência de UX assumida: a busca na web leva dezenas de segundos, e o
// stream fica em silêncio enquanto ela roda. A tela avisa isso — é o preço de o
// preço ser pesquisado em vez de inventado.
//
// NADA é gravado no orçamento por aqui: o cartão só vira roteiro quando o gestor
// clica, e a gravação passa por `salvarViagem`, onde o custo é calculado e as
// travas valem.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A busca na web é lenta; o teto da Vercel para esta rota precisa acomodá-la.
export const maxDuration = 300;

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
  // Conduzir a conversa é construir o orçamento: liberado a quem tem o módulo.
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
    // provedor no código é tela que ninguém consegue reconfigurar.
    resolveAiProvider({ capability: "text" }),
  ]);
  if (prep.needsMigration) return json(409, { needsMigration: true });
  if (prep.error || !prep.system || !prep.messages) {
    return json(400, { error: prep.error ?? "Falha ao preparar a conversa." });
  }

  const textoUsuario = (texto ?? "").trim();

  /**
   * A busca de preços, como ferramenta do agente.
   *
   * O modelo passa as cidades por NOME (é o que ele tem na conversa) e um
   * identificador por trecho. Quem valida e pesquisa é o servidor — a tool não
   * aceita preço vindo do modelo, só a pergunta.
   */
  const buscarPrecosTool = tool({
    description:
      "Pesquisa na web o preço REAL de passagem (só ida, por pessoa) de cada trecho e a diária de " +
      "hotel de cada cidade. Use antes de propor o roteiro. Não pesquisa carro/van: ali o custo sai " +
      "do R$/km da empresa, informando a distância. Devolve só o que encontrou, com a fonte.",
    inputSchema: z.object({
      quando: z
        .string()
        .nullable()
        .describe("Data da ida no formato AAAA-MM-DD, ou null se ainda não definida."),
      trechos: z
        .array(
          z.object({
            id: z.string().describe("Identificador curto e único do trecho, ex.: 'p0', 'volta'."),
            de: z.string().describe("Cidade de partida."),
            para: z.string().describe("Cidade de chegada."),
            modal: z.enum(["aviao", "onibus"]),
          }),
        )
        .describe("Trechos de avião/ônibus a cotar. Vazio se não houver nenhum."),
      cidades: z
        .array(
          z.object({
            cidade: z.string(),
            noites: z.number().describe("Noites de hospedagem nesta cidade."),
          }),
        )
        .describe("Cidades com pernoite, para a diária de hotel. Vazio se não houver."),
    }),
    execute: async ({ quando, trechos, cidades }) => {
      const res = await buscarPrecos({
        trechos,
        cidades: cidades.filter((c) => c.noites > 0),
        quando: mesAno(quando),
      });
      if (!res.ok) {
        // O erro volta ao MODELO como resultado, não como exceção: assim ele diz
        // ao gestor que não achou, em vez de o turno inteiro morrer.
        return { encontrado: false, motivo: res.error };
      }
      return {
        encontrado: true,
        trechos: res.data.trechos,
        hoteis: res.data.hoteis,
        fontes: res.fontes,
        aviso:
          "Estes preços são REFERÊNCIA de hoje para a rota no mês pedido, não cotação: para " +
          "viagem do ano que vem a tarifa ainda não foi publicada. Diga isso ao gestor.",
      };
    },
  });

  const result = streamText({
    model: resolved.provider.chat(resolved.modelName),
    system: prep.system,
    messages: prep.messages,
    tools: { buscar_precos: buscarPrecosTool },
    // O agente precisa de passos para pesquisar e DEPOIS responder. Quatro cobre
    // duas buscas (comparar duas formas de ir) mais a resposta final.
    stopWhen: stepCountIs(4),
    // Resposta idêntica a cada rodada soaria de formulário. As famílias novas da
    // OpenAI RECUSAM `temperature` e o stream volta vazio, sem erro visível: por
    // isso passa por `opcoesSdk`.
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
