"use server";

import { generateObject } from "ai";
import { z } from "zod";

import {
  resolveAiProvider,
  logResolvedUsage,
  logAiUsage,
  generateJsonViaChat,
} from "@/lib/ai/provider";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { isValidBoletoLinhaDigitavel, barcodeToLinhaDigitavel } from "@/lib/ctrl/boleto";
import { findLinhaDigitavelInStrings } from "@/lib/ctrl/boleto-pdf";
import { extractPdfText, type PdfText } from "@/lib/pdf/text";

const ATTACHMENT_BUCKET = "ctrl-attachments";

// gpt-4o (visão) lê o documento direto — boletos exigem OCR preciso da linha
// digitável (47-48 dígitos), o que o pipeline LandingAI→markdown não entregava
// bem. A validação (isValidBoletoLinhaDigitavel) ainda barra leitura ruim.
//
// A leitura de boleto e de nota fiscal é a ÚNICA parte do sistema que continua
// no GPT: `resolveAiProvider({ capability: "vision" })` força a OpenAI mesmo
// com o DeepSeek ativo no painel, porque a API do DeepSeek não aceita imagem
// nem arquivo (o endpoint recusa o content part: "unknown variant `image_url`,
// expected `text`"). O resto do sistema segue no provedor configurado.
const OCR_MODEL = "gpt-4o";

// Resultado da leitura. Campos por tipo de documento; ambos opcionais porque a
// leitura é best-effort — o que não for lido fica para preenchimento manual.
export interface AttachmentReadResult {
  invoice_number?: string | null;
  // Valor líquido da nota (após retenções), já convertido para número. Usado só
  // para alertar divergência com o Valor da requisição — nunca preenche o campo.
  net_amount?: number | null;
  barcode?: string | null;
  favorecido?: string | null;
  cnpj_cpf?: string | null;
}

const NotaSchema = z.object({
  invoice_number: z
    .string()
    .nullable()
    .describe(
      "O número da nota fiscal. Em NFS-e (nota de serviço municipal/prefeitura) é o campo rotulado " +
      "'Número da NFS-e'. Em NF-e (produto) é 'Nº'/'NF-e nº' ou os 9 dígitos nNF da chave de acesso. " +
      "NÃO use 'Número da DPS', 'Série', 'Competência', nem a chave de acesso completa. Null se não encontrar.",
    ),
  valor_liquido: z
    .string()
    .nullable()
    .describe(
      "O VALOR LÍQUIDO da nota fiscal — o valor que efetivamente deve ser pago, já descontadas as " +
      "retenções (ISS retido, INSS, IR/IRRF, PIS, COFINS, CSLL). Rótulos possíveis, nesta ordem de " +
      "preferência: 'Valor Líquido', 'Valor Líquido da NFS-e', 'Valor líquido a pagar', 'Valor Líquido " +
      "do documento', 'Valor Líquido'. NÃO confunda com 'Valor Serviços', 'Valor Bruto', 'Valor Total', " +
      "'Base de Cálculo' nem com o valor de qualquer imposto isolado — esses são o valor bruto ou parte " +
      "dele, não o líquido. Copie EXATAMENTE o valor impresso, mantendo a formatação brasileira (ex.: " +
      "'295,47' ou '1.234,56'). Null se não houver um campo de valor líquido.",
    ),
});

