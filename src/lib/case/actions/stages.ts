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
import type { CaseClientInput, CaseParcelaInput, Etapa1Input, Etapa2Input, FornecedorInput } from "@/lib/case/types";

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
  const clienteSigner = client.resp_legal?.trim() || client.name;
  const signers: ClickSignSigner[] = [
    { name: clienteSigner, email: client.email, cpf: client.cpf_resp_legal ?? client.cnpj_cpf, signAs: "contractor" },
    { name: CONTRATADO_SIGNER.name, email: CONTRATADO_SIGNER.email, cpf: CONTRATADO_SIGNER.cpf, signAs: "contractor" },
  ];
  if (c.testemunha_1_email?.trim()) {
    signers.push({ name: c.testemunha_1_nome ?? "Testemunha", email: c.testemunha_1_email, cpf: c.testemunha_1_cpf ?? null, signAs: "witness" });
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

interface AtracaoRow {
  id: string;
  band_id: string;
  attachment_path: string | null;
  valor_artista: number;
  pagar_schedule: CaseParcelaInput[] | null;
}

interface FornecedorRow {
  id: string;
  valor: number;
  pagar_schedule: CaseParcelaInput[] | null;
}

interface ContractForAtracao {
  id: string;
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  valor_rider_camarim: number;
  receber_schedule: unknown;
}

/** Guard comum: contrato + bloqueio de reedição após lançamento no Omie. */
async function loadContractForAtracao(
  db: DB,
  contractId: string,
): Promise<{ ok: true; contract: ContractForAtracao } | { ok: false; error: string }> {
  const { data: contract } = await db
    .from("case_contracts")
    .select("id, valor_atracao_cliente, valor_rider, valor_camarim, valor_extras, valor_rider_camarim, receber_schedule")
    .eq("id", contractId)
    .single();
  if (!contract) return { ok: false, error: "Contrato não encontrado." };

  const { data: existing } = await db.from("case_titles").select("id, status").eq("contract_id", contractId);
  if ((existing ?? []).some((t: { status: string }) => t.status === "lancado")) {
    return { ok: false, error: "Já existem títulos lançados no Omie — não é possível reeditar as atrações. Use 'Reenviar ao Omie' no Financeiro." };
  }
  return { ok: true, contract: contract as ContractForAtracao };
}

/**
 * Recalcula os agregados do contrato a partir de TODAS as atrações e regenera
 * os títulos pendentes (a pagar por atração; a receber pelo total).
 */
async function recomputeContractTitles(
  db: DB,
  contract: ContractForAtracao,
): Promise<{ ok: true; totalArtista: number } | { error: string }> {
  const [{ data: atracoesData }, { data: fornecedoresData }] = await Promise.all([
    db
      .from("case_contract_atracoes")
      .select("id, band_id, attachment_path, valor_artista, pagar_schedule")
      .eq("contract_id", contract.id)
      .order("created_at"),
    db
      .from("case_contract_fornecedores")
      .select("id, valor, pagar_schedule")
      .eq("contract_id", contract.id)
      .order("created_at"),
  ]);
  const atracoes = (atracoesData ?? []) as AtracaoRow[];
  const fornecedores = (fornecedoresData ?? []) as FornecedorRow[];

  const totalArtista = atracoes.reduce((acc, a) => acc + (Number(a.valor_artista) || 0), 0);
  const totalFornecedores = fornecedores.reduce((acc, f) => acc + (Number(f.valor) || 0), 0);
  const verba = Number(contract.valor_rider_camarim) || 0;
  const valorAtracao = Number(contract.valor_atracao_cliente) || 0;
  const valorRider = Number(contract.valor_rider) || 0;
  const valorCamarim = Number(contract.valor_camarim) || 0;
  const valorExtras = Number(contract.valor_extras) || 0;

  if (cents(totalArtista) + cents(verba) > cents(valorAtracao)) {
    return { error: `Atrações (R$ ${totalArtista.toFixed(2)}) + verba Rider/Camarim (R$ ${verba.toFixed(2)}) não podem passar do valor do contrato do cliente (R$ ${valorAtracao.toFixed(2)}).` };
  }
  if (cents(totalFornecedores) > cents(verba)) {
    return { error: `As parcelas de fornecedores (R$ ${totalFornecedores.toFixed(2)}) passam da verba Rider/Camarim (R$ ${verba.toFixed(2)}). Aumente a verba ou reduza os fornecedores.` };
  }

  // BV = contrato do cliente − atrações − verba Rider/Camarim (+ colunas legadas, hoje 0).
  const valorMargem = valorAtracao - totalArtista - verba;
  const valorServicos = valorMargem + valorRider + valorCamarim + valorExtras;
  const custodiaTotal = totalArtista + verba;
  const primeira = atracoes[0] ?? null;

  await db
    .from("case_contracts")
    .update({
      // band_id/attachment_path espelham a 1ª atração (compat telas/PDF/lista).
      band_id: primeira?.band_id ?? null,
      attachment_path: primeira?.attachment_path ?? null,
      valor_artista: totalArtista,
      valor_custodia: custodiaTotal,
      valor_margem: valorMargem,
      valor_servicos: valorServicos,
      // Mudou o conjunto de atrações → o BV pode ter mudado; exige reconfirmar.
      atracoes_confirmadas_at: null,
      atracoes_confirmadas_by: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contract.id);

  // Regenera os títulos como PENDENTES (limpa os antigos — todos pendentes,
  // garantido pelo guard de lançamento).
  await db.from("case_titles").delete().eq("contract_id", contract.id);
  const titleRows: Array<Record<string, unknown>> = [];

  // A pagar: por atração, com o cronograma próprio de cada uma.
  for (const a of atracoes) {
    const parcelas = (a.pagar_schedule ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);
    if ((Number(a.valor_artista) || 0) <= 0 || parcelas.length === 0) continue;
    const shortId = a.id.slice(0, 8);
    parcelas.forEach((p, idx) => {
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id, atracao_id: a.id, leg: "pagar_custodia", parcela_numero: n, parcela_total: parcelas.length,
        vencimento: p.vencimento, valor: p.valor, codigo_integracao: `case-${contract.id}-pagar-${shortId}-${n}`, status: "pendente",
      });
    });
  }

  // A pagar: fornecedores da verba Rider/Camarim, cada um com seu cronograma.
  for (const f of fornecedores) {
    const parcelas = (f.pagar_schedule ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);
    if ((Number(f.valor) || 0) <= 0 || parcelas.length === 0) continue;
    const shortId = f.id.slice(0, 8);
    parcelas.forEach((p, idx) => {
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id, fornecedor_id: f.id, leg: "pagar_custodia", parcela_numero: n, parcela_total: parcelas.length,
        vencimento: p.vencimento, valor: p.valor, codigo_integracao: `case-${contract.id}-pagar-forn-${shortId}-${n}`, status: "pendente",
      });
    });
  }

  // A receber: custódia (atrações + verba Rider/Camarim) + serviços (BV), rateados no cronograma do cliente.
  const receberSchedule = (contract.receber_schedule as CaseParcelaInput[] | null) ?? [];
  if (cents(custodiaTotal) > 0 && receberSchedule.length > 0) {
    const custCents = prorateCents(cents(custodiaTotal), receberSchedule);
    receberSchedule.forEach((p, idx) => {
      const vc = custCents[idx];
      if (vc <= 0) return;
      const n = idx + 1;
      titleRows.push({
        contract_id: contract.id, leg: "receber_custodia", parcela_numero: n, parcela_total: receberSchedule.length,
        vencimento: p.vencimento, valor: vc / 100, codigo_integracao: `case-${contract.id}-receber_custodia-${n}`, status: "pendente",
      });
    });
  }
  if (receberSchedule.length > 0) {
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
  }

  if (titleRows.length > 0) {
    const { error } = await db.from("case_titles").insert(titleRows);
    if (error) return { error: `Falha ao gerar os títulos: ${error.message}` };
  }
  return { ok: true, totalArtista };
}

