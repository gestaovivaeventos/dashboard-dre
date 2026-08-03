import { extractPdfText } from "@/lib/pdf/text";
import { isValidBoletoLinhaDigitavel, barcodeToLinhaDigitavel } from "./boleto";

// ============================================================================
// Linha digitável a partir da camada de TEXTO do PDF — sem IA nenhuma.
//
// Boleto emitido por banco/ERP é PDF vetorial: a linha digitável está lá como
// texto. Extrair os dígitos e conferir os DVs é determinístico, instantâneo, de
// graça e não depende de provedor de IA — por isso roda antes de qualquer
// leitura por modelo, que fica só para boleto escaneado ou foto.
//
// O DV (mod10 dos 3 campos + mod11 geral) é o filtro: uma sequência qualquer de
// 47 dígitos passar nos quatro verificadores tem chance ~1/11.000.
// ============================================================================

interface Candidate {
  linha: string;
  /** Quanto o recorte "encaixa" na sequência de dígitos — ver rankOf. */
  rank: number;
}

// A linha digitável quase nunca está isolada: no boleto do Itaú, por exemplo, o
// código do banco impresso ao lado ("341-7") cola na frente e vira uma corrida
// de 51 dígitos. Então varremos janelas, mas preferimos a que encaixa nas
// bordas da corrida — é a leitura certa quando mais de uma janela valida.
function rankOf(offset: number, len: number, runLength: number): number {
  if (offset === 0 && len === runLength) return 3;
  if (offset === 0 || offset + len === runLength) return 2;
  return 1;
}

// Filtro extra da VARREDURA (não da validação): deslizando janela por um PDF
// inteiro, os DVs sozinhos deixam passar um acaso a cada ~11.000 janelas. O
// código de moeda — posição 4 da linha bancária — é 9 (Real) em todo boleto
// brasileiro, e arrecadação sempre começa com 8. Cobrar isso aqui derruba o
// resto dos acasos sem endurecer o que o usuário pode digitar à mão.
function plausivelNaVarredura(linha: string): boolean {
  return linha.length === 48 ? linha[0] === "8" : linha[3] === "9";
}

function collectFromDigits(digits: string, into: Candidate[]): void {
  if (digits.length < 44) return;

  for (const len of [47, 48]) {
    for (let o = 0; o + len <= digits.length; o += 1) {
      const w = digits.slice(o, o + len);
      if (plausivelNaVarredura(w) && isValidBoletoLinhaDigitavel(w)) {
        into.push({ linha: w, rank: rankOf(o, len, digits.length) });
      }
    }
  }

  // Código de barras (44 dígitos) só é aceito quando a corrida É exatamente ele:
  // a conversão recalcula os DVs mod10, sobrando só o mod11 para validar, o que
  // é fraco demais para sair deslizando janela por uma corrida longa.
  if (digits.length === 44) {
    const conv = barcodeToLinhaDigitavel(digits);
    if (conv && isValidBoletoLinhaDigitavel(conv)) into.push({ linha: conv, rank: 3 });
  }
}

function collectFromText(text: string, into: Candidate[]): void {
  // Sequências de dígitos tolerando os separadores impressos: espaço, ponto e
  // hífen — "34191.09008 06177.528723 …" vira um único candidato.
  const runs = text.match(/\d[\d\s.\-]*\d/g) ?? [];
  for (const run of runs) collectFromDigits(run.replace(/\D/g, ""), into);
}

/**
 * Procura a linha digitável (47/48 dígitos, DVs conferidos) nos pedaços de texto
 * de um PDF de boleto. Retorna null quando o PDF não tem camada de texto
 * (escaneado) ou quando nenhuma sequência passa nos dígitos verificadores.
 */
export function findLinhaDigitavelInStrings(strings: string[]): string | null {
  if (strings.length === 0) return null;

  const candidates: Candidate[] = [];
  // Duas leituras do mesmo texto: separando os pedaços (número inteiro em uma
  // string) e colando-os (número quebrado em vários pedaços pelo kerning).
  collectFromText(strings.join(" "), candidates);
  if (candidates.length === 0) collectFromText(strings.join(""), candidates);
  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (const c of candidates) {
    if (c.rank > best.rank) best = c;
  }
  return best.linha;
}

export function findLinhaDigitavelInPdf(bytes: Buffer): string | null {
  return findLinhaDigitavelInStrings(extractPdfText(bytes).strings);
}
