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
// O que o content stream guarda são CÓDIGOS na codificação da fonte, não texto
// pronto — a tradução para caractere vem do /ToUnicode de cada fonte (ver o
// bloco "Camada de fonte" abaixo). Fonte sem /ToUnicode fica como está: pode
// embaralhar acentos (ç, ã), mas os dígitos saem intactos.
// ============================================================================

// Tetos de segurança: PDF gigante não pode travar a requisição.
const MAX_SCAN_CHARS = 4_000_000;
const MAX_PLAIN_TEXT = 20_000;
// Teto do rebobinamento em streamDict — dicionário de stream não passa disso.
const MAX_DICT_CHARS = 4_000;
// Tetos da camada de fonte: PDF malformado não pode virar laço longo.
const MAX_FONTS = 256;
const MAX_CMAP_ENTRIES = 65_536;
const MAX_BFRANGE_SPAN = 4_096;

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

// ============================================================================
// Camada de fonte: /ToUnicode
//
// O content stream NÃO guarda letras, guarda códigos na codificação da fonte.
// Com fonte comum (WinAnsi) código e caractere coincidem e ignorar isso passa
// despercebido — mas o boleto do Omie Cash/FitBank, como todo PDF gerado por
// Qt/QPrinter, usa fonte SUBSET com /Encoding /Identity-H: o código é o ÍNDICE
// DO GLIFO dentro do subset, numerado a partir de 1 na ordem em que a letra
// apareceu. A linha digitável "45090.02004…" chegava aqui como "%,#!*+…", a
// varredura de dígitos não tinha o que casar, e o boleto — que trazia tudo em
// texto — era dado como escaneado e mandado para o OCR de visão.
//
// A tradução está no próprio arquivo: cada fonte aponta um /ToUnicode, um CMap
// mapeando código → caractere. Aplicá-lo é o que transforma glifo em texto.
//
// A regra é NÃO PIORAR: fonte sem /ToUnicode, CMap ilegível ou string que o
// CMap não resolve caem no comportamento anterior. Nada do que já era lido
// deixa de ser.
// ============================================================================

interface FontCMap {
  /** Bytes por código, lidos do codespacerange do CMap (Identity-H = 2). */
  codeBytes: number;
  map: Map<number, string>;
}

function hexDigits(token: string): string {
  return token.replace(/[<>\s]/g, "");
}

function hexToInt(token: string): number | null {
  const h = hexDigits(token);
  if (!h || h.length > 8 || !/^[0-9a-fA-F]+$/.test(h)) return null;
  return parseInt(h, 16);
}

// Destino de um mapeamento: string UTF-16BE, um ou mais code units — "00660066"
// é a ligadura "ff". Dois dígitos (fora do padrão, mas emitido por alguns
// produtores) valem como um byte solto.
function hexToStr(token: string): string {
  const h = hexDigits(token);
  if (!h || !/^[0-9a-fA-F]+$/.test(h)) return "";
  if (h.length === 2) return String.fromCharCode(parseInt(h, 16));
  if (h.length % 4 !== 0) return "";
  let out = "";
  for (let i = 0; i < h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16));
  return out;
}

// Num bfrange "<lo> <hi> <dst>" o destino acompanha o código: só o ÚLTIMO code
// unit incrementa.
function bumpLast(s: string, delta: number): string {
  if (!s || delta === 0) return s;
  const last = s.charCodeAt(s.length - 1) + delta;
  if (last > 0xffff) return s;
  return s.slice(0, -1) + String.fromCharCode(last);
}