/** Cria (sem atracao_id) ou edita (com atracao_id) uma atração do contrato. */
export async function salvarAtracao(input: Etapa2Input): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (!input.band?.name?.trim()) return { error: "Informe a atração/artista." };

  const loaded = await loadContractForAtracao(db, input.contract_id);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

  let bandId: string;
  try {
    bandId = await resolveBand(db, input.band, ctx.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao cadastrar a atração." };
  }
  await ensureOmieRegistration(db, "band", bandId);

  const valorArtista = Number(input.valor_artista) || 0;
  const parcelas = (input.parcelas_pagar ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);

  // Com valor, as parcelas precisam fechar; sem valor, salva só identidade+anexo.
  if (valorArtista > 0) {
    const pagarErr = validarSchedule(parcelas, valorArtista, "pagamento ao artista");
    if (pagarErr) return { error: pagarErr };
    const receberSchedule = (contract.receber_schedule as CaseParcelaInput[] | null) ?? [];
    if (receberSchedule.length === 0) {
      return { error: "Complete o Contrato Cliente (parcelas a receber) antes de gerar os títulos da atração." };
    }
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
  revalidatePath(`/case/contratos/${contract.id}`);
  return { ok: true };
}

/** Remove uma atração do contrato e regenera os títulos (bloqueado após lançamento). */
export async function removerAtracao(contractId: string, atracaoId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const loaded = await loadContractForAtracao(db, contractId);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

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
  const receberSchedule = (contract.receber_schedule as CaseParcelaInput[] | null) ?? [];
  if (verba > 0 && receberSchedule.length === 0) {
    return { error: "Complete o Contrato Cliente (parcelas a receber) antes de definir a verba Rider/Camarim." };
  }

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

/** Cria (sem fornecedor_id) ou edita (com fornecedor_id) um fornecedor da verba. */
export async function salvarFornecedor(input: FornecedorInput): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (!input.band?.name?.trim()) return { error: "Informe o fornecedor." };

  const loaded = await loadContractForAtracao(db, input.contract_id);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

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
  await ensureOmieRegistration(db, "band", bandId);

  const row = {
    contract_id: contract.id,
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

  await db.from("case_history").insert({
    contract_id: contract.id, user_id: ctx.id, action: "etapa2",
    comment: `Fornecedor ${input.band.name} salvo — R$ ${valor.toFixed(2)} (verba Rider/Camarim).`,
  });
  revalidatePath(`/case/contratos/${contract.id}`);
  return { ok: true };
}

/** Remove um fornecedor da verba e regenera os títulos (bloqueado após lançamento). */
export async function removerFornecedor(contractId: string, fornecedorId: string): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const loaded = await loadContractForAtracao(db, contractId);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

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

/**
 * Converte o saldo disponível da verba Rider/Camarim em BV: reduz a verba ao
 * total já comprometido com fornecedores — o BV (margem) absorve a diferença.
 */
export async function converterSaldoEmBv(contractId: string): Promise<{ ok: true; saldo: number } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const loaded = await loadContractForAtracao(db, contractId);
  if (!loaded.ok) return { error: loaded.error };
  const { contract } = loaded;

  const { data: fornecedoresData } = await db
    .from("case_contract_fornecedores")
    .select("valor")
    .eq("contract_id", contractId);
  const totalFornecedores = ((fornecedoresData ?? []) as Array<{ valor: number }>).reduce(
    (acc, f) => acc + (Number(f.valor) || 0),
    0,
  );
  const verba = Number(contract.valor_rider_camarim) || 0;
  const saldo = (cents(verba) - cents(totalFornecedores)) / 100;
  if (saldo <= 0) return { error: "Não há saldo disponível na verba Rider/Camarim para converter." };

  const { error } = await db
    .from("case_contracts")
    .update({ valor_rider_camarim: totalFornecedores, updated_at: new Date().toISOString() })
    .eq("id", contractId);
  if (error) return { error: `Falha ao converter o saldo: ${error.message}` };

  const rec = await recomputeContractTitles(db, { ...contract, valor_rider_camarim: totalFornecedores });
  if ("error" in rec) return { error: rec.error };

  await db.from("case_history").insert({
    contract_id: contractId, user_id: ctx.id, action: "etapa2",
    comment: `Saldo de R$ ${saldo.toFixed(2)} da verba Rider/Camarim convertido em BV.`,
  });
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true, saldo };
}

