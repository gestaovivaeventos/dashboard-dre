"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
import { buildContractPdf } from "@/lib/case/contract-pdf";
import { clicksignEnabled, createSignatureRequest } from "@/lib/case/clicksign";
import type {
  CaseBandInput,
  CaseClientInput,
  CaseLegKind,
  CaseParcelaInput,
  CreateContractInput,
} from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";
const cents = (v: number) => Math.round((Number(v) || 0) * 100);
const sumCents = (parcelas: CaseParcelaInput[]) =>
  parcelas.reduce((acc, p) => acc + cents(p.valor), 0);
const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

/** Gera URL assinada (5 min) de um PDF do contrato (artista ou venda). */
async function signedUrlFor(
  contractId: string,
  column: "attachment_path" | "sale_contract_path",
): Promise<{ url: string } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();
  const { data: contract } = await db
    .from("case_contracts")
    .select(column)
    .eq("id", contractId)
    .single();
  const path = (contract as Record<string, string | null> | null)?.[column];
  if (!path) return { error: "Arquivo não disponível." };
  const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60 * 5);
  if (error || !data?.signedUrl) return { error: "Falha ao gerar link do arquivo." };
  return { url: data.signedUrl };
}

/** URL do contrato do artista (anexo original). */
export async function getContractAttachmentUrl(contractId: string) {
  return signedUrlFor(contractId, "attachment_path");
}

/** URL do contrato de venda gerado. */
export async function getSaleContractUrl(contractId: string) {
  return signedUrlFor(contractId, "sale_contract_path");
}

/** Reenvia o e-mail de assinatura ClickSign para o cliente. */
export async function resendSignature(
  contractId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();
  const { data: contract } = await db
    .from("case_contracts")
    .select("clicksign_request_key, case_clients(name)")
    .eq("id", contractId)
    .single();
  const requestKey = (contract as { clicksign_request_key: string | null } | null)?.clicksign_request_key;
  if (!requestKey) return { error: "Contrato sem pedido de assinatura ativo." };
  try {
    const { resendNotification } = await import("@/lib/case/clicksign");
    await resendNotification(requestKey, "Lembrete: seu contrato aguarda assinatura.");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao reenviar assinatura." };
  }
}

