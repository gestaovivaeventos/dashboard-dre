"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
import { CONTRATADO_SIGNER } from "@/lib/case/contract-config";
import { buildContractPdf, type ContractPdfData } from "@/lib/case/contract-pdf";
import { clicksignEnabled, createSignatureRequest, type ClickSignSigner } from "@/lib/case/clicksign";
import { launchContractToOmie } from "@/lib/case/actions/contract-launch";
import { resolveClient, resolveBand, ensureOmieRegistration } from "@/lib/case/resolve-cadastros";
import { cents, validarSchedule, prorateCents } from "@/lib/case/parcelas";
import type { CaseParcelaInput, Etapa1Input, Etapa2Input } from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

/** Campos do contrato vindos da aba Cliente (compartilhado por insert/update). */
function clienteFields(input: Etapa1Input, valorArtista: number) {
  const valorAtracao = Number(input.valor_atracao_cliente) || 0;
  const valorRider = Number(input.valor_rider) || 0;
  const valorCamarim = Number(input.valor_camarim) || 0;
  const valorExtras = Number(input.valor_extras) || 0;
  const margem = valorAtracao - valorArtista;
  return {
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
    testemunha_1_email: input.testemunha_1_email ?? null,
    testemunha_2_nome: input.testemunha_2_nome ?? null,
    testemunha_2_cpf: input.testemunha_2_cpf ?? null,
    valor_atracao_cliente: valorAtracao,
    valor_rider: valorRider,
    valor_camarim: valorCamarim,
    valor_extras: valorExtras,
    valor_margem: margem,
    valor_servicos: margem + valorRider + valorCamarim + valorExtras,
    receber_schedule: (input.receber_schedule ?? []).filter((p) => p.vencimento && Number(p.valor) > 0),
    observacao: input.observacao,
    updated_at: new Date().toISOString(),
  };
}

// ────────────────────────────────────────────────────────────────────────────
// ABA CLIENTE — salvar (rascunho, sem gerar/enviar contrato)
// ────────────────────────────────────────────────────────────────────────────
export async function salvarCliente(
  input: Etapa1Input,
): Promise<{ ok: true; contractId: string; contractNumber: number; status: string } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (!input.client?.name?.trim()) return { error: "Informe o cliente." };
  if ((Number(input.valor_atracao_cliente) || 0) <= 0) return { error: "Informe o valor da atração cobrado do cliente." };

  let clientId: string;
  let bandId: string | null = null;
  try {
    clientId = await resolveClient(db, input.client, ctx.id);
    // A atração é opcional aqui (fica na aba Atração); resolve só se informada.
    if (input.band?.name?.trim()) {
      bandId = await resolveBand(db, input.band, ctx.id);
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar cliente/atração." };
  }
  await ensureOmieRegistration(db, "client", clientId);
  if (bandId) await ensureOmieRegistration(db, "band", bandId);

  if (input.contract_id) {
    // Edição — preserva o valor do artista já informado na aba Atração.
    const { data: cur } = await db.from("case_contracts").select("valor_artista").eq("id", input.contract_id).single();
    const valorArtista = Number(cur?.valor_artista) || 0;
    const { error } = await db
      .from("case_contracts")
      .update({ client_id: clientId, ...(bandId ? { band_id: bandId } : {}), ...clienteFields(input, valorArtista) })
      .eq("id", input.contract_id);
    if (error) return { error: `Falha ao salvar: ${error.message}` };
    const { data: c } = await db.from("case_contracts").select("contract_number, status").eq("id", input.contract_id).single();
    revalidatePath(`/case/contratos/${input.contract_id}`);
    return { ok: true, contractId: input.contract_id, contractNumber: Number(c?.contract_number), status: String(c?.status) };
  }

  const { data: contract, error } = await db
    .from("case_contracts")
    .insert({
      company_id: CASE_COMPANY_ID,
      client_id: clientId,
      band_id: bandId,
      valor_artista: 0,
      valor_custodia: 0,
      status: "rascunho",
      created_by: ctx.id,
      ...clienteFields(input, 0),
    })
    .select("id, contract_number")
    .single();
  if (error || !contract) return { error: `Falha ao criar contrato: ${error?.message ?? "?"}` };

  await db.from("case_history").insert({
    contract_id: contract.id,
    user_id: ctx.id,
    action: "criado",
    comment: `Contrato #${contract.contract_number} salvo (rascunho — aba Cliente).`,
  });
  revalidatePath("/case/contratos");
  return { ok: true, contractId: contract.id as string, contractNumber: contract.contract_number as number, status: "rascunho" };
}

