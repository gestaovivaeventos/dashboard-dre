"use server";

import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { parseDocumentWithLandingAI } from "@/lib/contracts/landingai";

const ATTACHMENT_BUCKET = "ctrl-attachments";

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
  barcode: z
    .string()
    .nullable()
    .describe("Linha digitável do boleto (47-48 dígitos, pode vir com pontos/espaços) ou o código de barras (44 dígitos). Retorne só os números. Null se não encontrar."),
  favorecido: z
    .string()
    .nullable()
    .describe("Nome do beneficiário/cedente do boleto (quem recebe). Null se não encontrar."),
  cnpj_cpf: z
    .string()
    .nullable()
    .describe("CNPJ ou CPF do beneficiário/cedente. Null se não encontrar."),
});

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

  // URL assinada para o LandingAI baixar o documento (bucket é privado).
  const admin = createAdminClientIfAvailable() ?? (await createClient());
  const { data: signed, error: signErr } = await admin.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachmentPath, 60 * 5);
  if (signErr || !signed?.signedUrl) {
    return { error: "Não foi possível acessar o anexo para leitura." };
  }

  let markdown: string;
  try {
    const parsed = await parseDocumentWithLandingAI(signed.signedUrl, { timeoutMs: 60_000 });
    markdown = parsed.markdown;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Falha ao ler o documento: ${msg}` };
  }

  const provider = createOpenAI({ apiKey });

  try {
    if (kind === "nota") {
      const { object } = await generateObject({
        model: provider("gpt-4o-mini"),
        schema: NotaSchema,
        prompt:
          "Extraia o número da nota fiscal do documento abaixo (markdown extraído de um PDF/imagem de NF-e). " +
          "Se houver a chave de acesso de 44 dígitos, o número da nota são os dígitos 26 a 34 (nNF).\n\n" +
          markdown.slice(0, 12000),
      });
      return { data: { invoice_number: cleanInvoice(object.invoice_number) } };
    }

    const { object } = await generateObject({
      model: provider("gpt-4o-mini"),
      schema: BoletoSchema,
      prompt:
        "Extraia os dados do boleto bancário do documento abaixo (markdown extraído de um PDF/imagem). " +
        "Quero a linha digitável (ou código de barras), o nome do beneficiário/cedente e o CNPJ/CPF dele.\n\n" +
        markdown.slice(0, 12000),
    });
    return {
      data: {
        barcode: cleanDigitsKeep(object.barcode),
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
