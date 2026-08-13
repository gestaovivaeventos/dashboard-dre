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
import { resolveClient, resolveBand, ensureOmieRegistration, requireBankableIfNew, pushBandToOmie } from "@/lib/case/resolve-cadastros";
import { loadContractForAtracao, recomputeContractTitles, type ContractForAtracao } from "@/lib/case/titles";
import { validarSchedule } from "@/lib/case/parcelas";
import type { CaseBandInput, CaseClientInput, Etapa1Input, Etapa2Input, FornecedorInput } from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

/** Campos do contrato vindos da aba Cliente (compartilhado por insert/update). */
function clienteFields(input: Etapa1Input, valorArtista: number, verbaRiderCamarim = 0) {
  const valorAtracao = Number(input.valor_atracao_cliente) || 0;
  const valorRider = Number(input.valor_rider) || 0;
  const valorCamarim = Number(input.valor_camarim) || 0;
  const valorExtras = Number(input.valor_extras) || 0;
  const margem = valorAtracao - valorArtista - verbaRiderCamarim;
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
    extra_outros: input.extra_outros?.trim() || null,
    rider_tecnico: !!input.rider_tecnico,
    rider_camarim: !!input.rider_camarim,
    rider_pre_producao: !!input.rider_pre_producao,
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
  // Cliente novo (sem id) precisa de responsável legal + CPF: no Omie ele entra
  // como PF do responsável, com o fundo/razão social no nome fantasia.
  if (!input.client.id) {
    const onlyDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
    if (!input.client.resp_legal?.trim()) return { error: "Informe o responsável legal (nome completo) do cliente." };
    if (onlyDigits(input.client.cpf_resp_legal).length !== 11) return { error: "Informe o CPF do responsável legal (11 dígitos) do cliente." };
  }

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
  if (bandId) {
    const bankErr = await requireBankableIfNew(db, bandId, "atração");
    if (bankErr) return { error: bankErr };
  }
  await ensureOmieRegistration(db, "client", clientId);
  if (bandId) await ensureOmieRegistration(db, "band", bandId);

  if (input.contract_id) {
    // Edição — preserva o valor do artista e a verba já informados na aba Atração.
    const { data: cur } = await db
      .from("case_contracts")
      .select("valor_artista, valor_rider_camarim, signed_at")
      .eq("id", input.contract_id)
      .single();
    if (!cur) return { error: "Contrato não encontrado." };
    if (cur.signed_at) return { error: "O contrato já foi assinado — não é possível editar os dados." };
    const { data: lancados } = await db
      .from("case_titles")
      .select("id")
      .eq("contract_id", input.contract_id)
      .eq("status", "lancado")
      .limit(1);
    if ((lancados ?? []).length > 0) {
      return { error: "Já existem títulos lançados no Omie — não é possível editar os dados do contrato." };
    }
    const valorArtista = Number(cur.valor_artista) || 0;
    const verba = Number(cur.valor_rider_camarim) || 0;
    const { error } = await db
      .from("case_contracts")
      .update({ client_id: clientId, ...(bandId ? { band_id: bandId } : {}), ...clienteFields(input, valorArtista, verba) })
      .eq("id", input.contract_id);
    if (error) return { error: `Falha ao salvar: ${error.message}` };

    // Valores/parcelas do cliente mudaram → regenera os títulos (BV, custódia e
    // cronograma a receber) com base nas atrações/fornecedores atuais.
    const loaded = await loadContractForAtracao(db, input.contract_id);
    if (loaded.ok) {
      const rec = await recomputeContractTitles(db, loaded.contract);
      if ("error" in rec) return { error: rec.error };
    }

    await db.from("case_history").insert({
      contract_id: input.contract_id,
      user_id: ctx.id,
      action: "criado",
      comment: "Dados do contrato (aba Cliente) editados.",
    });
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

  // Gera os títulos a receber já na criação — contrato criado só pela aba
  // Cliente e assinado direto (sem passar pela aba Atração) ficava sem
  // nenhum título e o lançamento pós-assinatura virava status erro.
  {
    const loaded = await loadContractForAtracao(db, contract.id as string);
    if (loaded.ok) {
      const rec = await recomputeContractTitles(db, loaded.contract);
      // Não desfaz a criação: o contrato já existe; os títulos se regeneram em
      // qualquer salvamento posterior e no próprio lançamento (self-healing).
      if ("error" in rec) console.error("[case] falha ao gerar títulos na criação:", rec.error);
    }
  }

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

  // A assinatura dispara o lançamento automático no Omie — garante os títulos
  // ANTES de enviar. Sem parcela do cliente não há o que lançar: bloqueia aqui,
  // com contexto, em vez de deixar o contrato assinado cair em "erro".
  {
    const loaded = await loadContractForAtracao(db, contractId);
    if (loaded.ok) {
      const rec = await recomputeContractTitles(db, loaded.contract);
      if ("error" in rec) return { error: rec.error };
    }
    const { data: receberTitles } = await db
      .from("case_titles")
      .select("id")
      .eq("contract_id", contractId)
      .neq("leg", "pagar_custodia")
      .limit(1);
    if ((receberTitles ?? []).length === 0) {
      return {
        error:
          "O contrato está sem as parcelas de recebimento do cliente — confira o cronograma na aba Cliente antes de enviar para assinatura.",
      };
    }
  }

  // Atração é opcional aqui: sem atrações o PDF usa o nome do evento/atração
  // informado na aba Cliente; artistas podem ser vinculados depois (aba Atração).
  const { data: atrs } = await db
    .from("case_contract_atracoes")
    .select("case_bands(name)")
    .eq("contract_id", contractId)
    .order("created_at");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const artistaNomes = ((atrs ?? []) as any[]).map((a) => a.case_bands?.name).filter(Boolean).join(", ");

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
      artista: artistaNomes || c.case_bands?.name || c.event_name || "",
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
      outros: c.extra_outros ?? null,
    },
    rider: {
      tecnico: !!c.rider_tecnico,
      camarim: !!c.rider_camarim,
      preProducao: !!c.rider_pre_producao,
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
  // Quem assina pelo cliente é o responsável legal (pessoa física) — o nome do
  // cliente costuma ser o fundo/razão social e a ClickSign rejeita ("nome e sobrenome").
  // Assinatura em ordem: o contratado (CS Agência) assina PRIMEIRO (grupo 1);
  // só depois o ClickSign libera cliente + testemunha juntos (grupo 2).
  const clienteSigner = client.resp_legal?.trim() || client.name;
  const signers: ClickSignSigner[] = [
    { name: clienteSigner, email: client.email, cpf: client.cpf_resp_legal ?? client.cnpj_cpf, signAs: "contractor", group: 2 },
    { name: CONTRATADO_SIGNER.name, email: CONTRATADO_SIGNER.email, cpf: CONTRATADO_SIGNER.cpf, signAs: "contractor", group: 1 },
  ];
  if (c.testemunha_1_email?.trim()) {
    signers.push({ name: c.testemunha_1_nome ?? "Testemunha", email: c.testemunha_1_email, cpf: c.testemunha_1_cpf ?? null, signAs: "witness", group: 2 });
  }

  // ClickSign exige nome E sobrenome de pessoa (sem números/símbolos) — valida
  // antes de enviar para dar erro claro em português.
  const nomeInvalido = (n: string | null | undefined) => {
    const nome = (n ?? "").trim();
    return nome.split(/\s+/).length < 2 || /[\d()\[\]\/\\@#$%&*]/.test(nome);
  };
  const invalidos = signers.filter((s) => nomeInvalido(s.name)).map((s) => s.name);
  if (invalidos.length > 0) {
    return {
      error: `A assinatura exige nome e sobrenome de pessoa física (sem números ou siglas). Corrija: ${invalidos.join(", ")} — em "Editar dados", preencha o campo Responsável legal do cliente com o nome completo de quem assina.`,
    };
  }

  try {
    const sig = await createSignatureRequest(
      salePdf,
      `Contrato-Case-${c.contract_number}.pdf`,
      signers,
      `Contrato de prestação de serviços artísticos — ${artistaNomes || c.case_bands?.name || c.event_name || `nº ${c.contract_number}`}. Por favor, assine.`,
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
// ABA ATRAÇÃO — múltiplas atrações por contrato. Cada atração tem seu anexo,
// valor e parcelas próprias; os títulos a pagar somam todas as atrações.
// ────────────────────────────────────────────────────────────────────────────

/** Uma atração/fornecedor específico já tem título lançado no Omie? */
async function entityLancado(
  db: DB,
  contractId: string,
  col: "atracao_id" | "fornecedor_id",
  entityId: string,
): Promise<boolean> {
  const { data } = await db
    .from("case_titles")
    .select("id")
    .eq("contract_id", contractId)
    .eq(col, entityId)
    .eq("status", "lancado")
    .limit(1);
  return (data ?? []).length > 0;
}

/**
 * Despesas lançam automaticamente no Omie assim que salvas, SE o contrato já
 * estiver assinado. Erro no lançamento não desfaz o salvamento — vira warning.
 */
async function autoLaunchDespesas(db: DB, contract: ContractForAtracao): Promise<string | undefined> {
  if (!contract.signed_at) return undefined;
  const res = await launchContractToOmie(db, contract.id, ["pagar_custodia"]);
  if ("error" in res) return `Salvo, mas o lançamento automático no Omie falhou: ${res.error}`;
  return undefined;
}

/** Cria (sem atracao_id) ou edita (com atracao_id) uma atração do contrato. */
export async function salvarAtracao(input: Etapa2Input): Promise<{ ok: true; warning?: string } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (!input.band?.name?.trim()) return { error: "Informe a atração/artista." };

  const loaded = await loadContractForAtracao(db, input.contract_id);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

  if (input.atracao_id && (await entityLancado(db, contract.id, "atracao_id", input.atracao_id))) {
    return { error: "Esta atração já tem títulos lançados no Omie — não é possível reeditar. Ajustes precisam ser feitos direto no Omie." };
  }

  let bandId: string;
  try {
    bandId = await resolveBand(db, input.band, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar a atração." };
  }
  const bankErr = await requireBankableIfNew(db, bandId, "atração");
  if (bankErr) return { error: bankErr };
  await ensureOmieRegistration(db, "band", bandId);

  const valorArtista = Number(input.valor_artista) || 0;
  const parcelas = (input.parcelas_pagar ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);

  // Com valor, as parcelas precisam fechar; sem valor, salva só identidade+anexo.
  if (valorArtista > 0) {
    const pagarErr = validarSchedule(parcelas, valorArtista, "pagamento ao artista");
    if (pagarErr) return { error: pagarErr };
  }

  const row = {
    contract_id: contract.id,
    band_id: bandId,
    attachment_path: input.attachment_path ?? null,
    valor_artista: valorArtista,
    pagar_schedule: valorArtista > 0 ? parcelas : null,
    updated_at: new Date().toISOString(),
  };

  if (input.atracao_id) {
    const { error } = await db.from("case_contract_atracoes").update(row).eq("id", input.atracao_id).eq("contract_id", contract.id);
    if (error) return { error: `Falha ao salvar a atração: ${error.message}` };
  } else {
    const { error } = await db.from("case_contract_atracoes").insert({ ...row, created_by: ctx.id });
    if (error) return { error: `Falha ao adicionar a atração: ${error.message}` };
  }

  const rec = await recomputeContractTitles(db, contract);
  if ("error" in rec) return { error: rec.error };

  await db.from("case_history").insert({
    contract_id: contract.id, user_id: ctx.id, action: "etapa2",
    comment: `Atração ${input.band.name} salva — R$ ${valorArtista.toFixed(2)} (total às atrações: R$ ${rec.totalArtista.toFixed(2)}).`,
  });

  // Contrato assinado → despesa lança imediatamente no Omie (custódia).
  const warning = await autoLaunchDespesas(db, contract);
  revalidatePath(`/case/contratos/${contract.id}`);
  return { ok: true, warning };
}

/** Remove uma atração do contrato e regenera os títulos (bloqueado se ELA já lançou). */
export async function removerAtracao(contractId: string, atracaoId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const loaded = await loadContractForAtracao(db, contractId);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

  if (await entityLancado(db, contractId, "atracao_id", atracaoId)) {
    return { error: "Esta atração já tem títulos lançados no Omie — não é possível remover. Cancele os lançamentos direto no Omie antes." };
  }

  const { data: atr } = await db
    .from("case_contract_atracoes")
    .select("id, case_bands(name)")
    .eq("id", atracaoId)
    .eq("contract_id", contractId)
    .maybeSingle();
  if (!atr) return { error: "Atração não encontrada neste contrato." };

  const { error } = await db.from("case_contract_atracoes").delete().eq("id", atracaoId);
  if (error) return { error: `Falha ao remover: ${error.message}` };

  const rec = await recomputeContractTitles(db, contract);
  if ("error" in rec) return { error: rec.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bandName = (atr as any).case_bands?.name ?? "atração";
  await db.from("case_history").insert({
    contract_id: contractId, user_id: ctx.id, action: "etapa2",
    comment: `Atração ${bandName} removida (total às atrações: R$ ${rec.totalArtista.toFixed(2)}).`,
  });
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true };
}

/**
 * Atualiza o cadastro de uma banda/fornecedor (case_bands) e reenvia ao Omie —
 * funciona a qualquer momento (mesmo após lançamento). Corrige dados bancários,
 * PIX etc. sem mexer nos títulos já lançados.
 */
export async function salvarCadastroBanda(
  contractId: string,
  bandId: string,
  input: CaseBandInput,
): Promise<{ ok: true; warning?: string } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();
  if (!bandId) return { error: "Cadastro não identificado." };
  if (!input.name?.trim()) return { error: "Informe o nome do fornecedor/atração." };

  try {
    await resolveBand(db, { ...input, id: bandId }, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao salvar o cadastro." };
  }
  const omieErr = await pushBandToOmie(db, bandId);
  await db.from("case_history").insert({
    contract_id: contractId, user_id: ctx.id, action: "etapa2",
    comment: `Cadastro de ${input.name} atualizado${omieErr ? " (envio ao Omie falhou)" : " e reenviado ao Omie"}.`,
  });
  revalidatePath(`/case/contratos/${contractId}`);
  return omieErr ? { ok: true, warning: `Cadastro salvo, mas o envio ao Omie falhou: ${omieErr}` } : { ok: true };
}

/** Reenvia o cadastro da banda ao Omie sem alterar dados (retry de falha). */
export async function reenviarBandaOmie(contractId: string, bandId: string): Promise<{ ok: true } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();
  const err = await pushBandToOmie(db, bandId);
  if (err) return { error: err };
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true };
}

/**
 * Atualiza SÓ o cadastro do cliente (não os dados do contrato) — permitido
 * mesmo com contrato assinado. Uso típico: completar o CNPJ/CPF que o Omie
 * exige. Registra/atualiza no Omie em seguida (best-effort).
 */
export async function salvarCadastroCliente(
  contractId: string,
  input: CaseClientInput,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (!input.id) return { error: "Cliente não identificado." };
  if (!input.name?.trim()) return { error: "Informe o nome do cliente." };

  try {
    await resolveClient(db, input, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao atualizar o cadastro do cliente." };
  }
  await ensureOmieRegistration(db, "client", input.id);

  await db.from("case_history").insert({
    contract_id: contractId,
    user_id: ctx.id,
    action: "criado",
    comment: "Cadastro do cliente atualizado (dados cadastrais/CNPJ).",
  });
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// VERBA RIDER/CAMARIM — reserva paga a fornecedores; saldo pode virar BV.
// ────────────────────────────────────────────────────────────────────────────

/** Define o valor da verba Rider/Camarim do contrato e regenera os títulos. */
export async function salvarVerbaRiderCamarim(
  contractId: string,
  valor: number,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const loaded = await loadContractForAtracao(db, contractId);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

  const verba = Number(valor) || 0;
  if (verba < 0) return { error: "A verba não pode ser negativa." };

  const { error } = await db
    .from("case_contracts")
    .update({ valor_rider_camarim: verba, updated_at: new Date().toISOString() })
    .eq("id", contractId);
  if (error) return { error: `Falha ao salvar a verba: ${error.message}` };

  const rec = await recomputeContractTitles(db, { ...contract, valor_rider_camarim: verba });
  if ("error" in rec) return { error: rec.error };

  await db.from("case_history").insert({
    contract_id: contractId, user_id: ctx.id, action: "etapa2",
    comment: `Verba Rider/Camarim definida em R$ ${verba.toFixed(2)}.`,
  });
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true };
}

/** Cria (sem fornecedor_id) ou edita (com fornecedor_id) um fornecedor/comissão. */
export async function salvarFornecedor(input: FornecedorInput): Promise<{ ok: true; warning?: string } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (!input.band?.name?.trim()) return { error: "Informe o fornecedor." };

  const loaded = await loadContractForAtracao(db, input.contract_id);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

  if (input.fornecedor_id && (await entityLancado(db, contract.id, "fornecedor_id", input.fornecedor_id))) {
    return { error: "Este fornecedor já tem títulos lançados no Omie — não é possível reeditar. Ajustes precisam ser feitos direto no Omie." };
  }

  const valor = Number(input.valor) || 0;
  if (valor <= 0) return { error: "Informe o valor pago ao fornecedor." };
  const parcelas = (input.parcelas_pagar ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);
  const pagarErr = validarSchedule(parcelas, valor, "pagamento ao fornecedor");
  if (pagarErr) return { error: pagarErr };

  let bandId: string;
  try {
    bandId = await resolveBand(db, input.band, ctx.id, "fornecedor");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar o fornecedor." };
  }
  const bankErr = await requireBankableIfNew(db, bandId, "fornecedor");
  if (bankErr) return { error: bankErr };
  await ensureOmieRegistration(db, "band", bandId);

  const row = {
    contract_id: contract.id,
    tipo: input.tipo ?? "rider_camarim",
    band_id: bandId,
    descricao: input.descricao?.trim() || null,
    attachment_path: input.attachment_path ?? null,
    valor,
    pagar_schedule: parcelas,
    updated_at: new Date().toISOString(),
  };

  if (input.fornecedor_id) {
    const { error } = await db.from("case_contract_fornecedores").update(row).eq("id", input.fornecedor_id).eq("contract_id", contract.id);
    if (error) return { error: `Falha ao salvar o fornecedor: ${error.message}` };
  } else {
    const { error } = await db.from("case_contract_fornecedores").insert({ ...row, created_by: ctx.id });
    if (error) return { error: `Falha ao adicionar o fornecedor: ${error.message}` };
  }

  const rec = await recomputeContractTitles(db, contract);
  if ("error" in rec) return { error: rec.error };

  const tipoLabel =
    input.tipo === "comissao_externa" ? "Comissão Comercial Externa" : input.tipo === "comissao_rider" ? "Comissão Comercial Rider" : "verba Rider/Camarim";
  await db.from("case_history").insert({
    contract_id: contract.id, user_id: ctx.id, action: "etapa2",
    comment: `Fornecedor ${input.band.name} salvo — R$ ${valor.toFixed(2)} (${tipoLabel}).`,
  });

  // Contrato assinado → despesa lança imediatamente no Omie.
  const warning = await autoLaunchDespesas(db, contract);
  revalidatePath(`/case/contratos/${contract.id}`);
  return { ok: true, warning };
}

/** Remove um fornecedor/comissão e regenera os títulos (bloqueado se ELE já lançou). */
export async function removerFornecedor(contractId: string, fornecedorId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const loaded = await loadContractForAtracao(db, contractId);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

  if (await entityLancado(db, contractId, "fornecedor_id", fornecedorId)) {
    return { error: "Este fornecedor já tem títulos lançados no Omie — não é possível remover. Cancele os lançamentos direto no Omie antes." };
  }

  const { data: forn } = await db
    .from("case_contract_fornecedores")
    .select("id, case_bands(name)")
    .eq("id", fornecedorId)
    .eq("contract_id", contractId)
    .maybeSingle();
  if (!forn) return { error: "Fornecedor não encontrado neste contrato." };

  const { error } = await db.from("case_contract_fornecedores").delete().eq("id", fornecedorId);
  if (error) return { error: `Falha ao remover: ${error.message}` };

  const rec = await recomputeContractTitles(db, contract);
  if ("error" in rec) return { error: rec.error };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nome = (forn as any).case_bands?.name ?? "fornecedor";
  await db.from("case_history").insert({
    contract_id: contractId, user_id: ctx.id, action: "etapa2",
    comment: `Fornecedor ${nome} removido da verba Rider/Camarim.`,
  });
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// FINANCEIRO — lançar no Omie (gate: contrato assinado). Despesas salvas após
// a assinatura lançam sozinhas; este botão cobre pendências/erros e o a receber.
// ────────────────────────────────────────────────────────────────────────────
export async function lancarNoOmie(contractId: string): Promise<{ ok: true; status: string } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();

  const { data: c } = await db
    .from("case_contracts")
    .select("id, signed_at")
    .eq("id", contractId)
    .single();
  if (!c) return { error: "Contrato não encontrado." };
  if (!c.signed_at) return { error: "O contrato precisa estar assinado por todos (cliente, contratado e testemunha) antes de lançar no Omie." };

  const res = await launchContractToOmie(db, contractId);
  revalidatePath(`/case/contratos/${contractId}`);
  revalidatePath("/case/contratos");
  if ("error" in res) return { error: res.error };
  return { ok: true, status: res.status };
}
