"use server";

import { generateObject } from "ai";
import { z } from "zod";

import {
  resolveAiProvider,
  logResolvedUsage,
  logAiUsage,
  generateJsonViaChat,
  generateJsonFromDocumentNative,
  usesNativeDocumentApi,
} from "@/lib/ai/provider";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { isValidBoletoLinhaDigitavel, barcodeToLinhaDigitavel } from "@/lib/ctrl/boleto";
import { findLinhaDigitavelInStrings } from "@/lib/ctrl/boleto-pdf";
import { extractPdfText, type PdfText } from "@/lib/pdf/text";

const ATTACHMENT_BUCKET = "ctrl-attachments";

// ============================================================================
// COMO O MÓDULO COMPRAS LÊ NOTA FISCAL E BOLETO — dois caminhos, nesta ordem.
//
// 1. TEXTO (padrão, provedor ativo do painel = DeepSeek). Boleto de banco e nota
//    de prefeitura/ERP são PDF vetorial: os dados estão na camada de texto do
//    arquivo. Dali sai a linha digitável SEM IA NENHUMA (varredura com os DVs
//    mod10/mod11 conferindo cada dígito — ver boleto-pdf.ts) e o número da nota
//    pelo modelo de TEXTO. É de graça, responde em ~1s e não depende da OpenAI.
//
// 2. VISÃO (plano B). Só para o que NÃO tem camada de texto: documento
//    escaneado e foto. Usa o provedor DEDICADO de OCR do painel
//    (`resolveAiProvider({ role: "ocr" })` → Plataforma > IA > "Provedor de
//    OCR"); sem OCR configurado cai na OpenAI/gpt-4o, que era o comportamento
//    anterior. O DeepSeek nunca atende aqui: a API dele aceita exclusivamente
//    texto (recusa o content part com "unknown variant `image_url`, expected
//    `text`").
//
//    Cada provedor de OCR entra pela porta que ele realmente tem — ver
//    `lerPorVisao` mais abaixo. Só a OpenAI fala a Responses API; o Gemini
//    precisa da API nativa dele. Tratar todos como "OpenAI com outra baseURL"
//    é o que deixou o Gemini 100% quebrado por dois dias.
//
// A ordem já foi a inversa, com a visão na frente, e isso deixou o módulo
// inteiro refém de UMA conta externa: em três episódios seguidos (chave ausente,
// chave inválida e conta sem crédito) nenhum documento foi lido, nem os PDFs
// que o próprio arquivo entregava de graça. Hoje, com a visão fora do ar, só
// escaneado/foto ficam no manual.
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

const BOLETO_SCHEMA_HINT = JSON.stringify({
  type: "object",
  properties: {
    linha_digitavel: { type: ["string", "null"] },
    codigo_barras: { type: ["string", "null"] },
    favorecido: { type: ["string", "null"] },
    cnpj_cpf: { type: ["string", "null"] },
  },
  required: ["linha_digitavel", "codigo_barras", "favorecido", "cnpj_cpf"],
});

// Enunciados da visão. Ficam aqui, fora da chamada, porque as duas rotas de
// visão (a nativa do Gemini e a do AI SDK) mandam o MESMO texto — um prompt por
// rota é como um caminho aprende uma armadilha e o outro não.
const NOTA_VISION_PROMPT =
  "Leia este documento (imagem ou PDF de uma nota fiscal) e extraia dois dados: o NÚMERO da " +
  "nota fiscal e o VALOR LÍQUIDO da nota.\n\n" +
  NOTA_RULES;

