"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { decryptSecret } from "@/lib/security/encryption";
import { syncSupplierToOmieUnit, type OmieSupplierData } from "@/lib/omie/clientes";
import {
  findContaPagarByCnpjValor,
  findProjetoByNome,
  incluirContaPagar,
  alterarContaPagarCategoria,
  alterarContaPagarProjeto,
  excluirContaPagar,
  toOmieDate,
} from "@/lib/omie/contapagar";
import { incluirAnexoContaPagar } from "@/lib/omie/anexo";
import { parseBanco } from "@/lib/ctrl/bancos";

type LaunchResult =
  | { ok: true; status: "recebido" | "lancado" | "previsao_editada" }
  | { error: string };

const ATTACHMENT_BUCKET = "ctrl-attachments";

// Remove a palavra "previsão"/"previsao" (singular e plural, case/acento-insensível)
// da observação ao converter uma previsão recorrente no lançamento real, e limpa
// separadores/espaços que sobrem nas pontas.
function removerPrevisao(texto: string): string {
  return texto
    .replace(/previs[õo]es|previs[ãa]o/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—:.,]+|[\s\-–—:.,]+$/g, "")
    .trim();
}

// Anexa um arquivo do storage à conta a pagar do Omie. Best-effort: falha aqui
// não derruba o lançamento (o título já existe).
async function anexarNoOmie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  appKey: string,
  appSecret: string,
  codigo: number,
  path: string | null | undefined,
) {
  if (!path) return;
  try {
    const { data, error } = await supabase.storage.from(ATTACHMENT_BUCKET).download(path);
    if (error || !data) return;
    const bytes = Buffer.from(await data.arrayBuffer());
    const fileName = (path.split("/").pop() ?? "anexo").replace(/^\d+-/, "");
    await incluirAnexoContaPagar(appKey, appSecret, codigo, fileName, bytes);
  } catch (e) {
    console.error("[contapagar] falha ao anexar no Omie:", e);
  }
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

// Mapeia o método de pagamento do ControlHub para o "Tipo de Documento" do Omie
// (aba Diversos → codigo_tipo_documento). Os códigos são da tabela padrão de
// tipos de documento do Omie (PesquisarTipoDocumento), iguais para toda conta:
//   PIX = Pix · BOL = Boleto · CRC = Cartão de Crédito · CRP = Cartão Pré-Pago ·
//   DIN = Dinheiro.
// Transferência e demais métodos ficam sem tipo (o Omie mantém o padrão da conta).
function tipoDocumentoOmie(paymentMethod: string | null | undefined): string | null {
  switch (paymentMethod) {
    case "pix":
    case "pix_copia_cola":
      return "PIX";
    case "boleto":
      return "BOL";
    case "cartao_credito":
      return "CRC";
    case "cartao_prepago":
      return "CRP"; // Cartão Pré-Pago
    case "dinheiro":
      return "DIN";
    default:
      return null;
  }
}

interface IntegracaoRequest {
  payment_method: string | null;
  barcode: string | null;
  pix_key: string | null;
}
interface IntegracaoSupplier {
  name: string;
  cnpj_cpf: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  chave_pix: string | null;
  // Sub-tipo da transferência padrão: define a finalidade (corrente x poupança).
  transf_tipo_conta: "corrente" | "poupanca" | null;
}

// Finalidade da transferência (campo finalidade_transferencia do CNAB Omie).
// Códigos confirmados lendo lançamentos reais de volta pela API da Omie
// (ConsultarContaPagar → cnab_integracao_bancaria.finalidade_transferencia).
const FINALIDADE_TRANSFERENCIA = {
  corrente: "07", // Conta Corrente — já validado e enviado em produção. NÃO ALTERAR.
  poupanca: "01.41", // "Transferência PIX por Dados Bancários (Conta Poupança)".
} as const;

// PIX por CHAVE: no Omie é uma transferência (TRA) com finalidade "01.3"
// (Transferência por Chave PIX) e a chave no campo pix_qrcode. Usado pelo método
// "pix" e também pelo "pix_copia_cola" quando o conteúdo colado não é um BR Code
// EMV, mas uma chave avulsa (ex.: CPF) — a Omie rejeita chave no campo de
// QR-Code copia-e-cola ("Este Código QR-Code não parece válido").
function buildPixPorChave(
  chave: string,
  supplier: IntegracaoSupplier,
): Record<string, unknown> | null {
  const key = chave.trim();
  if (!key) return null;
  const doc = onlyDigits(supplier.doc_titular) || onlyDigits(supplier.cnpj_cpf);
  const nome = (supplier.titular_banco ?? supplier.name ?? "").slice(0, 60);
  const banco = parseBanco(supplier.banco)?.codigo ?? "";
  const agencia = onlyDigits(supplier.agencia);
  const conta = (supplier.conta_corrente ?? "").trim();
  return {
    codigo_forma_pagamento: "TRA",
    finalidade_transferencia: "01.3", // Transferência por Chave PIX
    pix_qrcode: key,
    ...(doc ? { cpf_cnpj_transferencia: doc } : {}),
    ...(nome ? { nome_transferencia: nome } : {}),
    // PIX por chave dispensa banco/agência/conta (a chave resolve o destino);
    // só enviamos quando o fornecedor os tem cadastrados.
    ...(banco ? { banco_transferencia: banco } : {}),
    ...(agencia ? { agencia_transferencia: agencia } : {}),
    ...(conta ? { conta_corrente_transferencia: conta } : {}),
  };
}

// Um BR Code (PIX copia-e-cola) válido é um payload EMV que SEMPRE começa com
// "000201" (Payload Format Indicator). Serve para distinguir um copia-e-cola de
// verdade de uma chave PIX avulsa digitada por engano nesse campo.
function isBrCodeEmv(s: string): boolean {
  return s.replace(/\s+/g, "").startsWith("000201");
}

// Monta o bloco cnab_integracao_bancaria conforme o método de pagamento. Antes
// só boleto era enviado; PIX, PIX copia-e-cola e transferência ficavam sem
// instrução de pagamento no Omie. Retorna null quando não há dados suficientes.
function buildIntegracaoBancaria(
  request: IntegracaoRequest,
  supplier: IntegracaoSupplier,
): Record<string, unknown> | null {
  const pm = request.payment_method;

  if (pm === "boleto") {
    const barcode = (request.barcode ?? "").trim();
    return barcode ? { codigo_forma_pagamento: "BOL", codigo_barras_boleto: barcode } : null;
  }

  // PIX copia-e-cola: o BR Code EMV vai em pix_qrcode com a forma "PIX". Se o que
  // foi colado NÃO é um BR Code (ex.: digitaram uma chave PIX como CPF no campo
  // de copia-e-cola), a Omie recusa o QR-Code — então tratamos como PIX por chave.
  if (pm === "pix_copia_cola") {
    const raw = (request.pix_key ?? "").trim();
    if (!raw) return null;
    if (isBrCodeEmv(raw)) {
      return { codigo_forma_pagamento: "PIX", pix_qrcode: raw };
    }
    return buildPixPorChave(raw, supplier);
  }

  // PIX por CHAVE. Mandar a chave como forma "PIX" faria o Omie tratá-la como
  // copia-e-cola (era o bug).
  if (pm === "pix") {
    return buildPixPorChave(request.pix_key ?? supplier.chave_pix ?? "", supplier);
  }

  if (pm === "transferencia") {
    // No fluxo de lançamento sempre há fornecedor; os dados bancários
    // autoritativos são os dele (validados na aprovação).
    const banco = parseBanco(supplier.banco)?.codigo ?? "";
    const agencia = onlyDigits(supplier.agencia);
    const conta = (supplier.conta_corrente ?? "").trim();
    const doc = onlyDigits(supplier.doc_titular) || onlyDigits(supplier.cnpj_cpf);
    const nome = (supplier.titular_banco ?? supplier.name ?? "").slice(0, 60);
    if (banco && agencia && conta && doc && nome) {
      // Conta poupança usa uma finalidade diferente de conta corrente. O tipo
      // vem do cadastro do fornecedor (transf_tipo_conta); nulo/legado = corrente.
      const finalidade =
        supplier.transf_tipo_conta === "poupanca"
          ? FINALIDADE_TRANSFERENCIA.poupanca
          : FINALIDADE_TRANSFERENCIA.corrente;
      return {
        codigo_forma_pagamento: "TRA",
        banco_transferencia: banco,
        agencia_transferencia: agencia,
        conta_corrente_transferencia: conta,
        finalidade_transferencia: finalidade,
        cpf_cnpj_transferencia: doc,
        nome_transferencia: nome,
      };
    }
    return null;
  }

  return null;
}

export async function launchRequestToOmie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  requestId: string,
  companyId: string,
  previsaoCodigo?: number,
): Promise<LaunchResult> {
  // 1. Fetch request
  const { data: request, error: reqErr } = await supabase
    .from("ctrl_requests")
    .select(
      "id, request_number, supplier_id, expense_type_id, sector_id, amount, due_date, reference_month, reference_year, description, payment_method, supplier_issues_invoice, invoice_number, barcode, pix_key, attachment_path, invoice_attachment_path, extra_attachment_paths, event_id, is_rateio",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (reqErr || !request) return { error: "Requisição não encontrada." };

  // 1. Fetch supplier
  const { data: supplier, error: supErr } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, status, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, transf_tipo_conta, estrangeiro, codigo_pais, estado, cidade, endereco, endereco_numero, bairro, complemento, cep",
    )
    .eq("id", request.supplier_id)
    .maybeSingle();

  if (supErr || !supplier) return { error: "Fornecedor não encontrado." };
  // Trava do fornecedor não homologado. A checagem principal é na tela de Contas
  // a Pagar (enqueueSendToPayment); esta aqui é a rede de segurança do caminho
  // de lançamento — cobre reenvio, resync e a fila drenada pelo cron, e impede
  // que um fornecedor rejeitado/pendente chegue ao cadastro da Omie.
  if (supplier.status !== "aprovado") {
    return {
      error:
        `Fornecedor "${supplier.name}" não está homologado. ` +
        "Homologue o cadastro na tela de Fornecedores antes de enviar para pagamento.",
    };
  }
  // Fornecedor estrangeiro não tem CNPJ/CPF: a Omie o cadastra com estado="EX"
  // (exibindo "Estrangeiro" no campo de documento). Só bloqueamos quando o
  // fornecedor brasileiro está sem documento.
  if (!supplier.cnpj_cpf && !supplier.estrangeiro) {
    return { error: "Fornecedor sem CNPJ/CPF." };
  }

  // 1. Fetch company
  const { data: company, error: compErr } = await supabase
    .from("companies")
    .select("id, name, omie_app_key, omie_app_secret")
    .eq("id", companyId)
    .maybeSingle();

  if (compErr || !company) return { error: "Empresa pagadora não encontrada." };

  // 2. Resolve mapeamentos
  const { data: catRow } = await supabase
    .from("ctrl_expense_type_omie_categoria")
    .select("codigo_categoria, codigo_categoria_sem_nota")
    .eq("expense_type_id", request.expense_type_id)
    .eq("company_id", companyId)
    .maybeSingle();

  // Categoria depende de ter nota fiscal: "nao" usa a categoria sem nota (com
  // fallback para a com nota); "sim"/"sim_apos_pagamento"/vazio usam a com nota.
  const catComNota = (catRow?.codigo_categoria as string | null) ?? null;
  const catSemNota = (catRow?.codigo_categoria_sem_nota as string | null) ?? null;
  const codigoCategoriaResolved =
    request.supplier_issues_invoice === "nao"
      ? (catSemNota ?? catComNota)
      : catComNota;

  const { data: depRow } = await supabase
    .from("ctrl_sector_omie_departamento")
    .select("codigo_departamento")
    .eq("sector_id", request.sector_id)
    .eq("company_id", companyId)
    .maybeSingle();

  const { data: ccRow } = await supabase
    .from("ctrl_company_omie_config")
    .select(
      "codigo_conta_corrente, codigo_conta_corrente_caixa, codigo_conta_corrente_cartao, codigo_conta_corrente_cartao_prepago, skip_cnab_remessa",
    )
    .eq("company_id", companyId)
    .maybeSingle();

  // Empresa cuja conta no Omie não emite remessa de pagamento (ex.: V Company):
  // o título é criado SEM o bloco de integração bancária (CNAB). Ver migração
  // 20260723120000. O pagamento é feito manualmente no Omie.
  const skipCnabRemessa = Boolean(ccRow?.skip_cnab_remessa);

  // Conta corrente por método: dinheiro→caixa físico, cartão→cartão, cartão
  // pré-pago→conta do pré-pago; todos com fallback para a conta padrão. Demais
  // métodos usam a padrão.
  const ccPadrao = (ccRow?.codigo_conta_corrente as string | number | null) ?? null;
  const ccCaixa = (ccRow?.codigo_conta_corrente_caixa as string | number | null) ?? null;
  const ccCartao = (ccRow?.codigo_conta_corrente_cartao as string | number | null) ?? null;
  const ccCartaoPrepago =
    (ccRow?.codigo_conta_corrente_cartao_prepago as string | number | null) ?? null;
  const codigoContaCorrenteResolved =
    request.payment_method === "dinheiro"
      ? (ccCaixa ?? ccPadrao)
      : request.payment_method === "cartao_credito"
      ? (ccCartao ?? ccPadrao)
      : request.payment_method === "cartao_prepago"
      ? (ccCartaoPrepago ?? ccPadrao)
      : ccPadrao;

  // Distribuição por departamento (rateio). Título de 1 setor: um departamento a
  // 100%. Título rateado: um departamento por setor, enviando VALOR (nValDep) e
  // percentual (nPerDep somando 100 exatamente — última parcela absorve o
  // arredondamento). Omie armazena os dois campos (ver estrutura da API).
  const missing: string[] = [];
  if (!codigoCategoriaResolved) missing.push("categoria");
  if (!codigoContaCorrenteResolved) missing.push("conta corrente");

  let distribuicao: Array<Record<string, string | number>> = [];
  if (request.is_rateio) {
    const { data: portions } = await supabase
      .from("ctrl_request_sectors")
      .select("sector_id, amount, ctrl_sectors(name)")
      .eq("request_id", request.id);
    const parts = (portions ?? []).map((p) => {
      const sec = Array.isArray(p.ctrl_sectors) ? p.ctrl_sectors[0] : p.ctrl_sectors;
      return {
        sector_id: p.sector_id as string,
        amount: Number(p.amount),
        sector_name: (sec as { name: string } | null)?.name ?? "setor",
      };
    });
    if (parts.length === 0) {
      missing.push("setores do rateio");
    } else {
      const { data: depRows } = await supabase
        .from("ctrl_sector_omie_departamento")
        .select("sector_id, codigo_departamento")
        .in("sector_id", parts.map((p) => p.sector_id))
        .eq("company_id", companyId);
      const depBySector = new Map<string, string>();
      for (const d of depRows ?? []) {
        if (d.codigo_departamento) depBySector.set(d.sector_id as string, d.codigo_departamento as string);
      }
      const semDep = parts.filter((p) => !depBySector.has(p.sector_id));
      if (semDep.length > 0) {
        missing.push(`departamento de ${semDep.map((p) => p.sector_name).join(", ")}`);
      } else {
        const total = parts.reduce((s, p) => s + p.amount, 0);
        let somaPer = 0;
        distribuicao = parts.map((p, i) => {
          const isLast = i === parts.length - 1;
          const per = isLast
            ? Math.round((100 - somaPer) * 100) / 100
            : Math.round((p.amount / total) * 10000) / 100;
          somaPer += per;
          return {
            cCodDep: depBySector.get(p.sector_id)!,
            nPerDep: per,
            nValDep: Math.round(p.amount * 100) / 100,
          };
        });
      }
    }
  } else {
    if (!depRow?.codigo_departamento) missing.push("departamento");
    else
      distribuicao = [
        { cCodDep: depRow.codigo_departamento as string, nPerDep: 100, nValDep: Number(request.amount) },
      ];
  }

  if (missing.length > 0) {
    return {
      error: `Mapeamento Omie incompleto para ${company.name}: ${missing.join(", ")}.`,
    };
  }

  const codigoCategoria = codigoCategoriaResolved as string;
  const codigoContaCorrente = codigoContaCorrenteResolved as string | number;

  // 3. Credenciais
  if (!company.omie_app_key || !company.omie_app_secret) {
    return { error: "Empresa sem conexão Omie." };
  }
  const appKey = decryptSecret(company.omie_app_key as string);
  const appSecret = decryptSecret(company.omie_app_secret as string);

  // 4. Garantir fornecedor na empresa
  let codigoClienteFornecedor: number;
  try {
    const { data: linkRow } = await supabase
      .from("ctrl_supplier_omie_links")
      .select("omie_codigo_cliente")
      .eq("supplier_id", supplier.id)
      .eq("company_id", companyId)
      .maybeSingle();

    if (linkRow?.omie_codigo_cliente) {
      codigoClienteFornecedor = Number(linkRow.omie_codigo_cliente);
    } else {
      const supplierData: OmieSupplierData = {
        id: supplier.id as string,
        name: supplier.name as string,
        cnpj_cpf: supplier.cnpj_cpf as string | null,
        email: supplier.email as string | null,
        phone: supplier.phone as string | null,
        banco: supplier.banco as string | null,
        agencia: supplier.agencia as string | null,
        conta_corrente: supplier.conta_corrente as string | null,
        titular_banco: supplier.titular_banco as string | null,
        doc_titular: supplier.doc_titular as string | null,
        chave_pix: supplier.chave_pix as string | null,
        // Estrangeiro: sem CNPJ, a Omie usa estado="EX" + codigo_pais (BACEN).
        // Sem estes campos o syncSupplierToOmieUnit rejeitaria por falta de documento.
        estrangeiro: Boolean(supplier.estrangeiro),
        codigo_pais: supplier.codigo_pais as string | null,
        estado: supplier.estado as string | null,
        cidade: supplier.cidade as string | null,
        endereco: supplier.endereco as string | null,
        endereco_numero: supplier.endereco_numero as string | null,
        bairro: supplier.bairro as string | null,
        complemento: supplier.complemento as string | null,
        cep: supplier.cep as string | null,
      };
      const { codigoCliente } = await syncSupplierToOmieUnit(appKey, appSecret, supplierData);
      codigoClienteFornecedor = codigoCliente;

      await supabase
        .from("ctrl_supplier_omie_links")
        .upsert(
          {
            supplier_id: supplier.id,
            company_id: companyId,
            omie_codigo_cliente: codigoCliente,
            sync_status: "ok",
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "supplier_id,company_id" },
        );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao sincronizar fornecedor no Omie.";
    await supabase
      .from("ctrl_requests")
      .update({
        omie_launch_status: "erro",
        omie_launch_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    return { error: msg };
  }

  // 5. Matching + lançamento
  let omieStatus: "recebido" | "lancado" | "previsao_editada";
  let omieCode: number;

  // Vencimento: fallback para competência se due_date for nulo
  const dueDateIso: string =
    request.due_date ??
    `${request.reference_year}-${String(request.reference_month).padStart(2, "0")}-01`;
  const emissaoIso = `${request.reference_year}-${String(request.reference_month).padStart(2, "0")}-01`;

  // Nº do pedido (Omie) = número da requisição do ControlHub.
  const numeroPedido = String(request.request_number ?? "");
  // Campo "Nota Fiscal" do Omie (numero_documento_fiscal) conforme o status de NF:
  //   nao → "SEM NOTA FISCAL"; sim_apos_pagamento → "APÓS PAGAMENTO";
  //   sim/demais → número da NF informado.
  const numeroDocumentoFiscal =
    request.supplier_issues_invoice === "nao"
      ? "SEM NOTA FISCAL"
      : request.supplier_issues_invoice === "sim_apos_pagamento"
      ? "APÓS PAGAMENTO"
      : ((request.invoice_number as string | null) ?? "");

  // Integração bancária (CNAB) conforme o método: boleto, PIX, PIX copia-e-cola
  // ou transferência. Empresas com skip_cnab_remessa não enviam esse bloco (a
  // conta delas no Omie não gera remessa) — o título é criado sem a remessa.
  const integracaoBancaria = skipCnabRemessa
    ? null
    : buildIntegracaoBancaria(request, supplier);

  // Projeto Omie a partir do EVENTO da requisição. O evento (ControlHub) casa
  // com o projeto cadastrado na Omie da empresa pagadora pelo NOME. Só vincula
  // se o projeto já existir na Omie (não criamos projeto); sem match, lança sem
  // projeto. Best-effort: falha na consulta não derruba o lançamento.
  let codigoProjeto: number | null = null;
  if (request.event_id) {
    const { data: eventRow } = await supabase
      .from("ctrl_events")
      .select("name")
      .eq("id", request.event_id)
      .maybeSingle();
    const eventName = (eventRow?.name as string | null) ?? null;
    if (eventName) {
      try {
        codigoProjeto = await findProjetoByNome(appKey, appSecret, eventName);
      } catch (e) {
        console.error("[contapagar] falha ao resolver projeto do evento no Omie:", e);
      }
    }
  }

  // Tipo de Documento (aba Diversos do Omie) a partir do método de pagamento.
  const codigoTipoDocumento = tipoDocumentoOmie(request.payment_method);

  // Payload base compartilhado por incluir e alterar (a alteração só acrescenta
  // codigo_lancamento_omie e remove codigo_lancamento_integracao).
  const basePayload = {
    codigo_cliente_fornecedor: codigoClienteFornecedor,
    data_vencimento: toOmieDate(dueDateIso),
    data_previsao: toOmieDate(dueDateIso),
    data_emissao: toOmieDate(emissaoIso),
    valor_documento: Number(request.amount),
    codigo_categoria: codigoCategoria,
    distribuicao,
    id_conta_corrente: Number(codigoContaCorrente),
    ...(codigoTipoDocumento ? { codigo_tipo_documento: codigoTipoDocumento } : {}),
    ...(codigoProjeto ? { codigo_projeto: codigoProjeto } : {}),
    ...(numeroPedido ? { numero_pedido: numeroPedido } : {}),
    ...(numeroDocumentoFiscal ? { numero_documento_fiscal: numeroDocumentoFiscal } : {}),
    ...(integracaoBancaria ? { cnab_integracao_bancaria: integracaoBancaria } : {}),
  };

  // Retry sem o bloco de integração bancária quando o Omie o rejeita (código de
  // barras inválido, PIX/QR code, dados de transferência etc.). O título ainda é
  // criado — a integração é best-effort e não pode derrubar o lançamento.
  const isCnabError = (e: unknown) => {
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return (
      msg.includes("código de barras") ||
      msg.includes("codigo de barras") ||
      msg.includes("codigo_barras") ||
      msg.includes("cnab") ||
      msg.includes("integração banc") ||
      msg.includes("integracao banc") ||
      msg.includes("pix") ||
      msg.includes("qrcode") ||
      msg.includes("qr code") ||
      msg.includes("qr-code") ||
      msg.includes("transfer") ||
      msg.includes("agência") ||
      msg.includes("agencia") ||
      msg.includes("finalidade") ||
      msg.includes("forma_pagamento") ||
      msg.includes("forma de pagamento") ||
      // Conta pagadora que não gera remessa (ex.: caixinha/banco 999 sem
      // instituição). Sem o bloco CNAB o título é criado normalmente e o
      // pagamento é feito manualmente no Omie.
      msg.includes("remessa") ||
      msg.includes("instituição") ||
      msg.includes("instituicao") ||
      msg.includes("id_conta_corrente")
    );
  };

  // Erro do Omie relacionado ao campo de projeto (codigo_projeto). Projeto é
  // enriquecimento best-effort vindo do evento — nunca pode derrubar o
  // lançamento. Se a Omie recusar o projeto por qualquer motivo, re-tentamos
  // sem ele.
  const isProjetoError = (e: unknown) => {
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return msg.includes("projeto") || msg.includes("codigo_projeto");
  };

  // Inclui a conta a pagar tolerando falhas nos campos best-effort (integração
  // bancária e projeto): ao bater num erro desses, remove só o campo ofensor e
  // re-tenta, garantindo que o título seja criado. Erros de campos essenciais
  // (categoria, conta corrente, fornecedor, etc.) continuam relançados.
  const incluirTolerante = async (
    p: Record<string, unknown>,
  ): Promise<{ codigoLancamentoOmie: number }> => {
    try {
      return await incluirContaPagar(appKey, appSecret, p as never);
    } catch (e) {
      let retry = p;
      let dropped = false;
      if (isCnabError(e) && "cnab_integracao_bancaria" in retry) {
        const { cnab_integracao_bancaria: _c, ...rest } = retry;
        void _c;
        retry = rest;
        dropped = true;
      }
      if (isProjetoError(e) && "codigo_projeto" in retry) {
        const { codigo_projeto: _p, ...rest } = retry;
        void _p;
        retry = rest;
        dropped = true;
      }
      if (!dropped) throw e;
      return await incluirContaPagar(appKey, appSecret, retry as never);
    }
  };

  try {
    if (previsaoCodigo) {
      // Substituição de previsão: o Omie NÃO substitui a observação de título
      // recorrente (RPTP) via AlterarContaPagar — ele mantém o texto da
      // recorrência ("PREVISÃO - ...") e só anexa o nosso. Então, em vez de
      // editar, criamos um título novo (observação limpa = descrição, sem a
      // palavra "previsão") e excluímos a previsão recorrente.
      const observacao = removerPrevisao((request.description as string | null) ?? "");
      const payload = {
        codigo_lancamento_integracao: request.id as string,
        ...basePayload,
        ...(observacao ? { observacao } : {}),
      };
      const { codigoLancamentoOmie: novoCodigo } = await incluirTolerante(payload);
      // Exclui a previsão recorrente DEPOIS de criar o título real (best-effort):
      // se a exclusão falhar, fica um duplicado para limpeza manual, mas nunca se
      // perde o lançamento.
      try {
        await excluirContaPagar(appKey, appSecret, previsaoCodigo);
      } catch (e) {
        console.error("[contapagar] título criado mas falha ao excluir previsão:", e);
      }
      omieStatus = "previsao_editada";
      omieCode = novoCodigo;
    } else {
      // O matching de título existente é por CNPJ+valor. Fornecedor estrangeiro
      // não tem documento — pula o matching e vai direto para a inclusão.
      const found = supplier.cnpj_cpf
        ? await findContaPagarByCnpjValor(
            appKey,
            appSecret,
            supplier.cnpj_cpf as string,
            Number(request.amount),
          )
        : null;

      if (found) {
        await alterarContaPagarCategoria(
          appKey,
          appSecret,
          found.codigoLancamentoOmie,
          codigoCategoria,
        );
        // Projeto do evento também no título já existente (best-effort — não
        // pode derrubar o fluxo de recategorização).
        if (codigoProjeto) {
          try {
            await alterarContaPagarProjeto(
              appKey,
              appSecret,
              found.codigoLancamentoOmie,
              codigoProjeto,
            );
          } catch (e) {
            console.error(
              "[contapagar] falha best-effort ao vincular projeto ao título existente:",
              e,
            );
          }
        }
        omieStatus = "recebido";
        omieCode = found.codigoLancamentoOmie;
      } else {
        const payload = {
          codigo_lancamento_integracao: request.id as string,
          ...basePayload,
          ...(request.description ? { observacao: request.description as string } : {}),
        };
        const { codigoLancamentoOmie } = await incluirTolerante(payload);
        omieStatus = "lancado";
        omieCode = codigoLancamentoOmie;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Erro ao lançar conta a pagar no Omie.";
    await supabase
      .from("ctrl_requests")
      .update({
        omie_launch_status: "erro",
        omie_launch_error: msg,
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestId);
    return { error: msg };
  }

  // 6. Anexa boleto, nota fiscal e anexos diversos ao título no Omie (best-effort).
  await anexarNoOmie(supabase, appKey, appSecret, omieCode, request.attachment_path as string | null);
  await anexarNoOmie(supabase, appKey, appSecret, omieCode, request.invoice_attachment_path as string | null);
  const extraPaths = (request.extra_attachment_paths as string[] | null) ?? [];
  for (const extraPath of extraPaths) {
    await anexarNoOmie(supabase, appKey, appSecret, omieCode, extraPath);
  }

  // 7. Atualizar ctrl_requests. Não ignora o erro do update: o título já foi
  // lançado/editado no Omie, então uma falha aqui (ex.: valor fora de um CHECK)
  // não pode passar silenciosa — vira erro visível para reenvio/inspeção.
  const { error: updErr } = await supabase
    .from("ctrl_requests")
    .update({
      omie_launch_status: omieStatus,
      omie_contapagar_codigo: omieCode,
      omie_launched_at: new Date().toISOString(),
      omie_launch_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  if (updErr) {
    console.error("[contapagar] título no Omie OK mas falha ao gravar status:", updErr.message);
    return {
      error: `Lançado no Omie (código ${omieCode}), mas falha ao gravar o status: ${updErr.message}`,
    };
  }

  return { ok: true, status: omieStatus };
}

export async function resyncContaPagar(requestId: string): Promise<LaunchResult> {
  await requireCtrlRole("contas_a_pagar", "csc", "admin");

  const supabase = createAdminClientIfAvailable();
  if (!supabase) throw new Error("Admin client não disponível.");

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("paying_company_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!req?.paying_company_id) {
    return { error: "Requisição sem empresa pagadora." };
  }

  // Reenvio não repassa previsaoCodigo: a substituição de previsão (criar título
  // + excluir a previsão) só ocorre no envio inicial pelo diálogo. No reenvio a
  // previsão já foi consumida; segue o fluxo normal de lançamento.
  const result = await launchRequestToOmie(
    supabase,
    requestId,
    req.paying_company_id as string,
  );

  revalidatePath("/ctrl/contas-a-pagar");
  return result;
}
