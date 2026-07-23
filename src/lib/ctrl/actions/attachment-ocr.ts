"use server";

import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { isValidBoletoLinhaDigitavel, barcodeToLinhaDigitavel } from "@/lib/ctrl/boleto";

const ATTACHMENT_BUCKET = "ctrl-attachments";

// gpt-4o (visão) lê o documento direto — boletos exigem OCR preciso da linha
// digitável (47-48 dígitos), o que o pipeline LandingAI→markdown não entregava
// bem. A validação (isValidBoletoLinhaDigitavel) ainda barra leitura ruim.
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

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "Leitura automática indisponível (sem OPENAI_API_KEY)." };

  // Baixa os bytes do anexo (bucket privado) para mandar direto ao GPT visão.
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

  const provider = createOpenAI({ apiKey });

  try {
    if (kind === "nota") {
      const { object } = await generateObject({
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
                  "NÚMERO DA NOTA — REGRA 1 (prioritária): procure um campo rotulado explicitamente com o " +
                  "número da nota e copie EXATAMENTE o valor impresso ao lado do rótulo. Os rótulos possíveis " +
                  "são, nesta ordem: 'Número da NFS-e', 'Número da NF-e', 'Nº', 'NF-e nº', 'Número'. " +
                  "Em NFS-e (nota de serviço de prefeitura — cabeçalho 'DANFSe' / 'Documento Auxiliar da NFS-e') " +
                  "o valor correto é sempre o de 'Número da NFS-e' (costuma ter poucos dígitos, ex.: 388). " +
                  "NUNCA confunda com 'Número da DPS', 'Série da DPS', 'Competência', datas, valores em R$ " +
                  "nem com a chave de acesso — nenhum desses é o número da nota. " +
                  "NÚMERO DA NOTA — REGRA 2 (só se NÃO existir nenhum campo rotulado da Regra 1): se houver uma " +
                  "chave de acesso de NF-e com EXATAMENTE 44 dígitos, o número são os dígitos 26 a 34 (nNF). " +
                  "A chave de acesso de NFS-e tem cerca de 50 dígitos e NÃO deve ser fatiada — ignore-a. " +
                  "NUNCA retorne um número composto apenas de zeros; se você chegou a algo assim, você leu o " +
                  "campo errado — volte e leia o valor ao lado do rótulo 'Número da NFS-e'.\n\n" +
                  "VALOR LÍQUIDO: procure o campo rotulado 'Valor Líquido' (ou 'Valor líquido a pagar', 'Valor " +
                  "Líquido da NFS-e', 'Valor Líquido do documento') — é o valor a pagar já com as retenções " +
                  "descontadas (ISS retido, INSS, IR, PIS, COFINS, CSLL). NÃO confunda com 'Valor Serviços', " +
                  "'Valor Bruto', 'Valor Total' nem 'Base de Cálculo', que são o valor bruto. Copie o valor " +
                  "impresso mantendo a formatação brasileira (ex.: '295,47'). Se não houver campo de valor " +
                  "líquido, retorne null nesse campo — não invente nem calcule.",
              },
              docPart,
            ],
          },
        ],
      });
      return {
        data: {
          invoice_number: cleanInvoice(object.invoice_number),
          net_amount: parseBRLCurrency(object.valor_liquido),
        },
      };
    }

    const { object } = await generateObject({
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
    return {
      data: {
        barcode: pickBarcode(object.linha_digitavel, object.codigo_barras),
        favorecido: emptyToNull(object.favorecido),
        cnpj_cpf: emptyToNull(object.cnpj_cpf),
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Não consegui interpretar o documento: ${msg}` };
  }
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
