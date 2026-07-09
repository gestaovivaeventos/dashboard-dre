"use server";

import { generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";

const ATTACHMENT_BUCKET = "case-attachments";
const OCR_MODEL = "gpt-4o";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

/** Data de amanhã (YYYY-MM-DD) — padrão para pagamento "na assinatura do contrato". */
function amanhaISO(): string {
  const d = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

/** Instruções comuns de parcelas + data de assinatura para os prompts de OCR. */
function regrasParcelas(): string {
  return (
    "IMPORTANTE sobre as parcelas de pagamento: a SOMA de todas as parcelas deve ser " +
    "EXATAMENTE igual ao valor total. Extraia TODAS as parcelas (entrada, ato, saldo etc.). " +
    `Quando uma parcela for paga "na assinatura do contrato", "no ato", "à vista", "na data de ` +
    `assinatura" ou similar (sem data de calendário explícita), use a data ${amanhaISO()} (o dia ` +
    "seguinte a hoje). Datas no formato YYYY-MM-DD; valores como número decimal em reais."
  );
}

const ArtistContractSchema = z.object({
  artista_nome: z.string().nullable().describe("Nome do artista/banda contratada (a atração). Null se não encontrar."),
  artista_cnpj_cpf: z.string().nullable().describe("CNPJ ou CPF do artista/banda ou de seu representante/produtora. Só números. Null se não encontrar."),
  valor_cache: z.number().nullable().describe("Valor total do cachê pago ao artista, em reais (número decimal, ex.: 15000.00). Null se não encontrar."),
  parcelas_pagamento: z
    .array(
      z.object({
        data: z.string().nullable().describe("Data de vencimento/pagamento no formato YYYY-MM-DD."),
        valor: z.number().nullable().describe("Valor da parcela em reais."),
      }),
    )
    .describe("Parcelas/datas de pagamento ao artista. Se houver pagamento único, retorne uma parcela com o valor total. Vazio se não encontrar."),
  data_show: z.string().nullable().describe("Data do show/evento no formato YYYY-MM-DD. Null se não encontrar."),
  horario: z.string().nullable().describe("Horário da apresentação (ex.: '22:00'). Null se não encontrar."),
  duracao: z.string().nullable().describe("Duração/tempo de show ou passagem de som (ex.: '90 minutos'). Null se não encontrar."),
  local: z.string().nullable().describe("Nome do local/casa do show. Null se não encontrar."),
  endereco: z.string().nullable().describe("Endereço do local do show. Null se não encontrar."),
  cidade: z.string().nullable().describe("Cidade/UF do show. Null se não encontrar."),
});

export interface ArtistOcrResult {
  bandId: string | null;
  bandName: string | null;
  bandDoc: string | null;
  bandCreated: boolean;
  valorCache: number | null;
  parcelas: Array<{ data: string | null; valor: number | null }>;
  dataShow: string | null;
  horario: string | null;
  duracao: string | null;
  local: string | null;
  endereco: string | null;
  cidade: string | null;
}

const FornecedorContractSchema = z.object({
  fornecedor_nome: z.string().nullable().describe("Nome/razão social do FORNECEDOR — quem presta o serviço e recebe o pagamento (não o contratante). Null se não encontrar."),
  fornecedor_cnpj_cpf: z.string().nullable().describe("CNPJ ou CPF do fornecedor. Só números. Null se não encontrar."),
  descricao_servico: z.string().nullable().describe("Descrição curta do serviço contratado (ex.: 'sonorização e iluminação', 'buffet do camarim'). Null se não encontrar."),
  valor_total: z.number().nullable().describe("Valor total do serviço em reais (número decimal). Null se não encontrar."),
  parcelas_pagamento: z
    .array(
      z.object({
        data: z.string().nullable().describe("Data de vencimento/pagamento no formato YYYY-MM-DD."),
        valor: z.number().nullable().describe("Valor da parcela em reais."),
      }),
    )
    .describe("Parcelas/datas de pagamento ao fornecedor. Se houver pagamento único, retorne uma parcela com o valor total. Vazio se não encontrar."),
  email: z.string().nullable().describe("E-mail de contato do fornecedor. Null se não encontrar."),
  telefone: z.string().nullable().describe("Telefone de contato do fornecedor. Null se não encontrar."),
  banco: z.string().nullable().describe("Banco do fornecedor para pagamento. Null se não encontrar."),
  agencia: z.string().nullable().describe("Agência bancária. Null se não encontrar."),
  conta_corrente: z.string().nullable().describe("Conta corrente. Null se não encontrar."),
  titular_banco: z.string().nullable().describe("Nome do titular da conta. Null se não encontrar."),
  doc_titular: z.string().nullable().describe("CPF/CNPJ do titular da conta. Null se não encontrar."),
  chave_pix: z.string().nullable().describe("Chave PIX para pagamento. Null se não encontrar."),
});

export interface FornecedorOcrResult {
  nome: string | null;
  doc: string | null;
  descricao: string | null;
  valorTotal: number | null;
  parcelas: Array<{ data: string | null; valor: number | null }>;
  email: string | null;
  telefone: string | null;
  banco: string | null;
  agencia: string | null;
  contaCorrente: string | null;
  titularBanco: string | null;
  docTitular: string | null;
  chavePix: string | null;
}

function detectMediaType(path: string, blobType: string | undefined): string | null {
  const t = (blobType ?? "").toLowerCase();
  if (t.startsWith("image/") || t === "application/pdf") return t;
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "application/pdf";
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) return `image/${ext === "jpg" ? "jpeg" : ext}`;
  return null;
}

/**
 * Lê um contrato/orçamento de FORNECEDOR (som, luz, palco, camarim, buffet etc.)
 * e extrai cadastro (incl. dados bancários), serviço, valor e parcelas.
 * Não cria cadastro — o salvamento resolve/deduplica por CNPJ.
 */
export async function extractFornecedorContract(
  attachmentPath: string,
): Promise<{ data: FornecedorOcrResult } | { error: string }> {
  await requireCaseUser();
  if (!attachmentPath) return { error: "Anexo não informado." };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "Leitura automática indisponível (sem OPENAI_API_KEY)." };

  const db = (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
  const { data: blob, error: dlErr } = await db.storage.from(ATTACHMENT_BUCKET).download(attachmentPath);
  if (dlErr || !blob) return { error: "Não foi possível acessar o contrato para leitura." };

  const mediaType = detectMediaType(attachmentPath, blob.type);
  if (!mediaType) return { error: "Formato não suportado (use PDF ou imagem)." };

  const bytes = Buffer.from(await blob.arrayBuffer());
  const docPart =
    mediaType === "application/pdf"
      ? { type: "file" as const, data: bytes, mediaType }
      : { type: "file" as const, data: bytes, mediaType, providerOptions: { openai: { imageDetail: "high" as const } } };

  const provider = createOpenAI({ apiKey });

  try {
    const res = await generateObject({
      model: provider(OCR_MODEL),
      schema: FornecedorContractSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Leia este CONTRATO ou ORÇAMENTO DE FORNECEDOR de serviços para um evento/show " +
                "(ex.: sonorização, iluminação, palco, camarim, buffet, produção, transporte). " +
                "Extraia: o nome/razão social e CNPJ/CPF do FORNECEDOR (a parte que presta o serviço " +
                "e recebe o pagamento — não o contratante); uma descrição curta do serviço; o valor " +
                "total; as datas e valores das parcelas de pagamento; contatos (e-mail, telefone); e os " +
                "dados bancários para pagamento (banco, agência, conta, titular, CPF/CNPJ do titular, " +
                "chave PIX). Não invente — deixe null o que não estiver no documento. " +
                regrasParcelas(),
            },
            docPart,
          ],
        },
      ],
    });
    const o = res.object;
    return {
      data: {
        nome: (o.fornecedor_nome ?? "").trim() || null,
        doc: o.fornecedor_cnpj_cpf,
        descricao: o.descricao_servico,
        valorTotal: o.valor_total,
        parcelas: o.parcelas_pagamento ?? [],
        email: o.email,
        telefone: o.telefone,
        banco: o.banco,
        agencia: o.agencia,
        contaCorrente: o.conta_corrente,
        titularBanco: o.titular_banco,
        docTitular: o.doc_titular,
        chavePix: o.chave_pix,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Não consegui interpretar o contrato: ${msg}` };
  }
}

/**
 * Lê o contrato do artista (PDF/imagem) via GPT-4o visão, extrai valores/datas/dados
 * do show e AUTO-CADASTRA a banda em case_bands quando não existir (por CNPJ/CPF).
 */
export async function extractArtistContract(
  attachmentPath: string,
): Promise<{ data: ArtistOcrResult } | { error: string }> {
  const ctx = await requireCaseUser();
  if (!attachmentPath) return { error: "Anexo não informado." };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { error: "Leitura automática indisponível (sem OPENAI_API_KEY)." };

  const db = (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);

  const { data: blob, error: dlErr } = await db.storage.from(ATTACHMENT_BUCKET).download(attachmentPath);
  if (dlErr || !blob) return { error: "Não foi possível acessar o contrato para leitura." };

  const mediaType = detectMediaType(attachmentPath, blob.type);
  if (!mediaType) return { error: "Formato não suportado (use PDF ou imagem)." };

  const bytes = Buffer.from(await blob.arrayBuffer());
  const docPart =
    mediaType === "application/pdf"
      ? { type: "file" as const, data: bytes, mediaType }
      : { type: "file" as const, data: bytes, mediaType, providerOptions: { openai: { imageDetail: "high" as const } } };

  const provider = createOpenAI({ apiKey });

  let object: z.infer<typeof ArtistContractSchema>;
  try {
    const res = await generateObject({
      model: provider(OCR_MODEL),
      schema: ArtistContractSchema,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text:
                "Leia este CONTRATO DO ARTISTA (contratação de show/atração). Extraia: o nome do " +
                "artista/banda; o CNPJ/CPF do artista ou de sua produtora; o valor do cachê; as datas e " +
                "valores de pagamento ao artista; e os dados do show (data, horário, duração/passagem de " +
                "som, local, endereço e cidade). Não invente — deixe null o que não estiver no documento. " +
                regrasParcelas(),
            },
            docPart,
          ],
        },
      ],
    });
    object = res.object;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Não consegui interpretar o contrato: ${msg}` };
  }

  // Auto-cadastro da banda por CNPJ/CPF.
  let bandId: string | null = null;
  let bandCreated = false;
  const doc = onlyDigits(object.artista_cnpj_cpf);
  const name = (object.artista_nome ?? "").trim();

  if (doc) {
    const { data: bands } = await db.from("case_bands").select("id, cnpj_cpf");
    const match = (bands ?? []).find((b: { id: string; cnpj_cpf: string | null }) => onlyDigits(b.cnpj_cpf) === doc);
    if (match) {
      bandId = match.id as string;
    } else if (name) {
      const { data: inserted } = await db
        .from("case_bands")
        .insert({
          name,
          cnpj_cpf: object.artista_cnpj_cpf,
          pessoa_fisica: doc.length === 11,
          created_by: ctx.id,
        })
        .select("id")
        .single();
      if (inserted) {
        bandId = inserted.id as string;
        bandCreated = true;
      }
    }
  }

  return {
    data: {
      bandId,
      bandName: name || null,
      bandDoc: object.artista_cnpj_cpf,
      bandCreated,
      valorCache: object.valor_cache,
      parcelas: object.parcelas_pagamento ?? [],
      dataShow: object.data_show,
      horario: object.horario,
      duracao: object.duracao,
      local: object.local,
      endereco: object.endereco,
      cidade: object.cidade,
    },
  };
}