// Regras de leitura da nota — as MESMAS nos dois caminhos: o de TEXTO (provedor
// ativo lendo a camada de texto do PDF) e o de VISÃO (GPT olhando a página).
// Manter uma cópia só evita que um caminho aprenda uma armadilha e o outro não.
const NOTA_RULES =
  "NÚMERO DA NOTA — REGRA 1 (prioritária): procure um campo rotulado explicitamente com o " +
  "número da nota e copie EXATAMENTE o valor impresso ao lado do rótulo. Os rótulos possíveis " +
  "são, nesta ordem: 'Número da NFS-e', 'Número da Nota', 'Número da NF-e', 'Nº', 'NF-e nº', 'Número'. " +
  "Em NFS-e (nota de serviço de prefeitura — cabeçalho 'DANFSe' / 'Documento Auxiliar da NFS-e' / " +
  "'NOTA FISCAL ELETRÔNICA DE SERVIÇOS') o valor correto é sempre o de 'Número da NFS-e'/'Número da " +
  "Nota' (costuma ter poucos dígitos, ex.: 388, e pode vir com zeros à esquerda, ex.: 00024315). " +
  "NUNCA confunda com 'Número da DPS', 'RPS Nº', 'Série', 'Competência', 'Código de Verificação', " +
  "'Identificador Nacional', 'Inscrição Municipal', CNPJ, CEP, 'Código do Serviço', NBS, NCM, datas, " +
  "valores em R$ nem com a chave de acesso — nenhum desses é o número da nota. " +
  "NÚMERO DA NOTA — REGRA 2 (só se NÃO existir nenhum campo rotulado da Regra 1): se houver uma " +
  "chave de acesso de NF-e com EXATAMENTE 44 dígitos, o número são os dígitos 26 a 34 (nNF). " +
  "A chave de acesso de NFS-e tem cerca de 50 dígitos e NÃO deve ser fatiada — ignore-a. " +
  "NUNCA retorne um número composto apenas de zeros; se você chegou a algo assim, você leu o " +
  "campo errado — volte e leia o valor ao lado do rótulo do número da nota.\n\n" +
  "VALOR LÍQUIDO: procure o campo rotulado 'Valor Líquido' (ou 'Valor líquido a pagar', 'Valor " +
  "Líquido da NFS-e', 'Valor Líquido do documento') — é o valor a pagar já com as retenções " +
  "descontadas (ISS retido, INSS, IR, PIS, COFINS, CSLL). NÃO confunda com 'Valor Serviços', " +
  "'Valor Bruto', 'Valor Total', 'Valor Total Cobrado' nem 'Base de Cálculo', que são o valor bruto. " +
  "Copie o valor impresso mantendo a formatação brasileira (ex.: '295,47'). Se não houver campo de " +
  "valor líquido, retorne null nesse campo — não invente nem calcule.";

const BoletoSchema = z.object({
  linha_digitavel: z
    .string()
    .nullable()
    .describe("A LINHA DIGITÁVEL impressa no topo do boleto (47 ou 48 dígitos, geralmente em 5 blocos separados por espaços/pontos). Retorne só os números, sem pontos nem espaços. Null se não encontrar."),
  codigo_barras: z
    .string()
    .nullable()
    .describe("O número do CÓDIGO DE BARRAS (44 dígitos), quando impresso abaixo das barras. Retorne só os números. Null se não encontrar."),
  favorecido: z
    .string()
    .nullable()
    .describe("Nome do beneficiário/cedente do boleto (quem recebe). Null se não encontrar."),
  cnpj_cpf: z
    .string()
    .nullable()
    .describe("CNPJ ou CPF do beneficiário/cedente. Null se não encontrar."),
});

// Escolhe a melhor leitura: linha digitável e código de barras codificam o mesmo
// dado, então tenta ambos e a reconstrução, retornando o primeiro que valida.
// Se nenhum valida, devolve a melhor leitura crua (cliente mostra como inválido).
function pickBarcode(
  linhaDigitavel: string | null | undefined,
  codigoBarras: string | null | undefined,
): string | null {
  const linha = (linhaDigitavel ?? "").replace(/\D/g, "");
  const barras = (codigoBarras ?? "").replace(/\D/g, "");

  const candidatos: string[] = [];
  if (linha) candidatos.push(linha);
  const reconstruida = barcodeToLinhaDigitavel(barras);
  if (reconstruida) candidatos.push(reconstruida);

  for (const c of candidatos) {
    if (isValidBoletoLinhaDigitavel(c)) return c;
  }
  // Nenhum validou: prioriza a linha digitável crua, senão o código de barras.
  return cleanDigitsKeep(linha) ?? cleanDigitsKeep(barras);
}

// Imagens vão como `image` part; PDF como `file` part. Outros formatos (docx
// etc.) não são lidos por visão — retorna null e o cliente cai no manual.
function detectMediaType(path: string, blobType: string | undefined): string | null {
  const t = (blobType ?? "").toLowerCase();
  if (t.startsWith("image/") || t === "application/pdf") return t;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
    return `image/${ext === "jpg" ? "jpeg" : ext}`;
  }
  return null;
}

