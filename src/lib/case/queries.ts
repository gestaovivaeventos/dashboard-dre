import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseAtracaoRow, CaseBandRow, CaseClientRow, CaseContractStatus, CaseFornecedorRow, CaseLegKind, CaseParcelaInput } from "@/lib/case/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

export interface ContractListRow {
  id: string;
  contract_number: number;
  event_name: string | null;
  event_date: string | null;
  client_name: string;
  band_name: string;
  valor_atracao_cliente: number;
  valor_custodia: number;
  valor_servicos: number;
  total_venda: number;
  status: CaseContractStatus;
  created_at: string;
  attachment_path: string | null;
  sale_contract_path: string | null;
  sign_url: string | null;
  titles: Array<{ leg: CaseLegKind; status: string }>;
}

export async function getContracts(): Promise<ContractListRow[]> {
  const db = await getDb();
  const { data } = await db
    .from("case_contracts")
    .select(
      `id, contract_number, event_name, event_date, valor_atracao_cliente, valor_rider,
       valor_camarim, valor_extras, valor_custodia, valor_servicos, status, created_at, attachment_path,
       sale_contract_path, sign_url,
       case_clients(name), case_bands(name), case_titles(leg, status)`,
    )
    .order("created_at", { ascending: false });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map((c) => ({
    id: c.id,
    contract_number: c.contract_number,
    event_name: c.event_name,
    event_date: c.event_date,
    client_name: c.case_clients?.name ?? "—",
    band_name: c.case_bands?.name ?? "—",
    valor_atracao_cliente: Number(c.valor_atracao_cliente),
    valor_custodia: Number(c.valor_custodia),
    valor_servicos: Number(c.valor_servicos),
    total_venda:
      Number(c.valor_atracao_cliente) + Number(c.valor_rider) + Number(c.valor_camarim) + Number(c.valor_extras),
    status: c.status,
    created_at: c.created_at,
    attachment_path: c.attachment_path,
    sale_contract_path: c.sale_contract_path,
    sign_url: c.sign_url,
    titles: (c.case_titles ?? []).map((t: { leg: CaseLegKind; status: string }) => ({ leg: t.leg, status: t.status })),
  }));
}

export interface ContractTitleRow {
  id: string;
  leg: CaseLegKind;
  title_item: string | null;
  parcela_numero: number;
  parcela_total: number;
  vencimento: string;
  valor: number;
  status: string;
  omie_codigo: number | null;
  pago: boolean;
  omie_status: string | null;
  pago_em: string | null;
  atracao_id: string | null;
  atracao_nome: string | null;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  fornecedor_tipo: string | null;
}

export interface ContractDetail {
  id: string;
  contract_number: number;
  status: CaseContractStatus;
  event_name: string | null;
  event_date: string | null;
  show_time: string | null;
  passagem_som: string | null;
  local_name: string | null;
  local_city: string | null;
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  valor_artista: number;
  valor_custodia: number;
  valor_margem: number;
  valor_servicos: number;
  total_venda: number;
  receber_schedule: Array<{ vencimento: string; valor: number }>;
  attachment_path: string | null;
  sale_contract_path: string | null;
  sign_url: string | null;
  signed_at: string | null;
  /** BV apurado e lançado no Omie (rateio de categoria nos títulos a receber). */
  bv_lancado_valor: number | null;
  bv_lancado_at: string | null;
  sent_for_signature_at: string | null;
  clicksign_status: string | null;
  client: {
    id: string;
    name: string;
    cnpj_cpf: string | null;
    pessoa_fisica: boolean;
    email: string | null;
    phone: string | null;
    resp_legal: string | null;
    cpf_resp_legal: string | null;
    endereco: string | null;
    cidade_estado: string | null;
    cep: string | null;
  };
  band_id: string | null;
  band: { name: string; cnpj_cpf: string | null };
  /** Atrações vinculadas (um contrato pode ter várias). */
  atracoes: CaseAtracaoRow[];
  /** Verba Rider/Camarim: reserva paga a fornecedores; saldo pode virar BV. */
  valor_rider_camarim: number;
  fornecedores: CaseFornecedorRow[];
  titles: ContractTitleRow[];
}

