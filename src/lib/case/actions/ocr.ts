"use server";

import { generateObject } from "ai";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveAiProvider,
  logResolvedUsage,
  generateJsonViaChat,
  AI_PROVIDER_LABELS,
} from "@/lib/ai/provider";
import { extractPdfText } from "@/lib/pdf/text";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { CONTRATADO, DADOS_BANCARIOS } from "@/lib/case/contract-config";
import type { PixTipo } from "@/lib/case/pix";

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
  artista_nome: z.string().nullable().describe("Nome ARTÍSTICO da atração (banda, cantor, DJ) — como aparece no objeto do contrato. Null se não encontrar."),
  contratado_nome: z.string().nullable().describe("Razão social (PJ) ou nome completo (PF) da parte CONTRATADA — quem presta o show e recebe o cachê. Nunca a CS Agência. Null se não encontrar."),
  contratado_cnpj_cpf: z.string().nullable().describe("CNPJ ou CPF da parte CONTRATADA, tirado do parágrafo de qualificação dela. Só números. Null se não encontrar."),
  contratado_email: z.string().nullable().describe("E-mail da parte CONTRATADA. Null se não encontrar."),
  contratado_telefone: z.string().nullable().describe("Telefone da parte CONTRATADA. Null se não encontrar."),
  favorecido_nome: z.string().nullable().describe("Titular da conta que recebe o cachê, como escrito na cláusula de pagamento. Null se não houver dados bancários."),
  favorecido_cnpj_cpf: z.string().nullable().describe("CPF/CNPJ do titular da conta que recebe. Só números. Null se não encontrar."),
  banco: z.string().nullable().describe("Banco da conta que recebe (nome e código se houver, ex.: '341 - Itaú'). Null se não encontrar."),
  agencia: z.string().nullable().describe("Agência, com dígito se houver. Null se não encontrar."),
  conta_corrente: z.string().nullable().describe("Conta, com dígito se houver. Null se não encontrar."),
  chave_pix: z.string().nullable().describe("Chave PIX da conta que recebe, exatamente como escrita. Null se não encontrar."),
  chave_pix_tipo: z
    .enum(["cpf_cnpj", "telefone", "email", "aleatoria"])
    .nullable()
    .describe("Tipo da chave PIX. Null se não houver chave."),
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

// JSON Schema (texto) da saída do artista — injetado no prompt do provedor de
// texto (DeepSeek etc.), que não recebe o schema Zod como regra de máquina.
const ARTIST_SCHEMA_HINT = JSON.stringify({
  type: "object",
  properties: {
    artista_nome: { type: ["string", "null"], description: "Nome artístico da atração" },
    contratado_nome: { type: ["string", "null"], description: "Razão social/nome da parte CONTRATADA (quem recebe)" },
    contratado_cnpj_cpf: { type: ["string", "null"], description: "CNPJ/CPF da parte CONTRATADA, só números" },
    contratado_email: { type: ["string", "null"] },
    contratado_telefone: { type: ["string", "null"] },
    favorecido_nome: { type: ["string", "null"], description: "Titular da conta que recebe" },
    favorecido_cnpj_cpf: { type: ["string", "null"], description: "CPF/CNPJ do titular da conta, só números" },
    banco: { type: ["string", "null"] },
    agencia: { type: ["string", "null"] },
    conta_corrente: { type: ["string", "null"] },
    chave_pix: { type: ["string", "null"] },
    chave_pix_tipo: { type: ["string", "null"], enum: ["cpf_cnpj", "telefone", "email", "aleatoria", null] },
    valor_cache: { type: ["number", "null"], description: "Valor total do cachê em reais (decimal)" },
    parcelas_pagamento: {
      type: "array",
      description: "Parcelas de pagamento ao artista",
      items: {
        type: "object",
        properties: {
          data: { type: ["string", "null"], description: "Vencimento YYYY-MM-DD" },
          valor: { type: ["number", "null"], description: "Valor da parcela em reais" },
        },
      },
    },
    data_show: { type: ["string", "null"], description: "Data do show YYYY-MM-DD" },
    horario: { type: ["string", "null"], description: "Horário da apresentação" },
    duracao: { type: ["string", "null"], description: "Duração/passagem de som" },
    local: { type: ["string", "null"], description: "Nome do local/casa" },
    endereco: { type: ["string", "null"], description: "Endereço do local" },
    cidade: { type: ["string", "null"], description: "Cidade/UF" },
  },
});

