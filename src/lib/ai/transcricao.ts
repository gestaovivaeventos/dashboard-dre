// Ditado por voz — as regras PURAS da transcrição de áudio (testadas).
//
// O navegador grava, a rota transcreve e devolve só o texto. O texto cai na
// caixa de resposta SEM ser enviado: o gestor confere antes de mandar, porque
// "cinco mil" ouvido como "cinquenta mil" iria direto para o cartão de
// despesa. O áudio nunca é gravado em lugar nenhum.
//
// ── QUEM TRANSCREVE (29/09/2026) ────────────────────────────────────────────
// O GEMINI, pela API nativa (`generateContent` com o áudio em `inline_data`),
// e não a OpenAI. Não existe endpoint `/v1/audio/transcriptions` do lado do
// Google — a camada de compatibilidade OpenAI dele cobre chat e embeddings,
// não áudio. É o mesmo caminho nativo que o OCR já usa (ver `provider.ts`),
// só trocando o mime de PDF por áudio.
//
// A OpenAI fica como PLANO B, e o recuo é registrado em `ai_usage_log` — nunca
// silencioso: o ditado parar de funcionar no meio de uma entrevista é pior do
// que gastar alguns centavos na OpenAI, mas ninguém pode descobrir meses
// depois que o Gemini nunca transcreveu nada.

/** Plano B. Sucessor do Whisper no mesmo endpoint (/v1/audio/transcriptions). */
export const TRANSCRICAO_MODELO = "gpt-4o-mini-transcribe";

/**
 * O transcritor de verdade.
 *
 * Fixo aqui, e não o modelo do painel de IA: o do painel é escolhido para
 * texto/visão e pode ser trocado por um que não ouça. Medido contra a API real
 * em 29/09/2026 — o áudio entra como `modality: AUDIO` a ~25 tokens por
 * segundo de gravação.
 *
 * `gemini-2.5-flash` foi tentado e **não existe mais** para esta conta: o
 * Google responde 404 apontando justamente para o 3.8.
 */
export const TRANSCRICAO_MODELO_GEMINI = "gemini-3.8-flash";

/**
 * Teto de uma gravação. O limite duro é o corpo da requisição na Vercel
 * (~4,5 MB); a 32 kbps, 5 minutos dão ~1,2 MB, com folga para o Safari, que
 * grava em AAC e ignora o bitrate pedido.
 */
export const TRANSCRICAO_MAX_SEGUNDOS = 300;
export const TRANSCRICAO_MAX_BYTES = 4 * 1024 * 1024;
export const TRANSCRICAO_BITRATE = 32_000;

/**
 * Extensão do arquivo enviado à OpenAI. Ela identifica o formato PELO NOME do
 * arquivo, não pelo content-type — um .webm chamado "audio" é recusado. Chrome
 * e Edge gravam webm/opus; o Safari (iPhone inclusive) grava mp4/AAC.
 * Devolve null para formato que a API não aceita.
 */
export function extensaoDoAudio(mime: string | null | undefined): string | null {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  const mapa: Record<string, string> = {
    "audio/webm": "webm",
    "video/webm": "webm",
    "audio/mp4": "mp4",
    "video/mp4": "mp4",
    "audio/x-m4a": "m4a",
    "audio/m4a": "m4a",
    "audio/aac": "m4a",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
  };
  return mapa[base] ?? null;
}

/**
 * Formato de gravação preferido que o navegador suporta. Recebe o
 * `MediaRecorder.isTypeSupported` para ser testável fora do navegador.
 * String vazia = deixa o navegador escolher (ele ainda cai num formato aceito).
 */
export function escolherFormatoGravacao(suporta: (mime: string) => boolean): string {
  const preferidos = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return preferidos.find((m) => suporta(m)) ?? "";
}

/**
 * Texto de contexto que acompanha o áudio. O transcritor usa isso para acertar
 * a grafia de nomes próprios (categoria, grupos, fornecedores), que é onde ele
 * mais erra sem ajuda. Não é instrução — é vocabulário.
 */
export function montarDicaTranscricao(termos: {
  categoria?: string | null;
  setor?: string | null;
  grupos?: readonly string[] | null;
}): string {
  const limpar = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
  const partes: string[] = [
    "Conversa sobre o orçamento anual de uma empresa brasileira, com valores em reais (R$), meses e periodicidades (mensal, trimestral, anual).",
  ];
  const categoria = limpar(termos.categoria);
  const setor = limpar(termos.setor);
  if (categoria) partes.push(`Categoria: ${categoria}.`);
  if (setor) partes.push(`Setor: ${setor}.`);

  const grupos = Array.from(
    new Set((termos.grupos ?? []).map(limpar).filter((g) => g.length > 0)),
  ).slice(0, 30);
  if (grupos.length) partes.push(`Termos: ${grupos.join(", ")}.`);

  // O campo vem do cliente; o teto impede usá-lo como carga arbitrária.
  return partes.join(" ").slice(0, 800);
}

