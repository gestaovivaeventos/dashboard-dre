// Ditado por voz — as regras PURAS da transcrição de áudio (testadas).
//
// O navegador grava, a rota transcreve e devolve só o texto. O texto cai na
// caixa de resposta SEM ser enviado: o gestor confere antes de mandar, porque
// "cinco mil" ouvido como "cinquenta mil" iria direto para o cartão de
// despesa. O áudio nunca é gravado em lugar nenhum.
//
// ── QUEM TRANSCREVE (30/09/2026) ────────────────────────────────────────────
// A OPENAI, e só ela. O caminho pelo Gemini existiu entre 29 e 30/09 e foi
// removido a pedido, junto com a troca da chave da OpenAI para todo o sistema.
//
// Consequência assumida: sem crédito na OpenAI, o ditado para — foi o que
// aconteceu em 30/09 (HTTP 429, `credit_balance_exhausted`), quando a OpenAI
// ainda era o plano B e o Gemini não estava publicado.
//
// Se o Gemini voltar, o achado que não pode se perder: pela API nativa
// (`generateContent` com o áudio em `inline_data`) ele transcreve bem, mas com
// o raciocínio LIGADO inventou fala onde não havia — leu um tom puro de 2
// segundos como "Eu não quero". `thinkingConfig: { thinkingBudget: 0 }`
// resolvia e ainda cortava a chamada de 478 para 88 tokens.

/** Sucessor do Whisper no mesmo endpoint (/v1/audio/transcriptions). */
export const TRANSCRICAO_MODELO = "gpt-4o-mini-transcribe";


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