/**
 * Regras de identificação das partes no contrato da atração. O erro recorrente
 * era misturar as partes: a CS Agência é a CONTRATANTE aqui (no contrato com o
 * cliente ela é a contratada), e o modelo pegava o CNPJ/conta dela, o CPF do
 * representante legal ou da testemunha no lugar de quem de fato recebe.
 */
function regrasPartesArtista(): string {
  return [
    "COMO IDENTIFICAR AS PARTES:",
    `- A CONTRATANTE é a nossa agência: ${CONTRATADO.razao} (CNPJ ${CONTRATADO.cnpj}), também chamada ` +
      `"Case", "Case Shows" ou "CS Agência". NUNCA devolva nome, CNPJ, e-mail, telefone ou conta ` +
      `bancária dela — nem a conta ${DADOS_BANCARIOS.banco} ag. ${DADOS_BANCARIOS.agencia} c/c ${DADOS_BANCARIOS.conta}. ` +
      "Se o contrato for de um cliente (formatura, prefeitura, casa de show) contratando a atração, esse cliente também é contratante e deve ser ignorado.",
    '- A CONTRATADA é quem presta o show e recebe o cachê. Pode aparecer como "CONTRATADA", "CONTRATADO", ' +
      '"PRODUTORA", "EMPRESÁRIO", "AGENCIADORA", "REPRESENTANTE" ou "ARTISTA". Quando uma produtora/empresa ' +
      "representa o artista, a CONTRATADA é a produtora (o artista pode aparecer como INTERVENIENTE/ANUENTE).",
    '- contratado_cnpj_cpf vem do parágrafo de qualificação da CONTRATADA ("inscrita no CNPJ sob o nº…", ' +
      '"portador do CPF nº…"). Se a CONTRATADA tem CNPJ, o CPF do sócio/representante legal que assina por ela NÃO ' +
      "é o documento dela. CPF de testemunha nunca entra.",
    "- Nome e documento do contratado têm que ser da MESMA pessoa/empresa. Se a CONTRATADA é só um nome de " +
      "banda/grupo sem CNPJ próprio e o único documento é o CPF de quem a representa, devolva o nome dessa " +
      "pessoa em contratado_nome com o CPF dela (o nome da banda vai em artista_nome).",
    '- artista_nome é o nome artístico que vai se apresentar (ex.: "Banda Tal"), normalmente no objeto do ' +
      "contrato. Pode ser diferente da razão social da CONTRATADA.",
    "",
    "DADOS DO FAVORECIDO (conta que recebe o cachê):",
    '- Procure na cláusula de pagamento/remuneração e em anexos: "dados bancários", "depósito", ' +
      '"transferência", "TED", "PIX", "favorecido", "titular", "em nome de".',
    "- favorecido_nome e favorecido_cnpj_cpf são do TITULAR DA CONTA, que pode ser diferente da CONTRATADA " +
      "(ex.: conta pessoal do artista ou do empresário). Copie como estiver escrito.",
    '- Se a conta vier sem titular explícito, mas o texto disser que o pagamento é feito "à CONTRATADA" ' +
      '/"em conta da CONTRATADA", use o nome e o documento da CONTRATADA como favorecido.',
    "- Sem nenhum dado bancário no documento, deixe os campos do favorecido e do banco null — não repita a CONTRATADA.",
    "- chave_pix_tipo: 11 dígitos (CPF) ou 14 dígitos (CNPJ) = cpf_cnpj; contém @ = email; DDD + número de " +
      "telefone = telefone; código longo com letras e hífens (formato UUID) = aleatoria. Se o texto disser o " +
      'tipo ("PIX CNPJ", "PIX celular"), siga o texto.',
  ].join("\n");
}

