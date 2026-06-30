"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { decryptSecret } from "@/lib/security/encryption";
import { syncSupplierToOmieUnit, type OmieSupplierData } from "@/lib/omie/clientes";
import {
  findContaPagarByCnpjValor,
  incluirContaPagar,
  alterarContaPagarCategoria,
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

  // PIX copia-e-cola: o código EMV fica em pix_key. PIX por chave: usa a chave
  // da requisição (ou a do fornecedor). Em ambos vai no campo pix_qrcode.
  if (pm === "pix_copia_cola" || pm === "pix") {
    const qr = (request.pix_key ?? supplier.chave_pix ?? "").trim();
    return qr ? { codigo_forma_pagamento: "PIX", pix_qrcode: qr } : null;
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
      return {
        codigo_forma_pagamento: "TRA",
        banco_transferencia: banco,
        agencia_transferencia: agencia,
        conta_corrente_transferencia: conta,
        finalidade_transferencia: "00005", // Fornecedores
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
      "id, request_number, supplier_id, expense_type_id, sector_id, amount, due_date, reference_month, reference_year, description, payment_method, supplier_issues_invoice, invoice_number, barcode, pix_key, attachment_path, invoice_attachment_path",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (reqErr || !request) return { error: "Requisição não encontrada." };

  // 1. Fetch supplier
  const { data: supplier, error: supErr } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix",
    )
    .eq("id", request.supplier_id)
    .maybeSingle();

  if (supErr || !supplier) return { error: "Fornecedor não encontrado." };
  if (!supplier.cnpj_cpf) return { error: "Fornecedor sem CNPJ/CPF." };

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
    .select("codigo_conta_corrente, codigo_conta_corrente_caixa, codigo_conta_corrente_cartao")
    .eq("company_id", companyId)
    .maybeSingle();

  // Conta corrente por método: dinheiro→caixa físico, cartão→cartão; ambos com
  // fallback para a conta padrão. Demais métodos usam a padrão.
  const ccPadrao = (ccRow?.codigo_conta_corrente as string | number | null) ?? null;
  const ccCaixa = (ccRow?.codigo_conta_corrente_caixa as string | number | null) ?? null;
  const ccCartao = (ccRow?.codigo_conta_corrente_cartao as string | number | null) ?? null;
  const codigoContaCorrenteResolved =
    request.payment_method === "dinheiro"
      ? (ccCaixa ?? ccPadrao)
      : request.payment_method === "cartao_credito"
      ? (ccCartao ?? ccPadrao)
      : ccPadrao;

  const missing: string[] = [];
  if (!codigoCategoriaResolved) missing.push("categoria");
  if (!depRow?.codigo_departamento) missing.push("departamento");
  if (!codigoContaCorrenteResolved) missing.push("conta corrente");

  if (missing.length > 0) {
    return {
      error: `Mapeamento Omie incompleto para ${company.name}: ${missing.join(", ")}.`,
    };
  }

  const codigoCategoria = codigoCategoriaResolved as string;
  const codigoDepartamento = depRow!.codigo_departamento as string;
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
  // ou transferência.
  const integracaoBancaria = buildIntegracaoBancaria(request, supplier);

  // Payload base compartilhado por incluir e alterar (a alteração só acrescenta
  // codigo_lancamento_omie e remove codigo_lancamento_integracao).
  const basePayload = {
    codigo_cliente_fornecedor: codigoClienteFornecedor,
    data_vencimento: toOmieDate(dueDateIso),
    data_previsao: toOmieDate(dueDateIso),
    data_emissao: toOmieDate(emissaoIso),
    valor_documento: Number(request.amount),
    codigo_categoria: codigoCategoria,
    distribuicao: [{ cCodDep: codigoDepartamento, nPerDep: 100 }],
    id_conta_corrente: Number(codigoContaCorrente),
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
      msg.includes("transfer") ||
      msg.includes("agência") ||
      msg.includes("agencia") ||
      msg.includes("finalidade") ||
      msg.includes("forma_pagamento") ||
      msg.includes("forma de pagamento")
    );
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
      let novoCodigo: number;
      try {
        ({ codigoLancamentoOmie: novoCodigo } = await incluirContaPagar(appKey, appSecret, payload));
      } catch (e) {
        if (isCnabError(e) && "cnab_integracao_bancaria" in payload) {
          const { cnab_integracao_bancaria: _drop, ...noCnab } = payload;
          void _drop;
          ({ codigoLancamentoOmie: novoCodigo } = await incluirContaPagar(appKey, appSecret, noCnab));
        } else {
          throw e;
        }
      }
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
      const found = await findContaPagarByCnpjValor(
        appKey,
        appSecret,
        supplier.cnpj_cpf as string,
        Number(request.amount),
      );

      if (found) {
        await alterarContaPagarCategoria(
          appKey,
          appSecret,
          found.codigoLancamentoOmie,
          codigoCategoria,
        );
        omieStatus = "recebido";
        omieCode = found.codigoLancamentoOmie;
      } else {
        const payload = {
          codigo_lancamento_integracao: request.id as string,
          ...basePayload,
          ...(request.description ? { observacao: request.description as string } : {}),
        };
        let codigoLancamentoOmie: number;
        try {
          ({ codigoLancamentoOmie } = await incluirContaPagar(appKey, appSecret, payload));
        } catch (e) {
          if (isCnabError(e) && "cnab_integracao_bancaria" in payload) {
            const { cnab_integracao_bancaria: _drop, ...noCnab } = payload;
            void _drop;
            ({ codigoLancamentoOmie } = await incluirContaPagar(appKey, appSecret, noCnab));
          } else {
            throw e;
          }
        }
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

  // 6. Anexa boleto e nota fiscal ao título no Omie (best-effort).
  await anexarNoOmie(supabase, appKey, appSecret, omieCode, request.attachment_path as string | null);
  await anexarNoOmie(supabase, appKey, appSecret, omieCode, request.invoice_attachment_path as string | null);

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