// ────────────────────────────────────────────────────────────────────────────
// ABA CLIENTE — gerar PDF e enviar para assinatura (cliente + contratado + testemunha)
// ────────────────────────────────────────────────────────────────────────────
export async function gerarEnviarContrato(
  contractId: string,
): Promise<{ ok: true; status: string; signUrl?: string; warning?: string } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const { data: c } = await db
    .from("case_contracts")
    .select("*, case_clients(name, cnpj_cpf, email, resp_legal, cpf_resp_legal, endereco, cidade_estado, cep), case_bands(name)")
    .eq("id", contractId)
    .single();
  if (!c) return { error: "Contrato não encontrado." };
  if (!c.band_id) return { error: "Selecione a atração/artista na aba Contrato Atração antes de gerar o contrato." };

  const client = c.case_clients;
  const pdfData: ContractPdfData = {
    contractNumber: c.contract_number,
    cliente: {
      fundo: client?.name ?? "",
      cnpj: client?.cnpj_cpf ?? null,
      respLegal: client?.resp_legal ?? null,
      cpfResp: client?.cpf_resp_legal ?? null,
      endereco: client?.endereco ?? null,
      cidadeEstado: client?.cidade_estado ?? null,
      cep: client?.cep ?? null,
    },
    objeto: {
      artista: c.case_bands?.name ?? "",
      dataEvento: c.event_date,
      horario: c.show_time,
      passagemSom: c.passagem_som,
      local: c.local_name,
      endereco: c.local_address,
      cidadeEstado: c.local_city,
      cep: c.local_cep,
    },
    especificacoes: {
      areaInterna: !!c.espec_area_interna,
      areaExterna: !!c.espec_area_externa,
      palco: !!c.espec_palco,
      trio: !!c.espec_trio,
    },
    extras: {
      transporteCidade: !!c.extra_transporte_cidade,
      transladoLocal: !!c.extra_translado_local,
      diariaAlimentacao: !!c.extra_diaria_alimentacao,
      hospedagem: !!c.extra_hospedagem,
    },
    tipoEvento: c.tipo_evento ?? null,
    valorTotal: Number(c.valor_atracao_cliente) + Number(c.valor_rider) + Number(c.valor_camarim) + Number(c.valor_extras),
    parcelas: Array.isArray(c.receber_schedule) ? c.receber_schedule : [],
    cortesias: c.cortesias ?? null,
    dataAssinatura: c.data_assinatura ?? null,
    testemunha1: { nome: c.testemunha_1_nome ?? null, cpf: c.testemunha_1_cpf ?? null },
    testemunha2: { nome: c.testemunha_2_nome ?? null, cpf: c.testemunha_2_cpf ?? null },
  };

  let salePdf: Buffer;
  try {
    salePdf = await buildContractPdf(pdfData);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao gerar o PDF do contrato." };
  }

  const salePath = `${ctx.id}/sale-${contractId}.pdf`;
  await db.storage.from(ATTACHMENT_BUCKET).upload(salePath, salePdf, { contentType: "application/pdf", upsert: true });
  await db.from("case_contracts").update({ sale_contract_path: salePath }).eq("id", contractId);

  if (!clicksignEnabled()) {
    return { ok: true, status: c.status as string, warning: "PDF gerado, mas a assinatura ClickSign não está configurada." };
  }
  if (!client?.email) {
    return { ok: true, status: c.status as string, warning: "PDF gerado, mas o cliente não tem e-mail para envio da assinatura." };
  }

  // Signatários: cliente + contratado (CS Agência) + testemunha 1 (se e-mail).
  const signers: ClickSignSigner[] = [
    { name: client.name, email: client.email, cpf: client.cpf_resp_legal ?? client.cnpj_cpf, signAs: "contractor" },
    { name: CONTRATADO_SIGNER.name, email: CONTRATADO_SIGNER.email, cpf: CONTRATADO_SIGNER.cpf, signAs: "contractor" },
  ];
  if (c.testemunha_1_email?.trim()) {
    signers.push({ name: c.testemunha_1_nome ?? "Testemunha", email: c.testemunha_1_email, cpf: c.testemunha_1_cpf ?? null, signAs: "witness" });
  }

  try {
    const sig = await createSignatureRequest(
      salePdf,
      `Contrato-Case-${c.contract_number}.pdf`,
      signers,
      `Contrato de prestação de serviços artísticos — ${c.case_bands?.name ?? ""}. Por favor, assine.`,
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
      .eq("id", contractId);
    await db.from("case_history").insert({
      contract_id: contractId,
      user_id: ctx.id,
      action: "enviado_assinatura",
      comment: `Enviado para assinatura de ${signers.length} signatário(s).`,
    });
    revalidatePath(`/case/contratos/${contractId}`);
    return { ok: true, status: "aguardando_assinatura", signUrl: sig.signUrl };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao enviar para assinatura." };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// ABA ATRAÇÃO — salvar (guarda anexo/valor/parcelas; gera títulos PENDENTES; sem lançar)
// ────────────────────────────────────────────────────────────────────────────
export async function salvarAtracao(input: Etapa2Input): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (!input.band?.name?.trim()) return { error: "Informe a atração/artista." };

  const { data: contract } = await db
    .from("case_contracts")
    .select("id, valor_atracao_cliente, valor_rider, valor_camarim, valor_extras, receber_schedule")
    .eq("id", input.contract_id)
    .single();
  if (!contract) return { error: "Contrato não encontrado." };

  // Não permite reeditar se algum título já foi lançado no Omie.
  const { data: existing } = await db.from("case_titles").select("id, status").eq("contract_id", contract.id);
  if ((existing ?? []).some((t: { status: string }) => t.status === "lancado")) {
    return { error: "Já existem títulos lançados no Omie — não é possível reeditar a atração. Use 'Reenviar ao Omie' no Financeiro." };
  }

  // Resolve/atualiza a atração e vincula ao contrato.
  let bandId: string;
  try {
    bandId = await resolveBand(db, input.band, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar a atração." };
  }
  await ensureOmieRegistration(db, "band", bandId);

  const valorArtista = Number(input.valor_artista) || 0;
  const valorAtracao = Number(contract.valor_atracao_cliente) || 0;
  const valorRider = Number(contract.valor_rider) || 0;
  const valorCamarim = Number(contract.valor_camarim) || 0;
  const valorExtras = Number(contract.valor_extras) || 0;

  // Sem valor do artista: guarda só a identidade + anexo (títulos ficam para depois).
  if (valorArtista <= 0) {
    await db
      .from("case_contracts")
      .update({ band_id: bandId, attachment_path: input.attachment_path ?? undefined, updated_at: new Date().toISOString() })
      .eq("id", contract.id);
    revalidatePath(`/case/contratos/${contract.id}`);
    return { ok: true };
  }

  if (cents(valorArtista) > cents(valorAtracao)) {
    return { error: "O valor pago ao artista não pode ser maior que o valor cobrado do cliente pela atração." };
  }
  const receberSchedule = (contract.receber_schedule as CaseParcelaInput[] | null) ?? [];
  if (receberSchedule.length === 0) return { error: "Complete o Contrato Cliente (parcelas a receber) antes de gerar os títulos da atração." };
  const totalCliente = valorAtracao + valorRider + valorCamarim + valorExtras;
  const schedErr = validarSchedule(receberSchedule, totalCliente, "recebimento do cliente");
  if (schedErr) return { error: schedErr };
  const pagarErr = validarSchedule(input.parcelas_pagar ?? [], valorArtista, "pagamento ao artista");
  if (pagarErr) return { error: pagarErr };

  const valorMargem = valorAtracao - valorArtista;
  const valorServicos = valorMargem + valorRider + valorCamarim + valorExtras;

  await db
    .from("case_contracts")
    .update({
      band_id: bandId,
      valor_artista: valorArtista,
      valor_custodia: valorArtista,
      valor_margem: valorMargem,
      valor_servicos: valorServicos,
      attachment_path: input.attachment_path ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  // Regenera os títulos como PENDENTES (limpa os antigos, todos pendentes).
  await db.from("case_titles").delete().eq("contract_id", contract.id);
  const titleRows: Array<Record<string, unknown>> = [];
  const totalPagar = (input.parcelas_pagar ?? []).length;
  (input.parcelas_pagar ?? []).forEach((p, idx) => {
    const n = idx + 1;
    titleRows.push({
      contract_id: contract.id, leg: "pagar_custodia", parcela_numero: n, parcela_total: totalPagar,
      vencimento: p.vencimento, valor: p.valor, codigo_integracao: `case-${contract.id}-pagar_custodia-${n}`, status: "pendente",
    });
  });
  const custCents = prorateCents(cents(valorArtista), receberSchedule);
  receberSchedule.forEach((p, idx) => {
    const vc = custCents[idx];
    if (vc <= 0) return;
    const n = idx + 1;
    titleRows.push({
      contract_id: contract.id, leg: "receber_custodia", parcela_numero: n, parcela_total: receberSchedule.length,
      vencimento: p.vencimento, valor: vc / 100, codigo_integracao: `case-${contract.id}-receber_custodia-${n}`, status: "pendente",
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
        contract_id: contract.id, leg: "receber_servicos", title_item: s.item, parcela_numero: n, parcela_total: receberSchedule.length,
        vencimento: p.vencimento, valor: vc / 100, codigo_integracao: `case-${contract.id}-receber_servicos-${s.item}-${n}`, status: "pendente",
      });
    });
  }
  if (titleRows.length > 0) {
    const { error } = await db.from("case_titles").insert(titleRows);
    if (error) return { error: `Falha ao gerar os títulos: ${error.message}` };
  }

  await db.from("case_history").insert({
    contract_id: contract.id, user_id: ctx.id, action: "etapa2",
    comment: `Atração salva — pagamento ao artista R$ ${valorArtista.toFixed(2)} (títulos pendentes).`,
  });
  revalidatePath(`/case/contratos/${contract.id}`);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// FINANCEIRO — lançar no Omie (gate: atração validada + assinado por todos)
// ────────────────────────────────────────────────────────────────────────────
export async function lancarNoOmie(contractId: string): Promise<{ ok: true; status: string } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();

  const { data: c } = await db
    .from("case_contracts")
    .select("id, valor_artista, signed_at")
    .eq("id", contractId)
    .single();
  if (!c) return { error: "Contrato não encontrado." };
  if (Number(c.valor_artista) <= 0) return { error: "Conclua a aba Contrato Atração antes de lançar." };
  if (!c.signed_at) return { error: "O contrato precisa estar assinado por todos (cliente, contratado e testemunha) antes de lançar no Omie." };

  const res = await launchContractToOmie(db, contractId);
  revalidatePath(`/case/contratos/${contractId}`);
  revalidatePath("/case/contratos");
  if ("error" in res) return { error: res.error };
  return { ok: true, status: res.status };
}
