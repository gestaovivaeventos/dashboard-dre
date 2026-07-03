"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
import { buildContractPdf } from "@/lib/case/contract-pdf";
import { clicksignEnabled, createSignatureRequest } from "@/lib/case/clicksign";
import { launchContractToOmie } from "@/lib/case/actions/contract-launch";
import {
  resolveClient,
  resolveBand,
  ensureOmieRegistration,
} from "@/lib/case/resolve-cadastros";
import { cents, validarSchedule, prorateCents } from "@/lib/case/parcelas";
import type { CaseParcelaInput, Etapa1Input, Etapa2Input } from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

// ────────────────────────────────────────────────────────────────────────────
// ETAPA 1 — Produção do contrato com o cliente
// ────────────────────────────────────────────────────────────────────────────
export async function criarEtapa1(
  input: Etapa1Input,
): Promise<
  | { ok: true; contractId: string; contractNumber: number; status: string; signUrl?: string; warning?: string }
  | { error: string }
> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const valorAtracao = Number(input.valor_atracao_cliente) || 0;
  const valorRider = Number(input.valor_rider) || 0;
  const valorCamarim = Number(input.valor_camarim) || 0;
  const valorExtras = Number(input.valor_extras) || 0;
  const totalCliente = valorAtracao + valorRider + valorCamarim + valorExtras;

  if (!input.client?.name?.trim()) return { error: "Informe o cliente." };
  if (!input.band?.name?.trim()) return { error: "Informe a atração/artista." };
  if (valorAtracao <= 0) return { error: "Informe o valor da atração cobrado do cliente." };

  const scheduleErr = validarSchedule(input.receber_schedule ?? [], totalCliente, "recebimento do cliente");
  if (scheduleErr) return { error: scheduleErr };

  // Idempotência (mesmo mecanismo do fluxo antigo).
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

  let clientId: string;
  let bandId: string;
  try {
    clientId = await resolveClient(db, input.client, ctx.id);
    bandId = await resolveBand(db, input.band, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar cliente/atração." };
  }
  await ensureOmieRegistration(db, "client", clientId);
  await ensureOmieRegistration(db, "band", bandId);

  // valor_artista fica 0 (provisório) até a Etapa 2; os títulos NÃO são gerados aqui.
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
      valor_artista: 0,
      valor_atracao_cliente: valorAtracao,
      valor_rider: valorRider,
      valor_camarim: valorCamarim,
      valor_extras: valorExtras,
      valor_custodia: 0,
      valor_margem: valorAtracao,
      valor_servicos: totalCliente,
      receber_schedule: input.receber_schedule,
      observacao: input.observacao,
      status: "rascunho",
      idempotency_key: idemKey,
      created_by: ctx.id,
    })
    .select("id, contract_number")
    .single();

  if (contractErr || !contract) {
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

  await db.from("case_history").insert({
    contract_id: contract.id,
    user_id: ctx.id,
    action: "criado",
    comment: `Contrato #${contract.contract_number} criado (Etapa 1 — contrato do cliente).`,
  });

  // ── PDF do contrato de venda + envio para assinatura ───────────────────
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
      valorTotal: totalCliente,
      parcelas: input.receber_schedule,
      cortesias: input.cortesias ?? null,
      dataAssinatura: input.data_assinatura ?? null,
      testemunha1: { nome: input.testemunha_1_nome ?? null, cpf: input.testemunha_1_cpf ?? null },
      testemunha2: { nome: input.testemunha_2_nome ?? null, cpf: input.testemunha_2_cpf ?? null },
    });
  } catch (e) {
    console.error("[case] falha ao gerar PDF do contrato:", e);
    return { ok: true, contractId: contract.id as string, contractNumber: contract.contract_number as number, status: "rascunho" };
  }

  const salePath = `${ctx.id}/sale-${contract.id}.pdf`;
  await db.storage.from(ATTACHMENT_BUCKET).upload(salePath, salePdf, { contentType: "application/pdf", upsert: true });
  await db.from("case_contracts").update({ sale_contract_path: salePath }).eq("id", contract.id);

  const baseOk = {
    ok: true as const,
    contractId: contract.id as string,
    contractNumber: contract.contract_number as number,
  };

  if (!clicksignEnabled()) {
    return { ...baseOk, status: "rascunho", warning: "Contrato e PDF gerados, mas a assinatura ClickSign não está configurada." };
  }
  if (!input.client.email) {
    return { ...baseOk, status: "rascunho", warning: "Contrato e PDF gerados, mas o cliente não tem e-mail para envio da assinatura." };
  }

  try {
    const sig = await createSignatureRequest(
      salePdf,
      `Contrato-Case-${contract.contract_number}.pdf`,
      { name: input.client.name, email: input.client.email, cpf: input.client.cpf_resp_legal ?? input.client.cnpj_cpf },
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
    revalidatePath("/case/contratos");
    return { ...baseOk, status: "aguardando_assinatura", signUrl: sig.signUrl };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao enviar para assinatura.";
    await db.from("case_history").insert({ contract_id: contract.id, user_id: ctx.id, action: "erro", comment: msg });
    return { ...baseOk, status: "rascunho", warning: `Contrato salvo, mas houve erro no envio para assinatura: ${msg}` };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ETAPA 2 — Pagamento ao artista (gera todos os títulos e lança no Omie)
// ────────────────────────────────────────────────────────────────────────────
export async function concluirEtapa2(
  input: Etapa2Input,
): Promise<{ ok: true; status: string } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const { data: contract } = await db
    .from("case_contracts")
    .select("id, band_id, valor_atracao_cliente, valor_rider, valor_camarim, valor_extras, receber_schedule")
    .eq("id", input.contract_id)
    .single();
  if (!contract) return { error: "Contrato não encontrado." };

  const valorArtista = Number(input.valor_artista) || 0;
  const valorAtracao = Number(contract.valor_atracao_cliente) || 0;
  const valorRider = Number(contract.valor_rider) || 0;
  const valorCamarim = Number(contract.valor_camarim) || 0;
  const valorExtras = Number(contract.valor_extras) || 0;

  if (valorArtista <= 0) return { error: "Informe o valor pago ao artista." };
  if (cents(valorArtista) > cents(valorAtracao)) {
    return { error: "O valor pago ao artista não pode ser maior que o valor cobrado do cliente pela atração." };
  }

  const receberSchedule = (contract.receber_schedule as CaseParcelaInput[] | null) ?? [];
  if (receberSchedule.length === 0) {
    return { error: "Contrato sem cronograma de recebimento (Etapa 1 incompleta)." };
  }
  const pagarErr = validarSchedule(input.parcelas_pagar ?? [], valorArtista, "pagamento ao artista");
  if (pagarErr) return { error: pagarErr };

  const valorMargem = valorAtracao - valorArtista;
  const valorServicos = valorMargem + valorRider + valorCamarim + valorExtras;

  await db
    .from("case_contracts")
    .update({
      valor_artista: valorArtista,
      valor_custodia: valorArtista,
      valor_margem: valorMargem,
      valor_servicos: valorServicos,
      attachment_path: input.attachment_path ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  await ensureOmieRegistration(db, "band", contract.band_id as string);

  // Gera os títulos só se ainda não existirem (idempotente por contrato).
  const { data: existing } = await db.from("case_titles").select("id").eq("contract_id", contract.id).limit(1);
  if (!existing || existing.length === 0) {
    const titleRows: Array<Record<string, unknown>> = [];
    const total = (input.parcelas_pagar ?? []).length;
    (input.parcelas_pagar ?? []).forEach((p, idx) => {
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id,
        leg: "pagar_custodia",
        parcela_numero: n,
        parcela_total: total,
        vencimento: p.vencimento,
        valor: p.valor,
        codigo_integracao: `case-${contract.id}-pagar_custodia-${n}`,
        status: "pendente",
      });
    });

    const custCents = prorateCents(cents(valorArtista), receberSchedule);
    receberSchedule.forEach((p, idx) => {
      const vc = custCents[idx];
      if (vc <= 0) return;
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id,
        leg: "receber_custodia",
        parcela_numero: n,
        parcela_total: receberSchedule.length,
        vencimento: p.vencimento,
        valor: vc / 100,
        codigo_integracao: `case-${contract.id}-receber_custodia-${n}`,
        status: "pendente",
      });
    });

    const servicoItens = [
      { item: "margem", valor: valorMargem },
      { item: "rider", valor: valorRider },
      { item: "camarim", valor: valorCamarim },
      { item: "extras", valor: valorExtras },
    ];
    for (const s of servicoItens) {
      const itemCents = cents(s.valor);
      if (itemCents <= 0) continue;
      const vals = prorateCents(itemCents, receberSchedule);
      receberSchedule.forEach((p, idx) => {
        const vc = vals[idx];
        if (vc <= 0) return;
        const n = idx + 1;
        titleRows.push({
          contract_id: contract.id,
          leg: "receber_servicos",
          title_item: s.item,
          parcela_numero: n,
          parcela_total: receberSchedule.length,
          vencimento: p.vencimento,
          valor: vc / 100,
          codigo_integracao: `case-${contract.id}-receber_servicos-${s.item}-${n}`,
          status: "pendente",
        });
      });
    }

    const { error: titlesErr } = await db.from("case_titles").insert(titleRows);
    if (titlesErr) return { error: `Falha ao gerar os títulos: ${titlesErr.message}` };
  }

  await db.from("case_history").insert({
    contract_id: contract.id,
    user_id: ctx.id,
    action: "etapa2",
    comment: `Etapa 2 concluída — pagamento ao artista (R$ ${valorArtista.toFixed(2)}). Lançando no Omie.`,
  });

  const res = await launchContractToOmie(db, contract.id as string);
  revalidatePath("/case/contratos");
  revalidatePath(`/case/contratos/${contract.id}`);
  if ("error" in res) return { error: res.error };
  return { ok: true, status: res.status };
}
