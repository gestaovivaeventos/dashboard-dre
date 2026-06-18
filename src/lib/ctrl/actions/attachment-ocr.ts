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
  barcode?: string | null;
  favorecido?: string | null;
  cnpj_cpf?: string | null;
}

const NotaSchema = z.object({
  invoice_number: z
    .string()
    .nullable()
    .describe("Número da nota fiscal (campo 'Nº', 'NF-e nº' ou os 9 dígitos nNF da chave de acesso). Null se não encontrar."),
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
                  "Leia este documento (imagem ou PDF de uma nota fiscal) e extraia o número da nota fiscal. " +
                  "Se houver a chave de acesso de 44 dígitos, o número da nota são os dígitos 26 a 34 (nNF).",
              },
              docPart,
            ],
          },
        ],
      });
      return { data: { invoice_number: cleanInvoice(object.invoice_number) } };
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

function cleanInvoice(s: string | null | undefined): string | null {
  const t = (s ?? "").trim();
  return t && t.toLowerCase() !== "null" ? t : null;
}

// Boleto: mantém só dígitos (linha digitável/código de barras).
function cleanDigitsKeep(s: string | null | undefined): string | null {
  const digits = (s ?? "").replace(/\D/g, "");
  return digits.length >= 40 ? digits : emptyToNull(s);
}