// Lê um anexo já enviado ao bucket e extrai campos conforme o tipo:
//   - "nota"   → número da nota fiscal
//   - "boleto" → linha digitável + favorecido + CNPJ/CPF do beneficiário
// Best-effort: qualquer falha retorna { error } e o cliente cai no manual.
export async function extractAttachmentData(
  attachmentPath: string,
  kind: "nota" | "boleto",
): Promise<{ data: AttachmentReadResult } | { error: string }> {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");

  if (!attachmentPath) return { error: "Anexo não informado." };

  // Baixa os bytes do anexo (bucket privado) para ler localmente e, se preciso,
  // mandar ao GPT visão.
  const admin = createAdminClientIfAvailable() ?? (await createClient());
  const { data: blob, error: dlErr } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .download(attachmentPath);
  if (dlErr || !blob) {
    return { error: "Não foi possível acessar o anexo para leitura." };
  }

  const mediaType = detectMediaType(attachmentPath, blob.type);
  if (!mediaType) {
    return { error: "Formato não suportado para leitura automática (use PDF ou imagem)." };
  }

  const bytes = Buffer.from(await blob.arrayBuffer());

  // Boleto em PDF: a linha digitável está no TEXTO do arquivo (PDF de banco é
  // vetorial). Ler dali é determinístico — os DVs conferem cada dígito — então
  // esse valor tem precedência sobre o que o OCR enxergar, e ainda serve de rede
  // quando o GPT está fora do ar.
  const pdfText = mediaType === "application/pdf" ? safeExtractPdfText(bytes) : null;
  const linhaDoPdf = kind === "boleto" && pdfText ? findLinhaDigitavelInStrings(pdfText.strings) : null;

  // Nota fiscal em PDF: nota de prefeitura/ERP é vetorial, então o número e os
  // valores estão na camada de TEXTO. Ler dali com o provedor ATIVO (DeepSeek)
  // é mais barato, mais rápido e — o que motivou inverter a ordem — não depende
  // da OpenAI, único provedor com visão: com a conta sem crédito ("You have no
  // credits remaining") TODA leitura de nota falhava, depois de 3 tentativas, e
  // o usuário digitava o número na mão. Visão fica para nota escaneada/foto.
  const notaDoTexto = kind === "nota" && pdfText ? await readNotaFromText(pdfText) : null;
  if (notaDoTexto?.invoice_number) return { data: notaDoTexto };

  // OCR usa visão — sempre OpenAI (o resolver força isso mesmo se o provedor
  // ativo for outro). O consumo é registrado para aparecer no painel de IA.
  const resolved = await resolveAiProvider({ capability: "vision" }).catch((e: unknown) =>
    e instanceof Error ? e : new Error(String(e)),
  );
  if (resolved instanceof Error) {
    // Sem GPT o boleto ainda sai: linha digitável do texto do PDF e, para
    // favorecido/CNPJ, o provedor ativo lendo esse mesmo texto (sem visão).
    if (linhaDoPdf) return { data: { barcode: linhaDoPdf, ...(await boletoParties(pdfText)) } };
    // Idem para a nota: o que o texto entregou (só o valor líquido, aqui — com
    // o número a função já teria retornado) vale mais que a tela vazia.
    if (notaDoTexto) return { data: notaDoTexto };
    await logOcrFailure(null, `resolveAiProvider: ${resolved.message}`);
    return { error: `Leitura automática indisponível — ${resolved.message}` };
  }
  // Imagens vão com detalhe ALTO — a linha digitável tem dígitos pequenos e o
  // detalhe padrão downscaleia a imagem, derrubando a precisão do OCR.
  const docPart =
    mediaType === "application/pdf"
      ? { type: "file" as const, data: bytes, mediaType }
      : {
          type: "file" as const,
          data: bytes,
          mediaType,
          providerOptions: { openai: { imageDetail: "high" as const } },
        };

  const provider = resolved.provider;

  try {
    if (kind === "nota") {
      const { object, usage } = await generateObject({
        model: provider(OCR_MODEL),
        schema: NotaSchema,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text:
                  "Leia este documento (imagem ou PDF de uma nota fiscal) e extraia dois dados: o NÚMERO da " +
                  "nota fiscal e o VALOR LÍQUIDO da nota.\n\n" +
                  NOTA_RULES,
              },
              docPart,
            ],
          },
        ],
      });
      await logResolvedUsage(resolved, "ocr", usage, { modelName: OCR_MODEL });
      return {
        data: {
          invoice_number: cleanInvoice(object.invoice_number),
          // A visão só chegou aqui porque o texto não achou o NÚMERO; o valor
          // líquido ele pode ter achado, então não o descarta à toa.
          net_amount: parseBRLCurrency(object.valor_liquido) ?? notaDoTexto?.net_amount ?? null,
        },
      };
    }

    const { object, usage } = await generateObject({
      model: provider(OCR_MODEL),
      schema: BoletoSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Leia este boleto bancário (imagem ou PDF) e extraia, separadamente: " +
                "(1) a LINHA DIGITÁVEL impressa no topo (47 ou 48 dígitos, em blocos); " +
                "(2) o número do CÓDIGO DE BARRAS (44 dígitos) impresso abaixo das barras, se houver; " +
                "(3) o nome do beneficiário/cedente; (4) o CNPJ/CPF dele. " +
                "Leia cada dígito com extrema atenção, um a um, sem inventar nem completar. " +
                "Confira a quantidade de dígitos antes de responder. Retorne só números nos campos numéricos.",
            },
            docPart,
          ],
        },
      ],
    });
    await logResolvedUsage(resolved, "ocr", usage, { modelName: OCR_MODEL });
    return {
      data: {
        // A linha lida do texto do PDF vem na frente: os DVs já conferiram cada
        // dígito, enquanto o OCR pode trocar um.
        barcode: linhaDoPdf ?? pickBarcode(object.linha_digitavel, object.codigo_barras),
        favorecido: emptyToNull(object.favorecido),
        cnpj_cpf: emptyToNull(object.cnpj_cpf),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Falha do GPT não derruba o que o texto do PDF já entregou.
    if (linhaDoPdf) return { data: { barcode: linhaDoPdf, ...(await boletoParties(pdfText)) } };
    if (notaDoTexto) return { data: notaDoTexto };
    await logOcrFailure(resolved, msg);
    return { error: `Não consegui interpretar o documento: ${msg}` };
  }
}