/**
 * Confirma (ou desfaz a confirmação) de que TODAS as atrações do evento já
 * tiveram contrato anexado e valor informado — pré-requisito do lançamento no
 * Omie, pois o BV (margem) depende da soma de todas as atrações.
 */
export async function confirmarAtracoes(
  contractId: string,
  confirmado: boolean,
): Promise<{ ok: true } | { error: string }> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  if (confirmado) {
    const { data: atracoesData } = await db
      .from("case_contract_atracoes")
      .select("id, valor_artista, attachment_path, case_bands(name)")
      .eq("contract_id", contractId);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const atracoes = (atracoesData ?? []) as any[];
    if (atracoes.length === 0) return { error: "Adicione ao menos uma atração antes de confirmar." };
    const incompletas = atracoes
      .filter((a) => !(Number(a.valor_artista) > 0) || !a.attachment_path)
      .map((a) => a.case_bands?.name ?? "atração sem nome");
    if (incompletas.length > 0) {
      return { error: `Para confirmar, anexe o contrato e informe o valor de: ${incompletas.join(", ")}.` };
    }
  }

  const { error } = await db
    .from("case_contracts")
    .update({
      atracoes_confirmadas_at: confirmado ? new Date().toISOString() : null,
      atracoes_confirmadas_by: confirmado ? ctx.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", contractId);
  if (error) return { error: `Falha ao salvar a confirmação: ${error.message}` };

  await db.from("case_history").insert({
    contract_id: contractId,
    user_id: ctx.id,
    action: "etapa2",
    comment: confirmado
      ? "Atrações confirmadas como completas — lançamento no Omie liberado."
      : "Confirmação das atrações desfeita — lançamento no Omie bloqueado.",
  });
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────────────
// FINANCEIRO — lançar no Omie (gate: atrações confirmadas + assinado por todos)
// ────────────────────────────────────────────────────────────────────────────
export async function lancarNoOmie(contractId: string): Promise<{ ok: true; status: string } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();

  const { data: c } = await db
    .from("case_contracts")
    .select("id, valor_artista, signed_at, atracoes_confirmadas_at")
    .eq("id", contractId)
    .single();
  if (!c) return { error: "Contrato não encontrado." };
  if (Number(c.valor_artista) <= 0) return { error: "Conclua a aba Contrato Atração antes de lançar." };
  if (!c.atracoes_confirmadas_at) {
    return { error: "Confirme na aba Contrato Atração que todos os contratos de artista já foram anexados — o BV é calculado com a soma de todas as atrações." };
  }
  if (!c.signed_at) return { error: "O contrato precisa estar assinado por todos (cliente, contratado e testemunha) antes de lançar no Omie." };

  const res = await launchContractToOmie(db, contractId);
  revalidatePath(`/case/contratos/${contractId}`);
  revalidatePath("/case/contratos");
  if ("error" in res) return { error: res.error };
  return { ok: true, status: res.status };
}
