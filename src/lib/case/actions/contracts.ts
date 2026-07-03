"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
import { buildContractPdf } from "@/lib/case/contract-pdf";
import { clicksignEnabled, createSignatureRequest } from "@/lib/case/clicksign";
import { getCaseOmieCreds } from "@/lib/case/omie-creds";
import {
  syncClienteToOmieUnit,
  syncSupplierToOmieUnit,
  type OmieSupplierData,
} from "@/lib/omie/clientes";
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

/**
 * Regra "todo cliente já cadastrado na Omie": ao criar um cadastro novo, empurra
 * pro Omie na hora e grava o omie_codigo. Best-effort — se o Omie falhar, o
 * launch do contrato é a rede de segurança (ele reexecuta o mesmo cadastro).
 */
async function ensureOmieRegistration(db: DB, kind: "client" | "band", id: string): Promise<void> {
  const table = kind === "client" ? "case_clients" : "case_bands";
  const { data: row } = await db.from(table).select("*").eq("id", id).single();
  if (!row || row.omie_codigo || !onlyDigits(row.cnpj_cpf)) return;
  const creds = await getCaseOmieCreds(db);
  if (!creds) return;
  const data: OmieSupplierData = {
    id: row.id,
    name: row.name,
    cnpj_cpf: row.cnpj_cpf,
    email: row.email,
    phone: row.phone,
    banco: kind === "band" ? row.banco : null,
    agencia: kind === "band" ? row.agencia : null,
    conta_corrente: kind === "band" ? row.conta_corrente : null,
    titular_banco: kind === "band" ? row.titular_banco : null,
    doc_titular: kind === "band" ? row.doc_titular : null,
    chave_pix: kind === "band" ? row.chave_pix : null,
  };
  try {
    const { codigoCliente } =
      kind === "client"
        ? await syncClienteToOmieUnit(creds.appKey, creds.appSecret, data)
        : await syncSupplierToOmieUnit(creds.appKey, creds.appSecret, data);
    await db
      .from(table)
      .update({ omie_codigo: codigoCliente, omie_synced_at: new Date().toISOString() })
      .eq("id", id);
  } catch (e) {
    console.error(`[case] falha ao cadastrar ${kind} no Omie na criação:`, e);
  }
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
  if (error || !data) {
    // Corrida no doc único → recupera o já inserido.
    if (doc && error?.code === "23505") {
      const { data: rows } = await db.from("case_clients").select("id, cnpj_cpf");
      const m = (rows ?? []).find((c: { id: string; cnpj_cpf: string | null }) => onlyDigits(c.cnpj_cpf) === doc);
      if (m) return m.id as string;
    }
    throw new Error(`Falha ao cadastrar cliente: ${error?.message ?? "?"}`);
  }
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
  if (error || !data) {
    if (doc && error?.code === "23505") {
      const { data: rows } = await db.from("case_bands").select("id, cnpj_cpf");
      const m = (rows ?? []).find((b: { id: string; cnpj_cpf: string | null }) => onlyDigits(b.cnpj_cpf) === doc);
      if (m) return m.id as string;
    }
    throw new Error(`Falha ao cadastrar banda: ${error?.message ?? "?"}`);
  }
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

  // ── Idempotência: cliques repetidos no mesmo form não duplicam o contrato ─
  const idemKey = input.idempotency_key?.trim() || null;
  if (idemKey) {
    const { data: existing } = await db
      .from("case_contracts")
      .select("id, contract_number, status, sign_url")
      .eq("idempotency_key", idemKey)
      .maybeSingle();
    if (existing) {
      return {
        ok: true,
        contractId: existing.id as string,
        contractNumber: existing.contract_number as number,
        status: existing.status as string,
        signUrl: (existing.sign_url as string | null) ?? undefined,
      };
    }
  }

  // ── Cadastros ──────────────────────────────────────────────────────────
  let clientId: string;
  let bandId: string;
  try {
    clientId = await resolveClient(db, input.client, ctx.id);
    bandId = await resolveBand(db, input.band, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar cliente/banda." };
  }

  // Regra Case: garante o cliente e o artista cadastrados no Omie já na criação.
  await ensureOmieRegistration(db, "client", clientId);
  await ensureOmieRegistration(db, "band", bandId);

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
      espec_area_interna: !!input.espec_area_interna,
      espec_area_externa: !!input.espec_area_externa,
      espec_palco: !!input.espec_palco,
      espec_trio: !!input.espec_trio,
      extra_transporte_cidade: !!input.extra_transporte_cidade,
      extra_translado_local: !!input.extra_translado_local,
      extra_diaria_alimentacao: !!input.extra_diaria_alimentacao,
      extra_hospedagem: !!input.extra_hospedagem,
      tipo_evento: input.tipo_evento ?? null,
      cortesias: input.cortesias ?? null,
      data_assinatura: input.data_assinatura ?? null,
      testemunha_1_nome: input.testemunha_1_nome ?? null,
      testemunha_1_cpf: input.testemunha_1_cpf ?? null,
      testemunha_2_nome: input.testemunha_2_nome ?? null,
      testemunha_2_cpf: input.testemunha_2_cpf ?? null,
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
      idempotency_key: idemKey,
      created_by: ctx.id,
    })
    .select("id, contract_number")
    .single();

  if (contractErr || !contract) {
    // Corrida: outra submissão idêntica inseriu primeiro (viola o índice único
    // de idempotência). Recupera e devolve o contrato existente, sem duplicar.
    if (idemKey && contractErr?.code === "23505") {
      const { data: existing } = await db
        .from("case_contracts")
        .select("id, contract_number, status, sign_url")
        .eq("idempotency_key", idemKey)
        .maybeSingle();
      if (existing) {
        return {
          ok: true,
          contractId: existing.id as string,
          contractNumber: existing.contract_number as number,
          status: existing.status as string,
          signUrl: (existing.sign_url as string | null) ?? undefined,
        };
      }
    }
    return { error: `Falha ao criar contrato: ${contractErr?.message ?? "?"}` };
  }

  // ── Títulos ────────────────────────────────────────────────────────────
  // Custódia (a pagar e a receber): 1 título por parcela.
  // Serviços: cada item (margem/rider/camarim/extras) vira título separado no
  // Omie, rateado pela MESMA agenda de parcelas (proporção por vencimento).
  const titleRows: Array<Record<string, unknown>> = [];

  const addSimpleLeg = (kind: CaseLegKind, parcelas: CaseParcelaInput[]) => {
    const total = parcelas.length;
    parcelas.forEach((p, idx) => {
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id,
        leg: kind,
        parcela_numero: n,
        parcela_total: total,
        vencimento: p.vencimento,
        valor: p.valor,
        codigo_integracao: `case-${contract.id}-${kind}-${n}`,
        status: "pendente",
      });
    });
  };

  if (cents(valorCustodia) > 0) {
    addSimpleLeg("pagar_custodia", input.parcelas_pagar_custodia ?? []);
    addSimpleLeg("receber_custodia", input.parcelas_receber_custodia ?? []);
  }

  // Serviços itemizados sobre a agenda única de parcelas a receber.
  const servicosParcelas = (input.parcelas_receber_servicos ?? []).filter(
    (p) => p.vencimento && cents(p.valor) > 0,
  );
  const servicosTotalCents = sumCents(servicosParcelas);
  const servicoItens: Array<{ item: string; valor: number }> = [
    { item: "margem", valor: valorMargem },
    { item: "rider", valor: valorRider },
    { item: "camarim", valor: valorCamarim },
    { item: "extras", valor: valorExtras },
  ];

  if (servicosTotalCents > 0) {
    for (const s of servicoItens) {
      const itemCents = cents(s.valor);
      if (itemCents <= 0) continue;
      // Rateia o valor do item pelas parcelas na mesma proporção; ajusta a
      // última para fechar exatamente o total do item (evita sobra de centavos).
      const valoresCents = servicosParcelas.map((p, idx) =>
        idx === servicosParcelas.length - 1
          ? 0
          : Math.round((itemCents * cents(p.valor)) / servicosTotalCents),
      );
      const somaMenosUltima = valoresCents.slice(0, -1).reduce((a, b) => a + b, 0);
      valoresCents[valoresCents.length - 1] = itemCents - somaMenosUltima;

      servicosParcelas.forEach((p, idx) => {
        const vc = valoresCents[idx];
        if (vc <= 0) return;
        const n = idx + 1;
        titleRows.push({
          contract_id: contract.id,
          leg: "receber_servicos",
          title_item: s.item,
          parcela_numero: n,
          parcela_total: servicosParcelas.length,
          vencimento: p.vencimento,
          valor: vc / 100,
          codigo_integracao: `case-${contract.id}-receber_servicos-${s.item}-${n}`,
          status: "pendente",
        });
      });
    }
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
        local: input.local_name,
        endereco: input.local_address,
        cidadeEstado: input.local_city,
        cep: input.local_cep,
      },
      especificacoes: {
        areaInterna: !!input.espec_area_interna,
        areaExterna: !!input.espec_area_externa,
        palco: !!input.espec_palco,
        trio: !!input.espec_trio,
      },
      extras: {
        transporteCidade: !!input.extra_transporte_cidade,
        transladoLocal: !!input.extra_translado_local,
        diariaAlimentacao: !!input.extra_diaria_alimentacao,
        hospedagem: !!input.extra_hospedagem,
      },
      tipoEvento: input.tipo_evento ?? null,
      valorTotal: valorAtracaoCliente + valorRider + valorCamarim + valorExtras,
      parcelas: parcelasCliente,
      cortesias: input.cortesias ?? null,
      dataAssinatura: input.data_assinatura ?? null,
      testemunha1: { nome: input.testemunha_1_nome ?? null, cpf: input.testemunha_1_cpf ?? null },
      testemunha2: { nome: input.testemunha_2_nome ?? null, cpf: input.testemunha_2_cpf ?? null },
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