// Leitura local nunca pode derrubar o fluxo: PDF corrompido/exótico só cai no OCR.
function safeExtractPdfText(bytes: Buffer): PdfText | null {
  try {
    const t = extractPdfText(bytes);
    return t.strings.length > 0 ? t : null;
  } catch (e) {
    console.warn("[ocr] leitura do texto do PDF falhou:", e instanceof Error ? e.message : e);
    return null;
  }
}

const NOTA_SCHEMA_HINT = JSON.stringify({
  type: "object",
  properties: {
    invoice_number: { type: ["string", "null"] },
    valor_liquido: { type: ["string", "null"] },
  },
  required: ["invoice_number", "valor_liquido"],
});

/**
 * Número + valor líquido a partir do TEXTO do PDF da nota, usando o provedor
 * ATIVO do painel (DeepSeek hoje) — não precisa de visão, o texto já veio do
 * arquivo.
 *
 * É o caminho NORMAL para nota em PDF, não a exceção: nota de prefeitura/ERP é
 * vetorial, então esse texto existe quase sempre, sai de graça e não depende da
 * OpenAI — que é o único provedor com visão e vinha derrubando toda leitura
 * (chave ausente antes, conta sem crédito agora). Visão continua atendendo o
 * que não tem camada de texto: nota escaneada ou foto.
 *
 * Best-effort: qualquer falha devolve null e o fluxo segue para a visão.
 */
