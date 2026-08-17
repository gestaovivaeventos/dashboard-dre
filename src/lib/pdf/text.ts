import zlib from "node:zlib";

// ============================================================================
// Extração da camada de TEXTO de um PDF — sem biblioteca externa.
//
// PDF emitido por banco/prefeitura/ERP é vetorial: os rótulos e valores estão
// lá como texto, não como imagem. Ter esse texto permite ler o documento com um
// modelo de TEXTO (o provedor ativo do painel, DeepSeek inclusive) em vez de
// visão — mais barato, mais rápido e sem depender de chave da OpenAI. Visão
// continua sendo o plano B para documento escaneado ou foto, que não tem
// camada de texto nenhuma.
//
// Não é um renderizador: o que sai são os pedaços de texto na ordem do content
// stream, com quebras de linha aproximadas pelos operadores de posicionamento.
// Encoding de fonte customizada pode embaralhar acentos (ç, ã) — os dígitos,
// que é o que mais importa aqui, saem intactos.
// ============================================================================

// Tetos de segurança: PDF gigante não pode travar a requisição.
const MAX_SCAN_CHARS = 4_000_000;
const MAX_PLAIN_TEXT = 20_000;
// Teto do rebobinamento em streamDict — dicionário de stream não passa disso.
const MAX_DICT_CHARS = 4_000;

// Streams que nunca contêm texto: imagem e programa de fonte embutida
// (/Length1 é o comprimento do Type1/TrueType). Pulá-los evita jogar binário
// no texto que vai ao modelo.
const NON_TEXT_STREAM =
  /\/Subtype\s*\/Image|DCTDecode|JPXDecode|CCITTFaxDecode|\/Length1\b/;

export interface PdfText {
  /** Cada pedaço de texto do PDF, na ordem — para varredura de dígitos. */
  strings: string[];
  /** Texto corrido, com quebras de linha aproximadas — para mandar ao modelo. */
  plain: string;
}

// Z_SYNC_FLUSH em vez do Z_FINISH padrão: muitos produtores fecham o deflate
// sem o bloco final, e o inflate estrito aborta com "unexpected end of file"
// DESCARTANDO tudo o que já havia descomprimido. É o caso da NFS-e da
// Prefeitura de São Paulo: o content stream inflava inteiro (5,5 KB de texto,
// "Número da Nota" incluído), mas o erro no fim jogava fora o resultado, o
// chunk caía no `raw.toString("latin1")` e a página virava ruído binário.
const TOLERANTE = { finishFlush: zlib.constants.Z_SYNC_FLUSH } as const;

/**
 * Descomprime um stream Flate. A ORDEM das tentativas importa e é o oposto do
 * intuitivo: as ESTRITAS vêm primeiro, a tolerante só como resgate.
 *
 * Motivo: `Z_SYNC_FLUSH` também deixa de reclamar de stream que não é zlib de
 * verdade — basta o primeiro par de bytes passar no teste de cabeçalho e ele
 * devolve lixo parcial em vez de lançar. Tolerando de saída, esse lixo tomava o
 * lugar do `inflateRaw` (deflate sem cabeçalho), e um boleto que era lido
 * corretamente parou de entregar a linha digitável. Estrito primeiro mantém
 * intacto tudo o que já funcionava; a tolerância só entra onde antes não
 * sobrava nada além do binário cru.
 */
function inflate(raw: Buffer): string | null {
  const tentativas = [
    () => zlib.inflateSync(raw),
    // Alguns produtores gravam o stream sem o cabeçalho zlib.
    () => zlib.inflateRawSync(raw),
    () => zlib.inflateSync(raw, TOLERANTE),
    () => zlib.inflateRawSync(raw, TOLERANTE),
  ];
  for (const tentar of tentativas) {
    try {
      const out = tentar();
      // Saída vazia não é resgate: deixa a próxima tentativa correr.
      if (out.length > 0) return out.toString("latin1");
    } catch {
      // Próxima estratégia.
    }
  }
  return null;
}

/**
 * Dicionário de um stream: o "<< … >>" imediatamente antes da palavra `stream`.
 *
 * Precisa ser o dicionário EXATO, não uma janela de N bytes para trás: os
 * objetos de imagem vêm colados no content stream da página, então uma janela
 * fixa enxergava o "/Subtype/Image" do objeto ANTERIOR e o filtro de imagem
 * descartava o texto da página inteira (o boleto do IUGU/55PBX saía com zero
 * strings, e a linha digitável só podia vir do OCR).
 *
 * Retorna "" quando não dá para delimitar com segurança — aí o stream NÃO é
 * descartado: perder texto é o defeito; ruído binário a varredura de dígitos
 * (com DV) e o modelo já toleram.
 */
function streamDict(latin: string, streamIdx: number): string {
  const close = latin.lastIndexOf(">>", streamIdx);
  // Entre o fim do dicionário e `stream` só pode haver espaço em branco.
  if (close < 0 || /\S/.test(latin.slice(close + 2, streamIdx))) return "";

  // Rebobina até o "<<" correspondente, contando aninhamento — dicionário
  // interno é comum (/DecodeParms<< … >>).
  let depth = 0;
  for (let i = close + 1; i >= 1 && close - i < MAX_DICT_CHARS; i -= 1) {
    if (latin[i] === ">" && latin[i - 1] === ">") {
      depth += 1;
      i -= 1;
    } else if (latin[i] === "<" && latin[i - 1] === "<") {
      depth -= 1;
      if (depth === 0) return latin.slice(i - 1, close + 2);
      i -= 1;
    }
  }
  return "";
}