// "<lo> <hi> <dst>" (destino corrido) e "<lo> <hi> [ <d0> <d1> … ]" (um destino
// por código) — as duas formas que o bfrange aceita.
function parseBfRange(body: string, map: Map<number, string>): void {
  const toks = body.match(/<[0-9a-fA-F\s]*>|\[|\]/g) ?? [];
  let i = 0;
  while (i < toks.length) {
    const lo = hexToInt(toks[i]);
    const hi = hexToInt(toks[i + 1]);
    if (lo === null || hi === null || hi < lo) {
      i += 1;
      continue;
    }
    i += 2;
    if (toks[i] === "[") {
      i += 1;
      for (let code = lo; i < toks.length && toks[i] !== "]"; i += 1, code += 1) {
        const v = hexToStr(toks[i]);
        if (v && map.size < MAX_CMAP_ENTRIES) map.set(code, v);
      }
      i += 1;
      continue;
    }
    const base = hexToStr(toks[i] ?? "");
    i += 1;
    if (!base) continue;
    const span = Math.min(hi - lo, MAX_BFRANGE_SPAN);
    for (let k = 0; k <= span && map.size < MAX_CMAP_ENTRIES; k += 1) {
      map.set(lo + k, bumpLast(base, k));
    }
  }
}

function parseCMap(text: string): FontCMap | null {
  const map = new Map<number, string>();
  let codeBytes = 0;

  for (const m of Array.from(text.matchAll(/begincodespacerange([\s\S]*?)endcodespacerange/g))) {
    for (const tok of m[1].match(/<[0-9a-fA-F\s]*>/g) ?? []) {
      codeBytes = Math.max(codeBytes, Math.ceil(hexDigits(tok).length / 2));
    }
  }

  for (const m of Array.from(text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))) {
    const toks = m[1].match(/<[0-9a-fA-F\s]*>/g) ?? [];
    for (let i = 0; i + 1 < toks.length && map.size < MAX_CMAP_ENTRIES; i += 2) {
      const src = hexToInt(toks[i]);
      const dst = hexToStr(toks[i + 1]);
      if (src !== null && dst) map.set(src, dst);
    }
  }

  for (const m of Array.from(text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g))) {
    parseBfRange(m[1], map);
  }

  if (map.size === 0) return null;
  // Sem codespacerange declarado: 2 bytes quando algum código passa de 0xFF.
  if (codeBytes === 0) codeBytes = Array.from(map.keys()).some((k) => k > 0xff) ? 2 : 1;
  return { codeBytes: Math.min(4, codeBytes), map };
}

interface PdfObjects {
  /** Início do dicionário de um objeto indireto, do arquivo ou de um /ObjStm. */
  dict(num: number): string | null;
  /** Conteúdo do stream de um objeto, já descomprimido. */
  stream(num: number): string | null;
  /** Todo dicionário conhecido — para varrer atrás dos recursos de fonte. */
  dicts(): string[];
}

/**
 * Índice dos objetos indiretos do arquivo.
 *
 * O casamento exige início de linha antes do "N G obj": sem isso a mesma
 * sequência dentro do binário de um stream de imagem entraria no índice e
 * sobrescreveria o objeto real.
 */
function indexObjects(bytes: Buffer, latin: string): PdfObjects {
  const spans = new Map<number, { start: number; end: number }>();
  const re = /(?:^|[\r\n])\s*(\d{1,8})\s+(\d{1,5})\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const end = latin.indexOf("endobj", re.lastIndex);
    spans.set(Number(m[1]), { start: re.lastIndex, end: end < 0 ? latin.length : end });
  }

  const stream = (num: number): string | null => {
    const span = spans.get(num);
    if (!span) return null;
    const s = latin.indexOf("stream", span.start);
    if (s < 0 || s >= span.end) return null;
    let p = s + 6;
    if (latin[p] === "\r") p += 1;
    if (latin[p] === "\n") p += 1;
    const e = latin.indexOf("endstream", p);
    if (e < 0 || e > span.end) return null;
    const raw = bytes.subarray(p, e);
    return inflate(raw) ?? raw.toString("latin1");
  };

  // PDF 1.5+ empacota os dicionários dentro de um /ObjStm comprimido: o
  // "N 0 obj" não existe no arquivo. Sem desempacotar, o dicionário da fonte
  // fica invisível nesses arquivos e o CMap nunca é alcançado.
  const packed = new Map<number, string>();
  for (const [num, span] of Array.from(spans.entries())) {
    const head = latin.slice(span.start, span.start + MAX_DICT_CHARS);
    if (!head.includes("/ObjStm")) continue;
    const n = Number(/\/N\s+(\d+)/.exec(head)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(head)?.[1] ?? 0);
    const content = n && first ? stream(num) : null;
    if (!content) continue;
    // Cabeçalho: pares "número deslocamento", ambos relativos a /First.
    const header = content.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n && 2 * i + 1 < header.length; i += 1) {
      const objNum = header[2 * i];
      const from = first + header[2 * i + 1];
      const to = 2 * i + 3 < header.length ? first + header[2 * i + 3] : content.length;
      if (Number.isFinite(objNum) && from >= first && from < content.length) {
        packed.set(objNum, content.slice(from, Math.min(to, content.length)));
      }
    }
  }

  const dict = (num: number): string | null => {
    const span = spans.get(num);
    if (span) return latin.slice(span.start, Math.min(span.end, span.start + MAX_DICT_CHARS));
    return packed.get(num) ?? null;
  };

  const dicts = (): string[] => {
    const all: string[] = [];
    for (const [, span] of Array.from(spans.entries())) {
      all.push(latin.slice(span.start, Math.min(span.end, span.start + MAX_DICT_CHARS)));
    }
    for (const body of Array.from(packed.values())) all.push(body);
    return all;
  };

  return { dict, stream, dicts };
}