async function readNotaFromText(pdfText: PdfText): Promise<AttachmentReadResult | null> {
  const text = pdfText.plain;
  if (text.length < 40) return null;

  const resolved = await resolveAiProvider().catch(() => null);
  if (!resolved) return null;

  try {
    const { object, usage } = await generateJsonViaChat(resolved, {
      system:
        "Você extrai dados de notas fiscais brasileiras (NF-e e NFS-e) a partir do texto bruto do " +
        "PDF. Responda apenas com JSON.",
      prompt:
        "Abaixo está o texto extraído de uma nota fiscal. O LAYOUT SE PERDEU: é comum um bloco de " +
        "rótulos aparecer junto e os valores logo em seguida, na mesma ordem — case cada rótulo com " +
        "o valor correspondente pela ordem em que aparecem, não pela proximidade no texto.\n\n" +
        NOTA_RULES +
        `\n\nTEXTO DA NOTA:\n${text}`,
      schemaHint: NOTA_SCHEMA_HINT,
      maxTokens: 400,
      temperature: 0,
    });
    await logResolvedUsage(resolved, "ocr", usage);

    const parsed = NotaSchema.safeParse(object);
    if (!parsed.success) return null;
    const invoice = invoicePresentInPdf(cleanInvoice(parsed.data.invoice_number), pdfText);
    const net = parseBRLCurrency(parsed.data.valor_liquido);
    // Nada aproveitável: devolve null para o chamador tentar a visão.
    if (!invoice && net === null) return null;
    return { invoice_number: invoice, net_amount: net };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ocr] leitura da nota pelo texto falhou:", msg);
    await logOcrFailure(resolved, `texto da nota: ${msg}`);
    return null;
  }
}

/**
 * Rede contra alucinação: o número devolvido pelo modelo precisa EXISTIR no
 * texto do PDF. A conferência é feita na corrida de dígitos colada (o kerning
 * quebra o número em vários pedaços, então espaço não serve de separador
 * confiável). Só rejeita — nunca aprova algo que não estava no documento.
 */
function invoicePresentInPdf(invoice: string | null, pdfText: PdfText): string | null {
  if (!invoice) return null;
  const digits = invoice.replace(/\D/g, "");
  // Número sem dígito nenhum (raríssimo) não tem como ser conferido assim.
  if (!digits) return invoice;
  const haystack = pdfText.strings.join("").replace(/\D/g, "");
  return haystack.includes(digits) ? invoice : null;
}

// Favorecido/CNPJ quando o GPT não está disponível — ver readBoletoPartiesFromText.
async function boletoParties(
  pdfText: PdfText | null,
): Promise<{ favorecido: string | null; cnpj_cpf: string | null }> {
  const partes = pdfText ? await readBoletoPartiesFromText(pdfText.plain) : null;
  return { favorecido: partes?.favorecido ?? null, cnpj_cpf: partes?.cnpj_cpf ?? null };
}

const PartesBoletoSchema = z.object({
  favorecido: z.string().nullable(),
  cnpj_cpf: z.string().nullable(),
});

const PARTES_SCHEMA_HINT = JSON.stringify({
  type: "object",
  properties: {
    favorecido: { type: ["string", "null"] },
    cnpj_cpf: { type: ["string", "null"] },
  },
  required: ["favorecido", "cnpj_cpf"],
});

/**
 * Favorecido + CNPJ/CPF a partir do TEXTO do boleto, usando o provedor ATIVO do
 * painel (DeepSeek hoje) — não precisa de visão, o texto já veio do PDF.
 *
 * REDE DE SEGURANÇA, não o caminho normal: a leitura de boleto roda no GPT
 * (visão), e isto só entra em cena se o GPT estiver indisponível — chave
 * ausente/expirada, cota estourada, API fora. Melhor devolver o boleto com
 * favorecido preenchido do que uma tela vazia. Best-effort: qualquer falha
 * devolve null e a linha digitável (validada pelos DVs) segue sozinha.
 */