export async function getContractDetail(id: string): Promise<ContractDetail | null> {
  const db = await getDb();
  const { data: c } = await db
    .from("case_contracts")
    .select(
      `id, contract_number, status, event_name, event_date, show_time, passagem_som,
       local_name, local_city, valor_atracao_cliente, valor_rider, valor_camarim, valor_extras,
       valor_artista, valor_custodia, valor_margem, valor_servicos, valor_rider_camarim, receber_schedule,
       attachment_path, sale_contract_path, sign_url, signed_at, bv_lancado_valor, bv_lancado_at, sent_for_signature_at, clicksign_status, band_id,
       case_clients(id, name, cnpj_cpf, pessoa_fisica, email, phone, resp_legal, cpf_resp_legal, endereco, cidade_estado, cep),
       case_bands(name, cnpj_cpf)`,
    )
    .eq("id", id)
    .maybeSingle();
  if (!c) return null;

  const [{ data: titles }, { data: atracoesData }, { data: fornecedoresData }] = await Promise.all([
    db
      .from("case_titles")
      .select("id, leg, title_item, parcela_numero, parcela_total, vencimento, valor, status, omie_codigo, pago, omie_status, pago_em, atracao_id, fornecedor_id")
      .eq("contract_id", id)
      .order("leg")
      .order("parcela_numero"),
    db
      .from("case_contract_atracoes")
      .select("id, band_id, attachment_path, valor_artista, pagar_schedule, case_bands(name, cnpj_cpf)")
      .eq("contract_id", id)
      .order("created_at"),
    db
      .from("case_contract_fornecedores")
      .select("id, tipo, band_id, descricao, attachment_path, valor, pagar_schedule, case_bands(name, cnpj_cpf)")
      .eq("contract_id", id)
      .order("created_at"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atracoes: CaseAtracaoRow[] = ((atracoesData ?? []) as any[]).map((a) => ({
    id: a.id,
    band_id: a.band_id,
    band_name: a.case_bands?.name ?? "—",
    band_cnpj_cpf: a.case_bands?.cnpj_cpf ?? null,
    attachment_path: a.attachment_path,
    valor_artista: Number(a.valor_artista),
    pagar_schedule: (Array.isArray(a.pagar_schedule) ? a.pagar_schedule : []) as CaseParcelaInput[],
  }));
  const atracaoNomeById = new Map(atracoes.map((a) => [a.id, a.band_name]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fornecedores: CaseFornecedorRow[] = ((fornecedoresData ?? []) as any[]).map((f) => ({
    id: f.id,
    tipo: f.tipo ?? "rider_camarim",
    band_id: f.band_id,
    band_name: f.case_bands?.name ?? "—",
    band_cnpj_cpf: f.case_bands?.cnpj_cpf ?? null,
    descricao: f.descricao ?? null,
    attachment_path: f.attachment_path,
    valor: Number(f.valor),
    pagar_schedule: (Array.isArray(f.pagar_schedule) ? f.pagar_schedule : []) as CaseParcelaInput[],
  }));
  const fornecedorNomeById = new Map(fornecedores.map((f) => [f.id, f.band_name]));
  const fornecedorTipoById = new Map(fornecedores.map((f) => [f.id, f.tipo]));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cc = c as any;
  return {
    id: cc.id,
    contract_number: cc.contract_number,
    status: cc.status,
    event_name: cc.event_name,
    event_date: cc.event_date,
    show_time: cc.show_time,
    passagem_som: cc.passagem_som,
    local_name: cc.local_name,
    local_city: cc.local_city,
    valor_atracao_cliente: Number(cc.valor_atracao_cliente),
    valor_rider: Number(cc.valor_rider),
    valor_camarim: Number(cc.valor_camarim),
    valor_extras: Number(cc.valor_extras),
    valor_artista: Number(cc.valor_artista),
    valor_custodia: Number(cc.valor_custodia),
    valor_margem: Number(cc.valor_margem),
    valor_servicos: Number(cc.valor_servicos),
    total_venda: Number(cc.valor_atracao_cliente) + Number(cc.valor_rider) + Number(cc.valor_camarim) + Number(cc.valor_extras),
    receber_schedule: Array.isArray(cc.receber_schedule) ? cc.receber_schedule : [],
    attachment_path: cc.attachment_path,
    sale_contract_path: cc.sale_contract_path,
    sign_url: cc.sign_url,
    signed_at: cc.signed_at,
    bv_lancado_valor: cc.bv_lancado_valor != null ? Number(cc.bv_lancado_valor) : null,
    bv_lancado_at: cc.bv_lancado_at,
    sent_for_signature_at: cc.sent_for_signature_at,
    clicksign_status: cc.clicksign_status,
    client: {
      id: cc.case_clients?.id ?? "",
      name: cc.case_clients?.name ?? "—",
      cnpj_cpf: cc.case_clients?.cnpj_cpf ?? null,
      pessoa_fisica: !!cc.case_clients?.pessoa_fisica,
      email: cc.case_clients?.email ?? null,
      phone: cc.case_clients?.phone ?? null,
      resp_legal: cc.case_clients?.resp_legal ?? null,
      cpf_resp_legal: cc.case_clients?.cpf_resp_legal ?? null,
      endereco: cc.case_clients?.endereco ?? null,
      cidade_estado: cc.case_clients?.cidade_estado ?? null,
      cep: cc.case_clients?.cep ?? null,
    },
    band_id: cc.band_id ?? null,
    band: { name: cc.case_bands?.name ?? "—", cnpj_cpf: cc.case_bands?.cnpj_cpf ?? null },
    atracoes,
    valor_rider_camarim: Number(cc.valor_rider_camarim),
    fornecedores,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    titles: ((titles ?? []) as any[]).map((t) => ({
      id: t.id,
      leg: t.leg,
      title_item: t.title_item,
      parcela_numero: t.parcela_numero,
      parcela_total: t.parcela_total,
      vencimento: t.vencimento,
      valor: Number(t.valor),
      status: t.status,
      omie_codigo: t.omie_codigo ? Number(t.omie_codigo) : null,
      pago: Boolean(t.pago),
      omie_status: t.omie_status,
      pago_em: t.pago_em,
      atracao_id: t.atracao_id ?? null,
      atracao_nome: t.atracao_id ? atracaoNomeById.get(t.atracao_id) ?? null : null,
      fornecedor_id: t.fornecedor_id ?? null,
      fornecedor_nome: t.fornecedor_id ? fornecedorNomeById.get(t.fornecedor_id) ?? null : null,
      fornecedor_tipo: t.fornecedor_id ? fornecedorTipoById.get(t.fornecedor_id) ?? null : null,
    })),
  };
}

/** Dados crus do contrato para a tela de edição (aba Cliente completa). */
export interface ContractEditData {
  id: string;
  contract_number: number;
  client_id: string;
  signed_at: string | null;
  event_name: string | null;
  event_date: string | null;
  show_time: string | null;
  show_duration: string | null;
  passagem_som: string | null;
  local_name: string | null;
  local_address: string | null;
  local_city: string | null;
  local_cep: string | null;
  especificacoes: string | null;
  espec_area_interna: boolean;
  espec_area_externa: boolean;
  espec_palco: boolean;
  espec_trio: boolean;
  extra_transporte_cidade: boolean;
  extra_translado_local: boolean;
  extra_diaria_alimentacao: boolean;
  extra_hospedagem: boolean;
  extra_outros: string | null;
  rider_tecnico: boolean;
  rider_camarim: boolean;
  rider_pre_producao: boolean;
  tipo_evento: "aberto" | "fechado" | null;
  cortesias: string | null;
  data_assinatura: string | null;
  testemunha_1_nome: string | null;
  testemunha_1_cpf: string | null;
  testemunha_1_email: string | null;
  testemunha_2_nome: string | null;
  testemunha_2_cpf: string | null;
  valor_atracao_cliente: number;
  valor_rider: number;
  valor_camarim: number;
  valor_extras: number;
  observacao: string | null;
  receber_schedule: CaseParcelaInput[];
}

export async function getContractForEdit(id: string): Promise<ContractEditData | null> {
  const db = await getDb();
  const { data: c } = await db.from("case_contracts").select("*").eq("id", id).maybeSingle();
  if (!c) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cc = c as any;
  return {
    id: cc.id,
    contract_number: cc.contract_number,
    client_id: cc.client_id,
    signed_at: cc.signed_at,
    event_name: cc.event_name,
    event_date: cc.event_date,
    show_time: cc.show_time,
    show_duration: cc.show_duration,
    passagem_som: cc.passagem_som,
    local_name: cc.local_name,
    local_address: cc.local_address,
    local_city: cc.local_city,
    local_cep: cc.local_cep,
    especificacoes: cc.especificacoes,
    espec_area_interna: !!cc.espec_area_interna,
    espec_area_externa: !!cc.espec_area_externa,
    espec_palco: !!cc.espec_palco,
    espec_trio: !!cc.espec_trio,
    extra_transporte_cidade: !!cc.extra_transporte_cidade,
    extra_translado_local: !!cc.extra_translado_local,
    extra_diaria_alimentacao: !!cc.extra_diaria_alimentacao,
    extra_hospedagem: !!cc.extra_hospedagem,
    extra_outros: cc.extra_outros ?? null,
    rider_tecnico: !!cc.rider_tecnico,
    rider_camarim: !!cc.rider_camarim,
    rider_pre_producao: !!cc.rider_pre_producao,
    tipo_evento: cc.tipo_evento ?? null,
    cortesias: cc.cortesias,
    data_assinatura: cc.data_assinatura,
    testemunha_1_nome: cc.testemunha_1_nome,
    testemunha_1_cpf: cc.testemunha_1_cpf,
    testemunha_1_email: cc.testemunha_1_email,
    testemunha_2_nome: cc.testemunha_2_nome,
    testemunha_2_cpf: cc.testemunha_2_cpf,
    valor_atracao_cliente: Number(cc.valor_atracao_cliente),
    valor_rider: Number(cc.valor_rider),
    valor_camarim: Number(cc.valor_camarim),
    valor_extras: Number(cc.valor_extras),
    observacao: cc.observacao,
    receber_schedule: Array.isArray(cc.receber_schedule) ? cc.receber_schedule : [],
  };
}

export async function getClients(): Promise<CaseClientRow[]> {
  const db = await getDb();
  const { data } = await db
    .from("case_clients")
    .select("id, name, cnpj_cpf, pessoa_fisica, email, phone, resp_legal, cpf_resp_legal, endereco, cidade_estado, cep")
    .order("name");
  return (data ?? []) as CaseClientRow[];
}

// Pool único de cadastros (espelho do Omie via syncCaseCadastrosFromOmie):
// o mesmo cadastro serve como atração OU fornecedor — sem filtro por kind.
export async function getBands(): Promise<CaseBandRow[]> {
  const db = await getDb();
  const { data } = await db
    .from("case_bands")
    .select("id, name, cnpj_cpf, pessoa_fisica, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, chave_pix_tipo")
    .order("name");
  return (data ?? []) as CaseBandRow[];
}

export async function isOmieConfigured(): Promise<boolean> {
  const db = await getDb();
  const { data } = await db
    .from("case_omie_config")
    .select("codigo_categoria_custodia, codigo_categoria_servicos, codigo_conta_corrente")
    .maybeSingle();
  return Boolean(
    data?.codigo_categoria_custodia && data?.codigo_categoria_servicos && data?.codigo_conta_corrente,
  );
}

export type CaseClosingStatus =
  | "aguardando_evento"
  | "pendente_fechamento"
  | "fechamento_enviado"
  | "concluido"
  | "cancelado";

export interface CaseProjectRow {
  id: string;
  np: number;
  projeto: string;
  tipo: string;
  recEvento: number;
  custoEvento: number; // negativo
  comissao: number; // negativo
  bvCs: number;
  resultadoEsperado: number;
  resultadoAtual: number;
  closingStatus: CaseClosingStatus;
  dataEvento: string | null;
}

export interface DashboardData {
  receitaEvento: number;
  receitaBv: number;
  custoEvento: number; // negativo
  comissaoTerceiros: number; // negativo
  resultadoLiquido: number;
  totalProjetos: number;
  aReceber: number;
  recebido: number;
  statusCount: Record<CaseClosingStatus, number>;
  projetos: CaseProjectRow[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const db = await getDb();
  const [{ data: contracts }, { data: fornecedores }, { data: titles }] = await Promise.all([
    db
      .from("case_contracts")
      .select(
        "id, contract_number, event_name, event_date, status, valor_atracao_cliente, valor_rider, valor_camarim, valor_extras, valor_rider_camarim, valor_custodia, valor_servicos, bv_lancado_valor, bv_lancado_at, case_clients(name)",
      ),
    db.from("case_contract_fornecedores").select("contract_id, tipo, valor"),
    db.from("case_titles").select("contract_id, leg, valor, status"),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cs = (contracts ?? []) as any[];

  // Comissões de terceiros por contrato (comissão externa + rider). Rider/camarim entra na custódia.
  const comissaoPorContrato = new Map<string, number>();
  for (const f of (fornecedores ?? []) as Array<{ contract_id: string; tipo: string | null; valor: number }>) {
    const tipo = f.tipo ?? "rider_camarim";
    if (tipo === "comissao_externa" || tipo === "comissao_rider") {
      comissaoPorContrato.set(f.contract_id, (comissaoPorContrato.get(f.contract_id) ?? 0) + Number(f.valor));
    }
  }

  // Estado de lançamento e recebíveis (BV/serviços) por contrato.
  const temTituloLancado = new Set<string>();
  let aReceber = 0;
  let recebido = 0;
  for (const t of (titles ?? []) as Array<{ contract_id: string; leg: CaseLegKind; valor: number; status: string }>) {
    if (t.status === "lancado") temTituloLancado.add(t.contract_id);
    if (t.leg === "receber_servicos" && t.status !== "cancelado") {
      aReceber += Number(t.valor);
      if (t.status === "lancado") recebido += Number(t.valor);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

  const projetos: CaseProjectRow[] = cs.map((c) => {
    const recEvento =
      Number(c.valor_atracao_cliente) + Number(c.valor_rider) + Number(c.valor_camarim) + Number(c.valor_extras);
    const custoEvento = -Number(c.valor_custodia);
    const comissao = -(comissaoPorContrato.get(c.id) ?? 0);
    const bvCs = Number(c.valor_servicos);
    // BV apurado quando lançado no Omie; senão usa o previsto.
    const bvAtual = c.bv_lancado_valor != null ? Number(c.bv_lancado_valor) : bvCs;

    const hasAtracao = Number(c.valor_atracao_cliente) > 0;
    const hasRider =
      Number(c.valor_rider) > 0 || Number(c.valor_camarim) > 0 || Number(c.valor_rider_camarim) > 0;
    const tipo = hasAtracao && hasRider ? "Rider + Atração" : hasRider ? "Rider" : "Atração";

    let closingStatus: CaseClosingStatus;
    if (c.status === "cancelado") closingStatus = "cancelado";
    else if (c.bv_lancado_at) closingStatus = "concluido";
    else if (temTituloLancado.has(c.id)) closingStatus = "fechamento_enviado";
    else if (c.event_date && String(c.event_date) < today) closingStatus = "pendente_fechamento";
    else closingStatus = "aguardando_evento";

    return {
      id: c.id,
      np: c.contract_number,
      projeto: c.event_name || c.case_clients?.name || "—",
      tipo,
      recEvento,
      custoEvento,
      comissao,
      bvCs,
      resultadoEsperado: bvCs + comissao,
      resultadoAtual: bvAtual + comissao,
      closingStatus,
      dataEvento: c.event_date ?? null,
    };
  });

  projetos.sort((a, b) => b.np - a.np);

  const statusCount: Record<CaseClosingStatus, number> = {
    aguardando_evento: 0,
    pendente_fechamento: 0,
    fechamento_enviado: 0,
    concluido: 0,
    cancelado: 0,
  };
  let receitaEvento = 0;
  let receitaBv = 0;
  let custoEvento = 0;
  let comissaoTerceiros = 0;
  let resultadoLiquido = 0;
  for (const p of projetos) {
    statusCount[p.closingStatus] += 1;
    receitaEvento += p.recEvento;
    receitaBv += p.bvCs;
    custoEvento += p.custoEvento;
    comissaoTerceiros += p.comissao;
    resultadoLiquido += p.resultadoAtual;
  }

  return {
    receitaEvento,
    receitaBv,
    custoEvento,
    comissaoTerceiros,
    resultadoLiquido,
    totalProjetos: projetos.length,
    aReceber,
    recebido,
    statusCount,
    projetos,
  };
}