/**
 * Nome do recurso de fonte (/F14, /TT2 …) → CMap dela.
 *
 * Nome repetido apontando para fontes DIFERENTES (páginas que numeram os
 * próprios recursos) é ambíguo — sem associar content stream à página não dá
 * para desempatar, então o nome é descartado e essas strings seguem pelo
 * caminho antigo.
 */
function buildFontCMaps(bytes: Buffer, latin: string): Map<string, FontCMap> {
  const fonts = new Map<string, FontCMap>();
  if (!latin.includes("/ToUnicode")) return fonts;

  const objs = indexObjects(bytes, latin);

  const byName = new Map<string, number | null>();
  const record = (body: string) => {
    for (const p of Array.from(body.matchAll(/\/([^\s/<>[\]()]+)\s+(\d+)\s+\d+\s+R/g))) {
      const name = p[1];
      const num = Number(p[2]);
      if (byName.has(name) && byName.get(name) !== num) byName.set(name, null);
      else byName.set(name, num);
    }
  };
  for (const body of objs.dicts()) {
    for (const m of Array.from(body.matchAll(/\/Font\s*<<([^<>]*)>>/g))) record(m[1]);
    // /Font como referência indireta: o dicionário mora em outro objeto.
    for (const m of Array.from(body.matchAll(/\/Font\s+(\d+)\s+\d+\s+R/g))) {
      const d = objs.dict(Number(m[1]));
      if (d) record(d);
    }
  }

  const parsed = new Map<number, FontCMap | null>();
  for (const [name, fontObj] of Array.from(byName.entries())) {
    if (fontObj === null || fonts.size >= MAX_FONTS) continue;
    const fontDict = objs.dict(fontObj);
    const tu = fontDict ? /\/ToUnicode\s+(\d+)\s+\d+\s+R/.exec(fontDict) : null;
    if (!tu) continue;
    const num = Number(tu[1]);
    if (!parsed.has(num)) {
      const cmap = objs.stream(num);
      parsed.set(num, cmap ? parseCMap(cmap) : null);
    }
    const cmap = parsed.get(num);
    if (cmap) fonts.set(name, cmap);
  }
  return fonts;
}

