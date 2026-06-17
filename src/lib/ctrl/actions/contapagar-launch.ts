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
  alterarContaPagar,
  alterarContaPagarCategoria,
  toOmieDate,
} from "@/lib/omie/contapagar";
import { incluirAnexoContaPagar } from "@/lib/omie/anexo";

type LaunchResult =
  | { ok: true; status: "recebido" | "lancado" | "previsao_editada" }
  | { error: string };

const ATTACHMENT_BUCKET = "ctrl-attachments";

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
      "id, supplier_id, expense_type_id, sector_id, amount, due_date, reference_month, reference_year, description, payment_method, invoice_number, barcode, attachment_path, invoice_attachment_path",
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
    .select("codigo_categoria")
    .eq("expense_type_id", request.expense_type_id)
    .eq("company_id", companyId)
    .maybeSingle();

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
  if (!catRow?.codigo_categoria) missing.push("categoria");
  if (!depRow?.codigo_departamento) missing.push("departamento");
  if (!codigoContaCorrenteResolved) missing.push("conta corrente");

  if (missing.length > 0) {
    return {
      error: `Mapeamento Omie incompleto para ${company.name}: ${missing.join(", ")}.`,
    };
  }

  const codigoCategoria = catRow!.codigo_categoria as string;
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
    ...(request.invoice_number
      ? {
          numero_documento: request.invoice_number as string,
          numero_documento_fiscal: request.invoice_number as string,
        }
      : {}),
    ...(request.payment_method === "boleto" && request.barcode
      ? {
          cnab_integracao_bancaria: {
            codigo_forma_pagamento: "BOL",
            codigo_barras_boleto: request.barcode,
          },
        }
      : {}),
  };

  // Retry sem o bloco de boleto quando o código de barras é rejeitado pelo Omie.
  const isBarcodeError = (e: unknown) => {
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return (
      msg.includes("código de barras") ||
      msg.includes("codigo de barras") ||
      msg.includes("codigo_barras")
    );
  };

  try {
    if (previsaoCodigo) {
      // Edita a previsão existente sobrescrevendo todos os campos. A observação é
      // sempre enviada (mesmo vazia) para apagar o marcador "previsão" do título.
      const observacao = (request.description as string | null) ?? "";
      try {
        await alterarContaPagar(appKey, appSecret, {
          ...basePayload,
          observacao,
          codigo_lancamento_omie: previsaoCodigo,
        });
      } catch (e) {
        if (isBarcodeError(e) && "cnab_integracao_bancaria" in basePayload) {
          const { cnab_integracao_bancaria: _drop, ...noCnab } = basePayload;
          void _drop;
          await alterarContaPagar(appKey, appSecret, {
            ...noCnab,
            observacao,
            codigo_lancamento_omie: previsaoCodigo,
          });
        } else {
          throw e;
        }
      }
      omieStatus = "previsao_editada";
      omieCode = previsaoCodigo;
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
          if (isBarcodeError(e) && "cnab_integracao_bancaria" in payload) {
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

  // 7. Atualizar ctrl_requests
  await supabase
    .from("ctrl_requests")
    .update({
      omie_launch_status: omieStatus,
      omie_contapagar_codigo: omieCode,
      omie_launched_at: new Date().toISOString(),
      omie_launch_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestId);

  return { ok: true, status: omieStatus };
}

export async function resyncContaPagar(requestId: string): Promise<LaunchResult> {
  await requireCtrlRole("contas_a_pagar", "csc", "admin");

  const supabase = createAdminClientIfAvailable();
  if (!supabase) throw new Error("Admin client não disponível.");

  const { data: req } = await supabase
    .from("ctrl_requests")
    .select("paying_company_id, omie_launch_status, omie_contapagar_codigo")
    .eq("id", requestId)
    .maybeSingle();

  if (!req?.paying_company_id) {
    return { error: "Requisição sem empresa pagadora." };
  }

  // Se já havia editado uma previsão, reusa o mesmo título no reenvio (não cria
  // duplicata).
  const previsaoCodigo =
    req.omie_launch_status === "previsao_editada" && req.omie_contapagar_codigo
      ? Number(req.omie_contapagar_codigo)
      : undefined;

  const result = await launchRequestToOmie(
    supabase,
    requestId,
    req.paying_company_id as string,
    previsaoCodigo,
  );

  revalidatePath("/ctrl/contas-a-pagar");
  return result;
}