export interface ArtistOcrResult {
  bandName: string | null;
  artistName: string | null;
  bandDoc: string | null;
  email: string | null;
  telefone: string | null;
  titularBanco: string | null;
  docTitular: string | null;
  banco: string | null;
  agencia: string | null;
  contaCorrente: string | null;
  chavePix: string | null;
  chavePixTipo: PixTipo | null;
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

const FORNECEDOR_SCHEMA_HINT = JSON.stringify({
  type: "object",
  properties: {
    fornecedor_nome: { type: ["string", "null"], description: "Nome/razão social do FORNECEDOR (quem recebe)" },
    fornecedor_cnpj_cpf: { type: ["string", "null"], description: "CNPJ/CPF do fornecedor, só números" },
    descricao_servico: { type: ["string", "null"], description: "Descrição curta do serviço" },
    valor_total: { type: ["number", "null"], description: "Valor total em reais (decimal)" },
    parcelas_pagamento: {
      type: "array",
      description: "Parcelas de pagamento ao fornecedor",
      items: {
        type: "object",
        properties: {
          data: { type: ["string", "null"], description: "Vencimento YYYY-MM-DD" },
          valor: { type: ["number", "null"], description: "Valor da parcela em reais" },
        },
      },
    },
    email: { type: ["string", "null"] },
    telefone: { type: ["string", "null"] },
    banco: { type: ["string", "null"] },
    agencia: { type: ["string", "null"] },
    conta_corrente: { type: ["string", "null"] },
    titular_banco: { type: ["string", "null"] },
    doc_titular: { type: ["string", "null"], description: "CPF/CNPJ do titular da conta" },
    chave_pix: { type: ["string", "null"] },
  },
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

const providerLabel = (name: string): string => AI_PROVIDER_LABELS[name] ?? name;

/**
 * Lê um contrato (PDF/imagem) com o provedor de IA ATIVO no painel (Plataforma >
 * IA) — antes esta leitura era fixa na OpenAI (capability "vision"), o que
 * quebrava quando o provedor ativo era o DeepSeek e a chave da OpenAI estava
 * inválida. Agora:
 *   - OpenAI ativo → visão direta sobre o PDF/imagem (generateObject).
 *   - Provedor sem visão (DeepSeek etc.) → extrai a camada de TEXTO do PDF e
 *     interpreta via chat JSON (generateJsonViaChat, response_format json_object).
 *     Imagem ou PDF escaneado (sem texto) não é possível nesse provedor — devolve
 *     um erro claro orientando a usar PDF com texto ou ativar a OpenAI.
 */
// O download usa service role (ignora a policy do bucket), então a pasta
// `<uid>/` do próprio usuário — regra do upload — é conferida antes.
function ownsAttachment(userId: string, attachmentPath: string): boolean {
  return attachmentPath.startsWith(`${userId}/`) && !attachmentPath.includes("..");
}

async function readContractDoc<T extends z.ZodTypeAny>(
  attachmentPath: string,
  opts: { schema: T; schemaHint: string; instrucao: string; system: string },
): Promise<{ object: z.infer<T> } | { error: string }> {
  const resolved = await resolveAiProvider({ role: "ocr" }).catch(() => null);
  if (!resolved) {
    return { error: "Leitura automática indisponível: configure o provedor de IA em Plataforma > IA." };
  }

  const db = (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
  const { data: blob, error: dlErr } = await db.storage.from(ATTACHMENT_BUCKET).download(attachmentPath);
  if (dlErr || !blob) return { error: "Não foi possível acessar o contrato para leitura." };

  const mediaType = detectMediaType(attachmentPath, blob.type);
  if (!mediaType) return { error: "Formato não suportado (use PDF ou imagem)." };
  const bytes = Buffer.from(await blob.arrayBuffer());

  // OpenAI ativo: visão direta (lê PDF e imagem em um passo só).
  if (resolved.providerName === "openai") {
    const docPart =
      mediaType === "application/pdf"
        ? { type: "file" as const, data: bytes, mediaType }
        : { type: "file" as const, data: bytes, mediaType, providerOptions: { openai: { imageDetail: "high" as const } } };
    try {
      const res = await generateObject({
        model: resolved.provider(OCR_MODEL),
        schema: opts.schema,
        system: opts.system,
        messages: [{ role: "user", content: [{ type: "text", text: opts.instrucao }, docPart] }],
      });
      await logResolvedUsage(resolved, "ocr", res.usage, { modelName: OCR_MODEL });
      return { object: res.object as z.infer<T> };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { error: `Não consegui interpretar o contrato: ${msg}` };
    }
  }

  // Provedor ativo sem visão (DeepSeek etc.): precisa do TEXTO do PDF.
  if (mediaType !== "application/pdf") {
    return {
      error:
        `O provedor de IA ativo (${providerLabel(resolved.providerName)}) não lê imagens. ` +
        "Envie o contrato em PDF com texto selecionável, ou ative a OpenAI em Plataforma > IA para ler imagens.",
    };
  }
  const pdf = extractPdfText(bytes);
  if (pdf.plain.trim().length < 40) {
    return {
      error:
        `O provedor de IA ativo (${providerLabel(resolved.providerName)}) não conseguiu ler este PDF ` +
        "(parece escaneado, sem camada de texto). Use um PDF com texto selecionável, ou ative a OpenAI " +
        "em Plataforma > IA para OCR de imagem.",
    };
  }
  try {
    const { object, usage } = await generateJsonViaChat(resolved, {
      system: opts.system,
      prompt:
        `${opts.instrucao}\n\nTEXTO DO CONTRATO (extraído do PDF — o layout se perdeu, mas os rótulos ` +
        `permaneceram):\n${pdf.plain}`,
      schemaHint: opts.schemaHint,
      // Provedores com raciocínio (Gemini Flash) gastam parte do teto pensando antes
      // do JSON; com 2000 a leitura do artista cortava no meio (finish_reason=length).
      maxTokens: 8000,
      temperature: 0,
    });
    await logResolvedUsage(resolved, "ocr", usage);
    const parsed = opts.schema.safeParse(object);
    if (!parsed.success) {
      return { error: "A IA devolveu um formato inesperado ao ler o contrato. Tente novamente." };
    }
    return { object: parsed.data };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Não consegui interpretar o contrato: ${msg}` };
  }
}

/**
 * Lê um contrato/orçamento de FORNECEDOR (som, luz, palco, camarim, buffet etc.)
 * e extrai cadastro (incl. dados bancários), serviço, valor e parcelas.
 * Não cria cadastro — o salvamento resolve/deduplica por CNPJ.
 */
export async function extractFornecedorContract(
  attachmentPath: string,
): Promise<{ data: FornecedorOcrResult } | { error: string }> {
  const ctx = await requireCaseUser();
  if (!attachmentPath) return { error: "Anexo não informado." };
  if (!ownsAttachment(ctx.id, attachmentPath)) return { error: "Anexo não pertence a este usuário." };

  const r = await readContractDoc(attachmentPath, {
    schema: FornecedorContractSchema,
    schemaHint: FORNECEDOR_SCHEMA_HINT,
    instrucao:
      "Leia este CONTRATO ou ORÇAMENTO DE FORNECEDOR de serviços para um evento/show " +
      "(ex.: sonorização, iluminação, palco, camarim, buffet, produção, transporte). " +
      "Extraia: o nome/razão social e CNPJ/CPF do FORNECEDOR (a parte que presta o serviço " +
      "e recebe o pagamento — não o contratante); uma descrição curta do serviço; o valor " +
      "total; as datas e valores das parcelas de pagamento; contatos (e-mail, telefone); e os " +
      "dados bancários para pagamento (banco, agência, conta, titular, CPF/CNPJ do titular, " +
      "chave PIX). Não invente — deixe null o que não estiver no documento. " +
      regrasParcelas(),
    system:
      "Você lê contratos/orçamentos de fornecedores de eventos a partir do texto de um PDF e " +
      "devolve os campos pedidos em JSON. Não invente dados.",
  });
  if ("error" in r) return { error: r.error };
  const o = r.object;
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
}

/**
 * Lê o contrato do artista (PDF/imagem) e extrai a parte contratada, o favorecido
 * (conta que recebe), cachê, parcelas e dados do show. Não cria cadastro — como no
 * fornecedor, o salvamento resolve/deduplica por CNPJ depois da revisão na tela.
 */
export async function extractArtistContract(
  attachmentPath: string,
): Promise<{ data: ArtistOcrResult } | { error: string }> {
  const ctx = await requireCaseUser();
  if (!attachmentPath) return { error: "Anexo não informado." };
  if (!ownsAttachment(ctx.id, attachmentPath)) return { error: "Anexo não pertence a este usuário." };

  const r = await readContractDoc(attachmentPath, {
    schema: ArtistContractSchema,
    schemaHint: ARTIST_SCHEMA_HINT,
    instrucao:
      "Leia este CONTRATO DE CONTRATAÇÃO DE ATRAÇÃO (show de artista/banda/DJ). Extraia: o nome " +
      "artístico da atração; a razão social/nome, CNPJ/CPF, e-mail e telefone da parte CONTRATADA; " +
      "os dados do FAVORECIDO (titular, CPF/CNPJ do titular, banco, agência, conta e chave PIX); o " +
      "valor do cachê; as datas e valores de pagamento; e os dados do show (data, horário, " +
      "duração/passagem de som, local, endereço e cidade). Não invente — deixe null o que não " +
      "estiver no documento.\n\n" +
      regrasPartesArtista() +
      "\n\n" +
      regrasParcelas(),
    system:
      "Você lê contratos de contratação de artistas/shows para a CS Agência (Case Shows), que é " +
      "sempre a CONTRATANTE, e devolve os campos pedidos em JSON. Sua tarefa mais importante é não " +
      "confundir as partes: os dados cadastrais e bancários são de quem RECEBE o cachê. Não invente dados.",
  });
  if ("error" in r) return { error: r.error };
  const o = r.object;

  // Rede de segurança do prompt: documento da própria agência nunca é o contratado/favorecido.
  const caseDoc = onlyDigits(CONTRATADO.cnpj);
  const notCase = (doc: string | null) => (doc && onlyDigits(doc) !== caseDoc ? doc : null);
  const contratadoDoc = notCase(o.contratado_cnpj_cpf);
  const favorecidoDoc = notCase(o.favorecido_cnpj_cpf);
  const bancarioDaCase =
    (!!o.favorecido_cnpj_cpf && !favorecidoDoc) || (!!o.chave_pix && onlyDigits(o.chave_pix) === caseDoc);

  const artista = (o.artista_nome ?? "").trim();
  const contratado = (o.contratado_nome ?? "").trim();

  return {
    data: {
      // O cadastro vira fornecedor no Omie: razão social de quem recebe, não o nome artístico.
      bandName: contratado || artista || null,
      artistName: artista || null,
      bandDoc: contratadoDoc,
      email: o.contratado_email,
      telefone: o.contratado_telefone,
      titularBanco: bancarioDaCase ? null : (o.favorecido_nome ?? "").trim() || null,
      docTitular: bancarioDaCase ? null : favorecidoDoc,
      banco: bancarioDaCase ? null : o.banco,
      agencia: bancarioDaCase ? null : o.agencia,
      contaCorrente: bancarioDaCase ? null : o.conta_corrente,
      chavePix: bancarioDaCase ? null : o.chave_pix,
      chavePixTipo: bancarioDaCase || !o.chave_pix ? null : o.chave_pix_tipo,
      valorCache: o.valor_cache,
      parcelas: o.parcelas_pagamento ?? [],
      dataShow: o.data_show,
      horario: o.horario,
      duracao: o.duracao,
      local: o.local,
      endereco: o.endereco,
      cidade: o.cidade,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Texto colado (pedido que chega por WhatsApp)
// ────────────────────────────────────────────────────────────────────────────

const BriefingSchema = z.object({
  cliente_nome: z.string().nullable().describe("Quem contrata: comissão de formatura, fundo, empresa, prefeitura ou pessoa. Null se não encontrar."),
  cliente_cnpj_cpf: z.string().nullable().describe("CNPJ ou CPF do contratante. Só números. Null se não encontrar."),
  cliente_responsavel: z.string().nullable().describe("Nome da pessoa responsável pelo contratante. Null se não encontrar."),
  cliente_cpf_responsavel: z.string().nullable().describe("CPF do responsável. Só números. Null se não encontrar."),
  cliente_email: z.string().nullable().describe("E-mail de contato do contratante. Null se não encontrar."),
  cliente_telefone: z.string().nullable().describe("Telefone/WhatsApp do contratante. Null se não encontrar."),
  cliente_cidade_estado: z.string().nullable().describe("Cidade/UF do contratante, se diferente do local do evento. Null se não encontrar."),
  evento_nome: z.string().nullable().describe("Nome do evento (ex.: 'Formatura Medicina 13 FAGOC', 'Baile de Máscaras'). Sem o nome da atração. Null se não encontrar."),
  atracao_nome: z.string().nullable().describe("Nome da atração/artista contratada. Null se não encontrar."),
  data_evento: z.string().nullable().describe("Data do evento em YYYY-MM-DD. Null se não encontrar."),
  horario: z.string().nullable().describe("Horário da apresentação (ex.: '23:00' ou '01h às 03h'). Null se não encontrar."),
  duracao: z.string().nullable().describe("Duração do show (ex.: '90 minutos'). Null se não encontrar."),
  passagem_som: z.string().nullable().describe("Horário da passagem de som. Null se não encontrar."),
  local_nome: z.string().nullable().describe("Nome da casa/espaço do evento. Null se não encontrar."),
  local_endereco: z.string().nullable().describe("Endereço do local. Null se não encontrar."),
  local_cidade: z.string().nullable().describe("Cidade/UF do evento. Null se não encontrar."),
  local_cep: z.string().nullable().describe("CEP do local. Null se não encontrar."),
  tipo_evento: z.enum(["aberto", "fechado"]).nullable().describe("'aberto' quando há venda de ingresso ao público; 'fechado' quando é evento privado/convidados. Null se o texto não disser."),
  cortesias: z.string().nullable().describe("Cortesias combinadas (ex.: '10 cortesias'). Null se não encontrar."),
  valor_cobrado_cliente: z.number().nullable().describe("Valor total cobrado DO CLIENTE pela atração, em reais. Null se não encontrar."),
  parcelas_recebimento: z
    .array(
      z.object({
        data: z.string().nullable().describe("Vencimento YYYY-MM-DD."),
        valor: z.number().nullable().describe("Valor da parcela em reais."),
      }),
    )
    .describe("Parcelas que o cliente vai pagar. Vazio se o texto não detalhar."),
  observacao: z.string().nullable().describe("Combinados que não couberam nos outros campos (camarim, transporte, hospedagem, estrutura). Uma ou duas frases. Null se não houver."),
});

const BRIEFING_SCHEMA_HINT = JSON.stringify({
  type: "object",
  properties: {
    cliente_nome: { type: ["string", "null"] },
    cliente_cnpj_cpf: { type: ["string", "null"], description: "Só números" },
    cliente_responsavel: { type: ["string", "null"] },
    cliente_cpf_responsavel: { type: ["string", "null"], description: "Só números" },
    cliente_email: { type: ["string", "null"] },
    cliente_telefone: { type: ["string", "null"] },
    cliente_cidade_estado: { type: ["string", "null"] },
    evento_nome: { type: ["string", "null"], description: "Sem o nome da atração" },
    atracao_nome: { type: ["string", "null"] },
    data_evento: { type: ["string", "null"], description: "YYYY-MM-DD" },
    horario: { type: ["string", "null"] },
    duracao: { type: ["string", "null"] },
    passagem_som: { type: ["string", "null"] },
    local_nome: { type: ["string", "null"] },
    local_endereco: { type: ["string", "null"] },
    local_cidade: { type: ["string", "null"] },
    local_cep: { type: ["string", "null"] },
    tipo_evento: { type: ["string", "null"], enum: ["aberto", "fechado", null] },
    cortesias: { type: ["string", "null"] },
    valor_cobrado_cliente: { type: ["number", "null"], description: "Reais, decimal" },
    parcelas_recebimento: {
      type: "array",
      items: {
        type: "object",
        properties: {
          data: { type: ["string", "null"], description: "YYYY-MM-DD" },
          valor: { type: ["number", "null"] },
        },
      },
    },
    observacao: { type: ["string", "null"] },
  },
});

export interface BriefingResult {
  clienteNome: string | null;
  clienteDoc: string | null;
  clienteResponsavel: string | null;
  clienteCpfResponsavel: string | null;
  clienteEmail: string | null;
  clienteTelefone: string | null;
  clienteCidadeEstado: string | null;
  eventoNome: string | null;
  atracaoNome: string | null;
  dataEvento: string | null;
  horario: string | null;
  duracao: string | null;
  passagemSom: string | null;
  localNome: string | null;
  localEndereco: string | null;
  localCidade: string | null;
  localCep: string | null;
  tipoEvento: "aberto" | "fechado" | null;
  cortesias: string | null;
  valorCobradoCliente: number | null;
  parcelas: Array<{ data: string | null; valor: number | null }>;
  observacao: string | null;
}

/** Regras de leitura de um pedido informal (mensagem de WhatsApp, e-mail, áudio transcrito). */
function regrasBriefing(): string {
  const hoje = new Date().toISOString().slice(0, 10);
  return [
    `Hoje é ${hoje}.`,
    "COMO LER:",
    "- O texto é informal, pode ter abreviação, gíria, emoji e informação fora de ordem. Extraia só o que estiver escrito; " +
      "o que não estiver, devolva null. Não deduza valor, data ou nome que o texto não traz.",
    "- Datas: devolva sempre YYYY-MM-DD. Sem o ano (\"dia 14/11\", \"sábado 23/03\"), use a PRÓXIMA ocorrência a partir de hoje. " +
      "Dia da semana sozinho, sem data, é null.",
    "- Valores: \"8k\", \"8 mil\", \"R$ 8.000,00\" e \"8000\" são 8000. \"1,5k\" é 1500. Ponto é milhar e vírgula é decimal.",
    `- Parcela paga "na assinatura", "no ato", "à vista" ou "na reserva" (sem data no texto) usa a data ${amanhaISO()}. ` +
      "Parcela descrita só em percentual, sem valor nem data que dê para calcular, fica fora da lista.",
    "- O valor que interessa é o COBRADO DO CLIENTE pela atração. Se o texto também trouxer o cachê que a agência paga ao " +
      "artista, ignore: não é esse campo.",
    "- evento_nome é o evento (formatura, aniversário, festa da cidade); atracao_nome é quem se apresenta. Se vierem " +
      "grudados (\"Formatura Med 13 - Ousa Samba\"), separe nos dois campos.",
    "- Telefone e CPF/CNPJ: devolva só os números.",
  ].join("\n");
}

/**
 * Interpreta o pedido que chegou em texto (WhatsApp) e devolve sugestões para o
 * formulário. Não grava nada — quem preenche é a tela, e o usuário revisa.
 */
export async function extractContractFromText(
  texto: string,
): Promise<{ data: BriefingResult } | { error: string }> {
  await requireCaseUser();
  const raw = (texto ?? "").trim();
  if (raw.length < 15) return { error: "Cole o texto do pedido (pelo menos algumas palavras)." };
  // Teto defensivo: mensagem colada é curta; texto gigante só queima token.
  const conteudo = raw.slice(0, 8000);

  const resolved = await resolveAiProvider({ role: "ocr" }).catch(() => null);
  if (!resolved) {
    return { error: "Leitura automática indisponível: configure o provedor de IA em Plataforma > IA." };
  }

  const instrucao =
    "Leia o pedido abaixo, recebido de um cliente (normalmente por WhatsApp), e extraia os dados para abrir o " +
    "contrato de uma atração.\n\n" +
    regrasBriefing() +
    "\n\nPEDIDO:\n" +
    conteudo;
  const system =
    "Você organiza pedidos informais de contratação de shows para a CS Agência (Case Shows) e devolve os campos " +
    "pedidos em JSON. Campo que o texto não traz é null — nunca invente nome, data ou valor.";

  try {
    let object: unknown;
    if (resolved.providerName === "openai") {
      const res = await generateObject({
        model: resolved.provider(OCR_MODEL),
        schema: BriefingSchema,
        system,
        prompt: instrucao,
      });
      await logResolvedUsage(resolved, "ocr", res.usage, { modelName: OCR_MODEL });
      object = res.object;
    } else {
      const chat = await generateJsonViaChat(resolved, {
        system,
        prompt: instrucao,
        schemaHint: BRIEFING_SCHEMA_HINT,
        maxTokens: 8000,
        temperature: 0,
      });
      await logResolvedUsage(resolved, "ocr", chat.usage);
      object = chat.object;
    }
    const parsed = BriefingSchema.safeParse(object);
    if (!parsed.success) {
      return { error: "A IA devolveu um formato inesperado ao ler o texto. Tente novamente." };
    }
    const o = parsed.data;
    return {
      data: {
        clienteNome: o.cliente_nome,
        clienteDoc: o.cliente_cnpj_cpf,
        clienteResponsavel: o.cliente_responsavel,
        clienteCpfResponsavel: o.cliente_cpf_responsavel,
        clienteEmail: o.cliente_email,
        clienteTelefone: o.cliente_telefone,
        clienteCidadeEstado: o.cliente_cidade_estado,
        eventoNome: o.evento_nome,
        atracaoNome: o.atracao_nome,
        dataEvento: o.data_evento,
        horario: o.horario,
        duracao: o.duracao,
        passagemSom: o.passagem_som,
        localNome: o.local_nome,
        localEndereco: o.local_endereco,
        localCidade: o.local_cidade,
        localCep: o.local_cep,
        tipoEvento: o.tipo_evento,
        cortesias: o.cortesias,
        valorCobradoCliente: o.valor_cobrado_cliente,
        parcelas: o.parcelas_recebimento ?? [],
        observacao: o.observacao,
      },
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: `Não consegui interpretar o texto: ${msg}` };
  }
}