const BOLETO_VISION_PROMPT =
  "Leia este boleto bancário (imagem ou PDF) e extraia, separadamente: " +
  "(1) a LINHA DIGITÁVEL impressa no topo (47 ou 48 dígitos, em blocos); " +
  "(2) o número do CÓDIGO DE BARRAS (44 dígitos) impresso abaixo das barras, se houver; " +
  "(3) o nome do beneficiário/cedente; (4) o CNPJ/CPF dele. " +
  "Leia cada dígito com extrema atenção, um a um, sem inventar nem completar. " +
  "Confira a quantidade de dígitos antes de responder. Retorne só números nos campos numéricos.";

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

  const pdfText = mediaType === "application/pdf" ? safeExtractPdfText(bytes) : null;

  // ── Caminho 1: a camada de texto do PDF (ver o cabeçalho do arquivo) ───────

  // Boleto: a linha digitável sai do texto de forma DETERMINÍSTICA, com os DVs
  // conferindo dígito por dígito — melhor que qualquer OCR, então achando-a não
  // há motivo para gastar uma chamada de visão. Favorecido e CNPJ vêm do mesmo
  // texto, pelo provedor ativo.
  const linhaDoPdf = kind === "boleto" && pdfText ? findLinhaDigitavelInStrings(pdfText.strings) : null;
  if (linhaDoPdf) {
    return { data: { barcode: linhaDoPdf, ...(await boletoParties(pdfText)) } };
  }

  // Nota fiscal: o número e o valor líquido saem do mesmo texto, lidos pelo
  // provedor ATIVO (DeepSeek). Sem o número não adianta parar aqui — o valor
  // líquido sozinho não preenche o campo —, então segue para a visão levando o
  // que já conseguiu.
  const notaDoTexto = kind === "nota" && pdfText ? await readNotaFromText(pdfText) : null;
  if (notaDoTexto?.invoice_number) return { data: notaDoTexto };

  // ── Caminho 2: visão. Usa o provedor DEDICADO à leitura de documentos
  // (Plataforma > IA → "Provedor de OCR" — ex.: Gemini). Sem OCR configurado/sem
  // chave, o resolver cai na OpenAI (visão), como antes. Consumo no painel. ────
  const resolved = await resolveAiProvider({ role: "ocr" }).catch((e: unknown) =>
    e instanceof Error ? e : new Error(String(e)),
  );
  if (resolved instanceof Error) {
    // O que o texto já entregou (aqui, no máximo o valor líquido da nota — com
    // o número a função teria retornado acima) vale mais que a tela vazia.
    if (notaDoTexto) return { data: notaDoTexto };
    await logOcrFailure(null, `resolveAiProvider: ${resolved.message}`);
    return { error: mensagemAoUsuario(resolved.message) };
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
  // Modelo por provedor: a OpenAI usa gpt-4o (visão); qualquer outro provedor de
  // OCR (ex.: Gemini) usa o modelo configurado dele.
  const isOpenAiOcr = resolved.providerName === "openai";
  const ocrModelName = isOpenAiOcr ? OCR_MODEL : resolved.modelName;

  // Uma porta só para as duas rotas de visão. O Gemini vai pela API NATIVA (o
  // shim OpenAI dele não tem /responses e recusa PDF — ver o cabeçalho de
  // `generateJsonFromDocumentNative`); o resto segue pelo AI SDK, e aí só a
  // OpenAI fala a Responses API — nos demais é `.chat()`, senão é 404.
  const lerPorVisao = async (
    schema: z.ZodTypeAny,
    schemaHint: string,
    prompt: string,
  ): Promise<unknown> => {
    if (usesNativeDocumentApi(resolved)) {
      const { object, usage } = await generateJsonFromDocumentNative(resolved, {
        prompt,
        schemaHint,
        data: bytes,
        mediaType,
        modelName: ocrModelName,
      });
      await logResolvedUsage(resolved, "ocr", usage, { modelName: ocrModelName });
      return schema.parse(object);
    }
    const { object, usage } = await generateObject({
      model: isOpenAiOcr ? provider(ocrModelName) : provider.chat(ocrModelName),
      schema,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }, docPart] }],
    });
    await logResolvedUsage(resolved, "ocr", usage, { modelName: ocrModelName });
    return object;
  };

  try {
    if (kind === "nota") {
      const object = NotaSchema.parse(
        await lerPorVisao(NotaSchema, NOTA_SCHEMA_HINT, NOTA_VISION_PROMPT),
      );
      return {
        data: {
          invoice_number: cleanInvoice(object.invoice_number),
          // A visão só chegou aqui porque o texto não achou o NÚMERO; o valor
          // líquido ele pode ter achado, então não o descarta à toa.
          net_amount: parseBRLCurrency(object.valor_liquido) ?? notaDoTexto?.net_amount ?? null,
        },
      };
    }

    const object = BoletoSchema.parse(
      await lerPorVisao(BoletoSchema, BOLETO_SCHEMA_HINT, BOLETO_VISION_PROMPT),
    );
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
    if (notaDoTexto) return { data: notaDoTexto };
    await logOcrFailure(resolved, msg);
    return { error: mensagemAoUsuario(msg) };
  }
}

/**
 * Traduz a falha técnica para quem está lançando a requisição.
 *
 * Chegar aqui significa que o texto do arquivo não resolveu e a visão também
 * não — quase sempre porque a conta da OpenAI está sem crédito ou sem chave
 * válida. Despejar "You have no credits remaining. Add credits at
 * platform.openai.com/settings/organization/billing" para um solicitante é
 * ruído: ele não tem acesso ao billing, e a ação dele é a mesma de sempre —
 * digitar o campo. A causa técnica continua registrada no `ai_usage_log`
 * (visível em /admin/ia), que é onde o administrador precisa dela.
 */
function mensagemAoUsuario(msg: string): string {
  const contaForaDoAr = /no credits|insufficient|quota|billing|invalid[_ ]api[_ ]key|incorrect api key|401|403|429/i;
  if (contaForaDoAr.test(msg)) {
    return "documento sem camada de texto e a leitura por imagem está indisponível";
  }
  return `Não consegui interpretar o documento: ${msg}`;
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

// Favorecido/CNPJ do boleto — ver readBoletoPartiesFromText.
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
 * É o CAMINHO NORMAL do boleto em PDF (era rede de segurança quando a visão
 * vinha na frente). Best-effort: qualquer falha devolve null e a linha
 * digitável, que já vem validada pelos DVs, segue sozinha — o campo do
 * favorecido é preenchível na tela, a linha digitável não se adivinha.
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
