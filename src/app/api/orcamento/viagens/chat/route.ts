import { NextRequest } from "next/server";
import { stepCountIs, streamText, tool } from "ai";
import { z } from "zod";

import { mensagemDeFalha } from "@/lib/ai/erros";
import { opcoesSdk } from "@/lib/ai/parametros-chat";
import { logResolvedUsage, resolveAiProvider } from "@/lib/ai/provider";
import { getOrcamentoUser, SEM_ACESSO } from "@/lib/orcamento/auth";
import {
  montarPromptViagem,
  persistirConversaViagem,
} from "@/lib/orcamento/actions/viagens-entrevista";
import { buscarPrecos, mesAno } from "@/lib/viagens/precos/buscar";
import { marcarStatus } from "@/lib/viagens/stream-status";
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
// tem a tool `buscar_precos`, e `stopWhen` para o modelo poder chamá-la e depois
// continuar escrevendo. Sem o `stopWhen`, o SDK para no primeiro passo e a
// chamada da ferramenta nunca viraria texto.
//
// ── Por que existe um canal de STATUS (02/10/2026) ────────────────────────
// Enquanto a busca roda, o `textStream` fica em SILÊNCIO TOTAL — nenhum token sai
// até o modelo voltar a escrever. No primeiro uso real isso foi lido como "a IA
// travou", e com razão: eram dezenas de segundos sem sinal nenhum. Agora a tool
// escreve marcas de status no MESMO stream (ver `stream-status.ts`) e a tela as
// mostra como linha de progresso. Três travas vieram junto:
//
//   1. teto CURTO na busca dentro da conversa (a pessoa está olhando a tela);
//   2. `stopWhen: stepCountIs(3)` — no máximo duas buscas, não quatro;
//   3. falha no meio do turno vira TEXTO para o usuário, nunca silêncio.
//
// NADA é gravado no orçamento por aqui: o cartão só vira roteiro quando o gestor
// clica, e a gravação passa por `salvarViagem`, onde o custo é calculado e as
// travas valem.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Teto da busca DENTRO da conversa, por tentativa. Fora dela o padrão é maior. */
const BUSCA_TIMEOUT_CHAT_MS = 45_000;

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
  const encoder = new TextEncoder();

  // ── O canal de status ──
  // A tool escreve aqui; o stream da resposta drena. Quando a tool roda ANTES de
  // o controller existir, a marca fica na fila e sai assim que ele abre.
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const fila: string[] = [];
  const emitirStatus = (txt: string) => {
    const marca = marcarStatus(txt);
    if (controller) {
      try {
        controller.enqueue(encoder.encode(marca));
        return;
      } catch {
        // Stream já fechado (cliente desistiu): status não tem para onde ir.
        return;
      }
    }
    fila.push(marca);
  };

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
      // O usuário tem de SABER que a espera é pesquisa, e sobre o quê.
      const alvos = [
        trechos.length > 0 ? `${trechos.length} trecho(s)` : null,
        cidades.length > 0 ? `hotel em ${cidades.length} cidade(s)` : null,
      ]
        .filter(Boolean)
        .join(" e ");
      emitirStatus(`pesquisando preços na web — ${alvos || "nada a cotar"}`);

      const res = await buscarPrecos({
        trechos,
        cidades: cidades.filter((c) => c.noites > 0),
        quando: mesAno(quando),
        timeoutMs: BUSCA_TIMEOUT_CHAT_MS,
      });

      if (!res.ok) {
        emitirStatus("a pesquisa não achou preço — seguindo sem ele");
        // O erro volta ao MODELO como resultado, não como exceção: assim ele diz
        // ao gestor que não achou, em vez de o turno inteiro morrer.
        return { encontrado: false, motivo: res.error };
      }

      emitirStatus("preços encontrados — montando a proposta");
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

  let erroDoTurno: string | null = null;

  const result = streamText({
    model: resolved.provider.chat(resolved.modelName),
    system: prep.system,
    messages: prep.messages,
    tools: { buscar_precos: buscarPrecosTool },
    // Duas buscas no máximo (comparar duas formas de ir) mais a resposta. Era 4;
    // baixou para 3 porque cada passo com busca é tempo de alguém esperando.
    stopWhen: stepCountIs(3),
    // Resposta idêntica a cada rodada soaria de formulário. As famílias novas da
    // OpenAI RECUSAM `temperature` e o stream volta vazio, sem erro visível: por
    // isso passa por `opcoesSdk`.
    ...opcoesSdk(resolved.modelName, { temperature: 0.4 }),
    // Sem isto a falha do provedor (sem crédito, parâmetro recusado, modelo sem
    // suporte a tool) encerrava o stream CALADO — a tela ficava girando e o
    // terminal não dizia nada.
    onError: ({ error }) => {
      erroDoTurno = error instanceof Error ? error.message : String(error);
      console.error("[orcamento/viagens] falha no turno do agente:", erroDoTurno);
    },
    onFinish: async ({ text, usage }) => {
      // Guarda a mensagem SEM os marcadores: o transcript é o que a diretoria
      // pode ler na validação, e [[VIAGEM]]{…} ali seria ruído.
      const { texto: limpo } = extrairCartaoViagem(text);
      if (!limpo.trim()) return; // turno sem resposta não entra no transcript

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

  // Stream montado à mão (em vez de `toTextStreamResponse()`) por dois motivos:
  // as marcas de status precisam entrar no mesmo canal, e a falha no meio do
  // turno tem de chegar ao usuário como TEXTO em vez de encerrar em silêncio.
  const stream = new ReadableStream<Uint8Array>({
    async start(c) {
      controller = c;
      for (const marca of fila) c.enqueue(encoder.encode(marca));
      fila.length = 0;

      let escreveu = false;
      try {
        for await (const parte of result.textStream) {
          if (parte) escreveu = true;
          c.enqueue(encoder.encode(parte));
        }
      } catch (err) {
        erroDoTurno = err instanceof Error ? err.message : String(err);
        console.error("[orcamento/viagens] stream do agente interrompido:", erroDoTurno);
      }

      // Resposta vazia é o pior resultado: a tela mostraria uma bolha em branco
      // e ninguém saberia por quê. Diz o motivo.
      if (!escreveu) {
        // `mensagemDeFalha` traduz o que tem conserto conhecido (sem crédito,
        // chave recusada, limite) e deixa o resto cru — mensagem técnica é feia
        // mas diz algo, e "erro inesperado" não diz nada.
        const motivo = erroDoTurno
          ? mensagemDeFalha(erroDoTurno)
          : "Não consegui responder agora (o provedor de IA devolveu uma resposta vazia). Tente de novo.";
        c.enqueue(encoder.encode(marcarStatus("erro")));
        c.enqueue(encoder.encode(motivo));
      }

      controller = null;
      c.close();
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      // Impede buffering de proxy: sem isto as marcas de status só chegariam
      // junto com o resto, e o canal de progresso não serviria para nada.
      "x-accel-buffering": "no",
    },
  });
}