// Conteúdo de cada stream do PDF (descomprimido quando for Flate). Streams de
// imagem e de fonte são pulados: só produziriam ruído binário.
function pdfContentChunks(bytes: Buffer): string[] {
  const latin = bytes.toString("latin1");
  const chunks: string[] = [];
  let i = 0;
  while ((i = latin.indexOf("stream", i)) >= 0) {
    // "endstream" também casa com "stream" — pula sem tratar como início.
    if (latin.slice(i - 3, i) === "end") {
      i += 6;
      continue;
    }
    const dict = streamDict(latin, i);
    let p = i + 6;
    if (latin[p] === "\r") p += 1;
    if (latin[p] === "\n") p += 1;
    const end = latin.indexOf("endstream", p);
    if (end < 0) break;
    if (!NON_TEXT_STREAM.test(dict)) {
      const raw = bytes.subarray(p, end);
      const text = inflate(raw) ?? raw.toString("latin1");
      if (text) chunks.push(text);
    }
    i = end + 9;
  }
  return chunks;
}

// Marcador interno de quebra de linha na lista de tokens.
const BREAK = "\n";

// Operadores que movem o cursor de texto para outra posição — tratados como
// quebra de linha. Td/TD/T* iniciam nova linha; Tm reposiciona; ' e " também.
const MOVE_OPS = new Set(["Td", "TD", "T*", "Tm", "'", '"']);

/**
 * Tokens de texto de um content stream: as strings literais "( … )" e
 * hexadecimais "< … >", intercaladas com BREAK onde o PDF reposicionou o
 * cursor. Escapes (\( \) \\ e octais \nnn) são resolvidos para não corromper
 * dígitos.
 */
function extractTokens(content: string): string[] {
  const out: string[] = [];
  const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
  // Operador só pode ser lido depois do token completo; guarda o que vier
  // sendo digitado fora de string para reconhecê-lo.
  let word = "";

  const flushWord = () => {
    if (word && MOVE_OPS.has(word) && out[out.length - 1] !== BREAK) out.push(BREAK);
    word = "";
  };

  for (let i = 0; i < content.length; i += 1) {
    const c = content[i];

    if (c === "(") {
      flushWord();
      let depth = 1;
      let buf = "";
      i += 1;
      for (; i < content.length && depth > 0; i += 1) {
        const ch = content[i];
        if (ch === "\\") {
          const next = content[i + 1] ?? "";
          if (next >= "0" && next <= "7") {
            let oct = "";
            let k = i + 1;
            while (k < content.length && oct.length < 3 && content[k] >= "0" && content[k] <= "7") {
              oct += content[k];
              k += 1;
            }
            buf += String.fromCharCode(parseInt(oct, 8));
            i = k - 1;
            continue;
          }
          buf += escapes[next] ?? next;
          i += 1;
          continue;
        }
        if (ch === "(") {
          depth += 1;
          buf += ch;
          continue;
        }
        if (ch === ")") {
          depth -= 1;
          if (depth > 0) buf += ch;
          continue;
        }
        buf += ch;
      }
      i -= 1;
      out.push(buf);
      continue;
    }

    if (c === "<" && content[i + 1] !== "<") {
      flushWord();
      const end = content.indexOf(">", i + 1);
      if (end < 0) continue;
      const hex = content.slice(i + 1, end).replace(/\s+/g, "");
      i = end;
      if (hex.length < 2 || !/^[0-9a-fA-F]+$/.test(hex)) continue;
      let buf = "";
      for (let k = 0; k + 1 < hex.length; k += 2) {
        buf += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
      }
      out.push(buf);
      continue;
    }

    // Fora de string: acumula o token corrente para identificar o operador.
    if (/[A-Za-z*'"]/.test(c)) {
      word += c;
    } else {
      flushWord();
    }
  }
  flushWord();

  return out;
}

/** Camada de texto do PDF. `strings` vazio = PDF escaneado (só imagem). */
export function extractPdfText(bytes: Buffer): PdfText {
  const tokens: string[] = [];
  let scanned = 0;
  for (const chunk of pdfContentChunks(bytes)) {
    scanned += chunk.length;
    if (scanned > MAX_SCAN_CHARS) break;
    tokens.push(...extractTokens(chunk));
  }

  const strings = tokens.filter((t) => t !== BREAK);
  return { strings, plain: buildPlainText(tokens) };
}

function buildPlainText(tokens: string[]): string {
  const raw = tokens.join(" ").slice(0, MAX_PLAIN_TEXT * 4);
  // Bytes de controle viram espaço via charCode: a alternativa em regex seria
  // uma classe de caracteres de controle, barrada pelo ESLint (no-control-regex).
  const printable = Array.from(raw, (c) =>
    c === "\n" ? "\n" : c.charCodeAt(0) < 32 ? " " : c,
  ).join("");
  return printable
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_PLAIN_TEXT);
}