async function resolveClient(db: DB, input: CaseClientInput, userId: string): Promise<string> {
  const legalFields = {
    email: input.email,
    phone: input.phone,
    resp_legal: input.resp_legal,
    cpf_resp_legal: input.cpf_resp_legal,
    endereco: input.endereco,
    cidade_estado: input.cidade_estado,
    cep: input.cep,
  };

  if (input.id) {
    await db
      .from("case_clients")
      .update({
        name: input.name,
        cnpj_cpf: input.cnpj_cpf,
        pessoa_fisica: input.pessoa_fisica,
        ...legalFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    return input.id;
  }

  const doc = onlyDigits(input.cnpj_cpf);
  if (doc) {
    const { data: existing } = await db.from("case_clients").select("id, cnpj_cpf");
    const match = (existing ?? []).find(
      (c: { id: string; cnpj_cpf: string | null }) => onlyDigits(c.cnpj_cpf) === doc,
    );
    if (match) {
      await db.from("case_clients").update({ ...legalFields }).eq("id", match.id);
      return match.id as string;
    }
  }

  const { data, error } = await db
    .from("case_clients")
    .insert({
      name: input.name,
      cnpj_cpf: input.cnpj_cpf,
      pessoa_fisica: input.pessoa_fisica,
      ...legalFields,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Falha ao cadastrar cliente: ${error?.message ?? "?"}`);
  return data.id as string;
}

async function resolveBand(db: DB, input: CaseBandInput, userId: string): Promise<string> {
  const bankFields = {
    banco: input.banco,
    agencia: input.agencia,
    conta_corrente: input.conta_corrente,
    titular_banco: input.titular_banco,
    doc_titular: input.doc_titular,
    chave_pix: input.chave_pix,
  };

  if (input.id) {
    await db
      .from("case_bands")
      .update({
        name: input.name,
        cnpj_cpf: input.cnpj_cpf,
        pessoa_fisica: input.pessoa_fisica,
        email: input.email,
        phone: input.phone,
        ...bankFields,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id);
    return input.id;
  }

  const doc = onlyDigits(input.cnpj_cpf);
  if (doc) {
    const { data: existing } = await db.from("case_bands").select("id, cnpj_cpf");
    const match = (existing ?? []).find(
      (b: { id: string; cnpj_cpf: string | null }) => onlyDigits(b.cnpj_cpf) === doc,
    );
    if (match) {
      await db.from("case_bands").update({ ...bankFields }).eq("id", match.id);
      return match.id as string;
    }
  }

  const { data, error } = await db
    .from("case_bands")
    .insert({
      name: input.name,
      cnpj_cpf: input.cnpj_cpf,
      pessoa_fisica: input.pessoa_fisica,
      email: input.email,
      phone: input.phone,
      ...bankFields,
      created_by: userId,
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Falha ao cadastrar banda: ${error?.message ?? "?"}`);
  return data.id as string;
}

/**
 * Cria o contrato Case, gera os títulos (parcelas de cada leg) e dispara o
 * lançamento no Omie da Case Shows.
 */
export async function createContract(
  input: CreateContractInput,
): Promise<
  | { ok: true; contractId: string; contractNumber: number; status: string; signUrl?: string; warning?: string }
  | { error: string }
> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  // ── Validações de valor ────────────────────────────────────────────────
  const valorArtista = Number(input.valor_artista) || 0;
  const valorAtracaoCliente = Number(input.valor_atracao_cliente) || 0;
  const valorRider = Number(input.valor_rider) || 0;
  const valorCamarim = Number(input.valor_camarim) || 0;
  const valorExtras = Number(input.valor_extras) || 0;

  if (valorArtista < 0 || valorAtracaoCliente < 0) {
    return { error: "Valores não podem ser negativos." };
  }
  if (cents(valorArtista) > cents(valorAtracaoCliente)) {
    return {
      error:
        "O valor pago ao artista não pode ser maior que o valor cobrado do cliente pela atração.",
    };
  }

  const valorCustodia = valorArtista;
  const valorMargem = valorAtracaoCliente - valorArtista;
  const valorServicos = valorMargem + valorRider + valorCamarim + valorExtras;

  // ── Validação das parcelas: soma == total de cada leg ──────────────────
  const legs: Array<{ kind: CaseLegKind; total: number; parcelas: CaseParcelaInput[]; label: string }> = [
    { kind: "pagar_custodia", total: valorCustodia, parcelas: input.parcelas_pagar_custodia ?? [], label: "pagamento ao artista (custódia)" },
    { kind: "receber_custodia", total: valorCustodia, parcelas: input.parcelas_receber_custodia ?? [], label: "recebimento de custódia do cliente" },
    { kind: "receber_servicos", total: valorServicos, parcelas: input.parcelas_receber_servicos ?? [], label: "recebimento de serviços do cliente" },
  ];

  for (const leg of legs) {
    if (cents(leg.total) === 0) continue; // leg zerada não gera título
    if (leg.parcelas.length === 0) {
      return { error: `Informe ao menos uma parcela para o ${leg.label}.` };
    }
    for (const p of leg.parcelas) {
      if (!p.vencimento) return { error: `Parcela sem vencimento no ${leg.label}.` };
      if (cents(p.valor) <= 0) return { error: `Parcela com valor inválido no ${leg.label}.` };
    }
    if (sumCents(leg.parcelas) !== cents(leg.total)) {
      return {
        error: `A soma das parcelas do ${leg.label} (R$ ${(sumCents(leg.parcelas) / 100).toFixed(2)}) não confere com o total (R$ ${leg.total.toFixed(2)}).`,
      };
    }
  }

  if (!input.client?.name?.trim()) return { error: "Informe o cliente." };
  if (!input.band?.name?.trim()) return { error: "Informe a banda/artista." };

  // ── Cadastros ──────────────────────────────────────────────────────────
  let clientId: string;
  let bandId: string;
  try {
    clientId = await resolveClient(db, input.client, ctx.id);
    bandId = await resolveBand(db, input.band, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar cliente/banda." };
  }

  // ── Contrato ───────────────────────────────────────────────────────────
  const { data: contract, error: contractErr } = await db
    .from("case_contracts")
    .insert({
      company_id: CASE_COMPANY_ID,
      client_id: clientId,
      band_id: bandId,
      event_name: input.event_name,
      event_date: input.event_date,
      show_time: input.show_time,
      show_duration: input.show_duration,
      passagem_som: input.passagem_som,
      local_name: input.local_name,
      local_address: input.local_address,
      local_city: input.local_city,
      local_cep: input.local_cep,
      especificacoes: input.especificacoes,
      valor_artista: valorArtista,
      valor_atracao_cliente: valorAtracaoCliente,
      valor_rider: valorRider,
      valor_camarim: valorCamarim,
      valor_extras: valorExtras,
      valor_custodia: valorCustodia,
      valor_margem: valorMargem,
      valor_servicos: valorServicos,
      attachment_path: input.attachment_path,
      observacao: input.observacao,
      status: "rascunho",
      created_by: ctx.id,
    })
    .select("id, contract_number")
    .single();

  if (contractErr || !contract) {
    return { error: `Falha ao criar contrato: ${contractErr?.message ?? "?"}` };
  }

  // ── Títulos (uma linha por parcela de cada leg) ────────────────────────
  const titleRows: Array<Record<string, unknown>> = [];
  for (const leg of legs) {
    if (cents(leg.total) === 0) continue;
    const total = leg.parcelas.length;
    leg.parcelas.forEach((p, idx) => {
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id,
        leg: leg.kind,
        parcela_numero: n,
        parcela_total: total,
        vencimento: p.vencimento,
        valor: p.valor,
        codigo_integracao: `case-${contract.id}-${leg.kind}-${n}`,
        status: "pendente",
      });
    });
  }

  if (titleRows.length > 0) {
    const { error: titlesErr } = await db.from("case_titles").insert(titleRows);
    if (titlesErr) {
      return { error: `Falha ao gerar os títulos: ${titlesErr.message}` };
    }
  }

  await db.from("case_history").insert({
    contract_id: contract.id,
    user_id: ctx.id,
    action: "criado",
    comment: `Contrato #${contract.contract_number} criado com ${titleRows.length} título(s).`,
  });

  // ── Gera o PDF do contrato de venda ────────────────────────────────────
  const parcelasCliente = [...input.parcelas_receber_custodia, ...input.parcelas_receber_servicos]
    .filter((p) => p.vencimento && cents(p.valor) > 0)
    .sort((a, b) => a.vencimento.localeCompare(b.vencimento));

  let salePdf: Buffer;
  try {
    salePdf = await buildContractPdf({
      contractNumber: contract.contract_number as number,
      cliente: {
        fundo: input.client.name,
        cnpj: input.client.cnpj_cpf,
        respLegal: input.client.resp_legal,
        cpfResp: input.client.cpf_resp_legal,
        endereco: input.client.endereco,
        cidadeEstado: input.client.cidade_estado,
        cep: input.client.cep,
      },
      objeto: {
        artista: input.band.name,
        dataEvento: input.event_date,
        horario: input.show_time,
        passagemSom: input.passagem_som,
        duracao: input.show_duration,
        local: input.local_name,
        endereco: input.local_address,
        cidadeEstado: input.local_city,
        cep: input.local_cep,
        especificacoes: input.especificacoes,
      },
      valores: {
        atracao: valorAtracaoCliente,
        rider: valorRider,
        camarim: valorCamarim,
        extras: valorExtras,
        total: valorAtracaoCliente + valorRider + valorCamarim + valorExtras,
      },
      parcelas: parcelasCliente,
    });
  } catch (e) {
    console.error("[case] falha ao gerar PDF do contrato:", e);
    return {
      ok: true,
      contractId: contract.id as string,
      contractNumber: contract.contract_number as number,
      status: "rascunho",
    };
  }

  const salePath = `${ctx.id}/sale-${contract.id}.pdf`;
  await db.storage.from(ATTACHMENT_BUCKET).upload(salePath, salePdf, {
    contentType: "application/pdf",
    upsert: true,
  });
  await db.from("case_contracts").update({ sale_contract_path: salePath }).eq("id", contract.id);

  // ── Envia para assinatura (ClickSign) ──────────────────────────────────
  if (!clicksignEnabled()) {
    return {
      ok: true,
      contractId: contract.id as string,
      contractNumber: contract.contract_number as number,
      status: "rascunho",
      warning: "Contrato e PDF gerados, mas a assinatura ClickSign não está configurada (CLICKSIGN_API_TOKEN).",
    };
  }

  if (!input.client.email) {
    return {
      ok: true,
      contractId: contract.id as string,
      contractNumber: contract.contract_number as number,
      status: "rascunho",
      warning: "Contrato e PDF gerados, mas o cliente não tem e-mail para envio da assinatura.",
    };
  }

  try {
    const sig = await createSignatureRequest(
      salePdf,
      `Contrato-Case-${contract.contract_number}.pdf`,
      {
        name: input.client.name,
        email: input.client.email,
        cpf: input.client.cpf_resp_legal ?? input.client.cnpj_cpf,
      },
      `Contrato de prestação de serviços artísticos — ${input.band.name}. Por favor, assine.`,
    );

    await db
      .from("case_contracts")
      .update({
        clicksign_document_key: sig.documentKey,
        clicksign_signer_key: sig.signerKey,
        clicksign_request_key: sig.requestKey,
        clicksign_status: "aguardando",
        sign_url: sig.signUrl,
        sent_for_signature_at: new Date().toISOString(),
        status: "aguardando_assinatura",
        updated_at: new Date().toISOString(),
      })
      .eq("id", contract.id);

    await db.from("case_history").insert({
      contract_id: contract.id,
      user_id: ctx.id,
      action: "enviado_assinatura",
      comment: `Enviado para assinatura de ${input.client.name} (${input.client.email}).`,
    });

    revalidatePath("/case/contratos");
    revalidatePath("/case/dashboard");

    return {
      ok: true,
      contractId: contract.id as string,
      contractNumber: contract.contract_number as number,
      status: "aguardando_assinatura",
      signUrl: sig.signUrl,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao enviar para assinatura.";
    await db.from("case_history").insert({
      contract_id: contract.id,
      user_id: ctx.id,
      action: "erro",
      comment: msg,
    });
    return {
      ok: true,
      contractId: contract.id as string,
      contractNumber: contract.contract_number as number,
      status: "rascunho",
      warning: `Contrato salvo, mas houve erro no envio para assinatura: ${msg}`,
    };
  }
}
