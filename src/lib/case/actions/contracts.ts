"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
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

/** Gera URL assinada (5 min) do PDF do contrato. */
export async function getContractAttachmentUrl(
  contractId: string,
): Promise<{ url: string } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();
  const { data: contract } = await db
    .from("case_contracts")
    .select("attachment_path")
    .eq("id", contractId)
    .single();
  if (!contract?.attachment_path) return { error: "Contrato sem anexo." };
  const { data, error } = await db.storage
    .from(ATTACHMENT_BUCKET)
    .createSignedUrl(contract.attachment_path, 60 * 5);
  if (error || !data?.signedUrl) return { error: "Falha ao gerar link do anexo." };
  return { url: data.signedUrl };
}

async function resolveClient(db: DB, input: CaseClientInput, userId: string): Promise<string> {
  if (input.id) {
    await db
      .from("case_clients")
      .update({
        name: input.name,
        cnpj_cpf: input.cnpj_cpf,
        pessoa_fisica: input.pessoa_fisica,
        email: input.email,
        phone: input.phone,
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
    if (match) return match.id as string;
  }

  const { data, error } = await db
    .from("case_clients")
    .insert({
      name: input.name,
      cnpj_cpf: input.cnpj_cpf,
      pessoa_fisica: input.pessoa_fisica,
      email: input.email,
      phone: input.phone,
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
  | { ok: true; contractId: string; contractNumber: number; status: string }
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

  // ── Lançamento no Omie ─────────────────────────────────────────────────
  let status = "rascunho";
  try {
    const { launchContractToOmie } = await import("@/lib/case/actions/contract-launch");
    const res = await launchContractToOmie(db, contract.id as string);
    if ("status" in res) status = res.status;
  } catch (e) {
    console.error("[case] launchContractToOmie falhou:", e);
  }

  revalidatePath("/case/contratos");
  revalidatePath("/case/dashboard");

  return {
    ok: true,
    contractId: contract.id as string,
    contractNumber: contract.contract_number as number,
    status,
  };
}