/** Códigos de uma string do content stream → texto, pelo CMap da fonte ativa. */
function applyCMap(raw: string, font: FontCMap): string {
  const step = font.codeBytes;
  let out = "";
  for (let i = 0; i + step <= raw.length; i += step) {
    let code = 0;
    for (let k = 0; k < step; k += 1) code = (code << 8) | (raw.charCodeAt(i + k) & 0xff);
    out += font.map.get(code) ?? "";
  }
  return out;
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
function pdfContentChunks(bytes: Buffer, latin: string): string[] {
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
 *
 * Cada string é traduzida pelo CMap da fonte ativa no momento — o operador
 * "/F14 Tf" é quem troca a fonte, então ele precisa ser acompanhado junto com
 * os de movimento.
 */
function extractTokens(content: string, fonts: Map<string, FontCMap>): string[] {
  const out: string[] = [];
  const escapes: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" };
  // Operador só pode ser lido depois do token completo; guarda o que vier
  // sendo digitado fora de string para reconhecê-lo.
  let word = "";
  // Último nome lido (/F14): em "/F14 9 Tf" é o operando que nomeia a fonte.
  let lastName = "";
  let activeFont: FontCMap | null = null;

  const flushWord = () => {
    if (word === "Tf") activeFont = fonts.get(lastName) ?? null;
    if (word && MOVE_OPS.has(word) && out[out.length - 1] !== BREAK) out.push(BREAK);
    word = "";
  };

  // CMap primeiro; sem fonte ativa — ou quando o CMap não resolve nada da
  // string — vale o caminho antigo, que é o que já lia o resto dos PDFs.
  const emit = (raw: string) => {
    const viaCMap = activeFont ? applyCMap(raw, activeFont) : "";
    out.push(viaCMap || decodeUtf16BE(raw));
  };

  for (let i = 0; i < content.length; i += 1) {
    const c = content[i];

    // Nome (/F14, /GSa): consumido inteiro para não ser confundido com operador.
    if (c === "/") {
      flushWord();
      let k = i + 1;
      while (k < content.length && !/[\s/<>[\]()]/.test(content[k])) k += 1;
      lastName = content.slice(i + 1, k);
      i = k - 1;
      continue;
    }

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
      emit(buf);
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
      emit(buf);
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

/**
 * Converte um token gravado em UTF-16BE para texto normal.
 *
 * O PDF pode gravar a string de texto com 2 bytes por caractere, com ou sem o
 * BOM FE FF. Lido como latin1, cada caractere vira um NUL colado no caractere
 * real — "341-7" chega como "\0 3 \0 4 \0 1 \0 - \0 7" e, depois que
 * buildPlainText troca os controles por espaço, o documento inteiro parece
 * espaçado letra a letra ("O B V I O   B R A S I L").
 *
 * Não é cosmético: a varredura da linha digitável casa os dígitos com
 * `[\d\s.-]` entre eles, e NUL **não** é `\s`. O boleto do Itaú/Óbvio trazia a
 * linha inteira e íntegra no arquivo, e a varredura devolvia ZERO candidatos —
 * o boleto era dado como "sem texto" e mandado para o OCR de visão. Por isso a
 * conversão acontece aqui, na origem: varredura e modelo veem o mesmo texto.
 */
function decodeUtf16BE(s: string): string {
  if (s.length < 2) return s;
  const temBom = s.charCodeAt(0) === 0xfe && s.charCodeAt(1) === 0xff;
  const corpo = temBom ? s.slice(2) : s;
  if (corpo.length < 2 || corpo.length % 2 !== 0) return s;
  if (!temBom) {
    // Sem BOM, só tratamos como UTF-16BE quando TODO byte alto é zero: é a
    // assinatura de texto ASCII/latino gravado em 2 bytes. Byte alto não nulo
    // pode ser um caractere latin1 legítimo — nesse caso não mexemos.
    for (let i = 0; i < corpo.length; i += 2) {
      if (corpo.charCodeAt(i) !== 0) return s;
    }
  }
  let out = "";
  for (let i = 0; i + 1 < corpo.length; i += 2) {
    out += String.fromCharCode((corpo.charCodeAt(i) << 8) | corpo.charCodeAt(i + 1));
  }
  return out;
}

/** Camada de texto do PDF. `strings` vazio = PDF escaneado (só imagem). */
export function extractPdfText(bytes: Buffer): PdfText {
  const latin = bytes.toString("latin1");
  const fonts = buildFontCMaps(bytes, latin);
  const tokens: string[] = [];
  let scanned = 0;
  for (const chunk of pdfContentChunks(bytes, latin)) {
    scanned += chunk.length;
    if (scanned > MAX_SCAN_CHARS) break;
    // A tradução do código para caractere acontece dentro de extractTokens, que
    // é onde se sabe qual fonte está ativa.
    for (const token of extractTokens(chunk, fonts)) tokens.push(token);
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
