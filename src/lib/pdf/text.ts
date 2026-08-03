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

export interface PdfText {
  /** Cada pedaço de texto do PDF, na ordem — para varredura de dígitos. */
  strings: string[];
  /** Texto corrido, com quebras de linha aproximadas — para mandar ao modelo. */
  plain: string;
}

function inflate(raw: Buffer): string | null {
  try {
    return zlib.inflateSync(raw).toString("latin1");
  } catch {
    // Alguns produtores gravam o stream sem o cabeçalho zlib.
  }
  try {
    return zlib.inflateRawSync(raw).toString("latin1");
  } catch {
    return null;
  }
}

// Conteúdo de cada stream do PDF (descomprimido quando for Flate). Streams de
// imagem são pulados: só produziriam ruído binário.
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
    const dict = latin.slice(Math.max(0, i - 400), i);
    let p = i + 6;
    if (latin[p] === "\r") p += 1;
    if (latin[p] === "\n") p += 1;
    const end = latin.indexOf("endstream", p);
    if (end < 0) break;
    if (!/\/Subtype\s*\/Image|DCTDecode|JPXDecode|CCITTFaxDecode/.test(dict)) {
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