async function readBoletoPartiesFromText(
  text: string,
): Promise<{ favorecido: string | null; cnpj_cpf: string | null } | null> {
  if (text.length < 20) return null;

  const resolved = await resolveAiProvider().catch(() => null);
  if (!resolved) return null;

  try {
    const { object, usage } = await generateJsonViaChat(resolved, {
      system:
        "Você extrai dados de boletos bancários brasileiros a partir do texto bruto do PDF. " +
        "Responda apenas com JSON.",
      prompt:
        "Abaixo está o texto extraído de um boleto (o layout se perdeu, os rótulos permaneceram). " +
        "Identifique o BENEFICIÁRIO — quem RECEBE o pagamento, também chamado de cedente. " +
        "NÃO confunda com o PAGADOR (também chamado de sacado), que é quem paga, nem com o " +
        "SACADOR/AVALISTA. Devolva:\n" +
        "- favorecido: a razão social do beneficiário, sem o CNPJ colado no nome.\n" +
        "- cnpj_cpf: o CNPJ ou CPF DO BENEFICIÁRIO, só os números, sem pontos, barra ou hífen.\n" +
        "Use null no campo que não conseguir identificar com segurança — não invente.\n\n" +
        `TEXTO DO BOLETO:\n${text}`,
      schemaHint: PARTES_SCHEMA_HINT,
      maxTokens: 400,
      temperature: 0,
    });
    await logResolvedUsage(resolved, "ocr", usage);

    const parsed = PartesBoletoSchema.safeParse(object);
    if (!parsed.success) return null;
    const doc = (parsed.data.cnpj_cpf ?? "").replace(/\D/g, "");
    return {
      favorecido: emptyToNull(parsed.data.favorecido),
      // CNPJ tem 14 dígitos, CPF 11 — fora disso é leitura errada.
      cnpj_cpf: doc.length === 14 || doc.length === 11 ? doc : null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[ocr] leitura de favorecido/CNPJ pelo texto falhou:", msg);
    await logOcrFailure(resolved, `texto do boleto: ${msg}`);
    return null;
  }
}

// Registra a falha no painel de IA — sem isso, um OCR que nunca funciona (chave
// ausente, modelo recusando o arquivo) fica invisível: o usuário só vê "não
// consegui ler" e o log de consumo, que só grava sucesso, fica vazio.
async function logOcrFailure(
  resolved: Awaited<ReturnType<typeof resolveAiProvider>> | null,
  message: string,
): Promise<void> {
  await logAiUsage({
    module: "ocr",
    providerName: resolved?.providerName ?? "openai",
    modelName: resolved?.providerName === "openai" ? OCR_MODEL : resolved?.modelName ?? OCR_MODEL,
    usage: null,
    modelPrices: resolved?.modelPrices ?? {},
    usdBrlRate: resolved?.usdBrlRate ?? 0,
    success: false,
    errorMessage: message.slice(0, 500),
  });
}

function emptyToNull(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t ? t : null;
}

// Converte um valor monetário brasileiro impresso na nota ("R$ 1.234,56",
// "295,47") para número (1234.56 / 295.47). Regras: ignora "R$" e espaços,
// vírgula = separador decimal, ponto = separador de milhar. Best-effort — se não
// der para interpretar com segurança, retorna null (o cliente só não alerta).
function parseBRLCurrency(s: string | null | undefined): number | null {
  const raw = (s ?? "").trim();
  if (!raw || raw.toLowerCase() === "null") return null;
  // Mantém só dígitos, ponto e vírgula.
  let t = raw.replace(/[^\d.,]/g, "");
  if (!t) return null;
  if (t.includes(",")) {
    // Vírgula é o decimal: pontos são milhar.
    t = t.replace(/\./g, "").replace(",", ".");
  } else if (!/^\d+\.\d{2}$/.test(t)) {
    // Sem vírgula e não é "295.47" (ponto decimal): pontos são milhar.
    t = t.replace(/\./g, "");
  }
  const n = parseFloat(t);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function cleanInvoice(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  if (!t || t.toLowerCase() === "null") return null;
  // Número composto só de zeros = leitura equivocada (ex.: fatia da chave de
  // acesso de uma NFS-e que caiu numa sequência de zeros). Descarta.
  if (/^0+$/.test(t.replace(/\D/g, "")) && !/[1-9]/.test(t)) return null;
  return t;
}

// Boleto: mantém só dígitos (linha digitável/código de barras).
function cleanDigitsKeep(s: string | null | undefined): string | null {
  const digits = (s ?? "").replace(/\D/g, "");
  return digits.length >= 40 ? digits : emptyToNull(s);
}