export interface UsoTranscricao {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

/**
 * Consumo reportado pela API. Os modelos gpt-4o-*-transcribe devolvem tokens
 * (`usage.type = "tokens"`), que entram no painel de IA como qualquer outra
 * chamada. O whisper-1 devolve SEGUNDOS (`type = "duration"`) — aí não há
 * token a registrar e devolvemos null (a chamada é logada sem custo).
 */
export function usoDaTranscricao(payload: unknown): UsoTranscricao | null {
  const usage = (payload as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || usage.type === "duration") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const inputTokens = num(usage.input_tokens);
  const outputTokens = num(usage.output_tokens);
  const totalTokens = num(usage.total_tokens) || inputTokens + outputTokens;
  if (!totalTokens) return null;
  return { inputTokens, outputTokens, totalTokens };
}


// ─── Gemini: prompt, limpeza e consumo ──────────────────────────────────────

/**
 * O que se pede ao Gemini.
 *
 * Um modelo de chat não é um transcritor: sem instrução ele comenta o áudio,
 * resume, ou responde ao que foi dito. As três regras abaixo existem cada uma
 * por um motivo, e nenhuma é decorativa:
 *
 * 1. **Só a transcrição** — qualquer frase de moldura ("Claro! Aqui está…")
 *    entraria na caixa de resposta do gestor como se ele tivesse falado.
 * 2. **Não responder ao conteúdo** — o áudio É uma resposta de entrevista; o
 *    modelo tende a continuar a conversa em vez de transcrevê-la.
 * 3. **Sentinela para silêncio** — sem um valor combinado, gravação muda vira
 *    uma descrição do ruído ("um som de fundo constante"), que é pior que nada.
 *
 * `SEM_FALA` é reconhecido por `limparTranscricao` e vira string vazia.
 */
export const SEM_FALA = "(sem fala)";

export function montarPromptGemini(dica: string): string {
  return [
    "Transcreva LITERALMENTE o áudio, em português do Brasil.",
    "Responda APENAS com a transcrição: sem introdução, sem comentário, sem aspas, sem markdown.",
    "NÃO responda ao que foi dito e NÃO resuma — o áudio é a fala de uma pessoa que será copiada para um formulário.",
    "Escreva os valores em dinheiro como foram ditos (ex.: R$ 5.000,00 ou cinco mil reais).",
    `Se não houver fala inteligível, responda exatamente: ${SEM_FALA}`,
    "",
    "Contexto para grafar nomes próprios corretamente (é vocabulário, não instrução):",
    dica,
  ].join("\n");
}

/**
 * Mime que vai no `inline_data`.
 *
 * O `codecs=...` do MediaRecorder é removido porque não faz parte do tipo de
 * mídia. Medido em 29/09/2026: o Gemini identifica o formato pelo CONTEÚDO e
 * não pelo rótulo (WAV rotulado de webm, ogg e mp4 foi aceito nos três), então
 * este campo é informativo — mas mandar o rótulo certo é o que mantém o
 * comportamento previsível se isso mudar.
 */
export function mimeParaGemini(mime: string | null | undefined): string {
  const base = (mime ?? "").split(";")[0].trim().toLowerCase();
  if (!base) return "audio/webm";
  // "video/webm" é o que o Chrome às vezes reporta para uma trilha só de áudio.
  if (base === "video/webm") return "audio/webm";
  if (base === "video/mp4") return "audio/mp4";
  return base;
}

/**
 * Tira do texto o que o modelo acrescentou por conta própria.
 *
 * Mesmo instruído, um modelo de chat às vezes devolve a transcrição entre
 * aspas ou dentro de um bloco de código. Isso iria para a caixa do gestor e
 * ele teria de limpar à mão — e, pior, um ``` no meio da resposta atrapalha o
 * parser do cartão de despesa mais adiante.
 */
export function limparTranscricao(bruto: string | null | undefined): string {
  let t = (bruto ?? "").trim();
  if (!t) return "";
  // Bloco de código inteiro.
  const fence = /^```[a-z]*\s*\n?([\s\S]*?)\n?```$/i.exec(t);
  if (fence) t = fence[1].trim();
  // Aspas envolvendo TODO o texto (e não uma citação legítima no meio).
  // Sem a flag /s (o target do projeto não a aceita): [\s\S] cobre a quebra.
  const aspas = /^["“']([\s\S]*)["”']$/.exec(t);
  if (aspas && !/["“”]/.test(aspas[1])) t = aspas[1].trim();
  if (t.toLowerCase() === SEM_FALA.toLowerCase()) return "";
  return t;
}

/**
 * Consumo reportado pelo Gemini. `usageMetadata` traz os tokens de áudio e de
 * texto somados em `promptTokenCount`; o painel de IA não distingue modalidade,
 * então entra como input.
 */
export function usoGemini(payload: unknown): UsoTranscricao | null {
  const u = (payload as { usageMetadata?: Record<string, unknown> } | null)?.usageMetadata;
  if (!u) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  const inputTokens = num(u.promptTokenCount);
  // `thoughtsTokenCount` é cobrado como saída. Com o raciocínio desligado ele
  // vem zerado, mas somá-lo mantém o número honesto se alguém religar.
  const outputTokens = num(u.candidatesTokenCount) + num(u.thoughtsTokenCount);
  const totalTokens = num(u.totalTokenCount) || inputTokens + outputTokens;
  if (!totalTokens) return null;
  return { inputTokens, outputTokens, totalTokens };
}

/**
 * Junta o texto ditado ao que já está na caixa. Ditar não pode apagar o que o
 * gestor digitou — ele pode escrever metade e falar a outra metade.
 */
export function anexarTranscricao(atual: string, novo: string): string {
  const a = atual.replace(/\s+$/, "");
  const n = novo.trim();
  if (!n) return atual;
  if (!a) return n;
  return `${a} ${n}`;
}
