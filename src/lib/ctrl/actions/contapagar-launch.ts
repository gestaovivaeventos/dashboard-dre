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
  toOmieDate,
} from "@/lib/omie/contapagar";

type LaunchResult =
  | { ok: true; status: "recebido" | "lancado" }
  | { error: string };

export async function launchRequestToOmie(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  requestId: string,
  companyId: string,
): Promise<LaunchResult> {
  // 1. Fetch request
  const { data: request, error: reqErr } = await supabase
    .from("ctrl_requests")
    .select(
      "id, supplier_id, expense_type_id, sector_id, amount, due_date, reference_month, reference_year, description, payment_method, invoice_number, barcode",
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
    .select("codigo_conta_corrente")
    .eq("company_id", companyId)
    .maybeSingle();

  const missing: string[] = [];
  if (!catRow?.codigo_categoria) missing.push("categoria");
  if (!depRow?.codigo_departamento) missing.push("departamento");
  if (!ccRow?.codigo_conta_corrente) missing.push("conta corrente");

  if (missing.length > 0) {
    return {
      error: `Mapeamento Omie incompleto para ${company.name}: ${missing.join(", ")}.`,
    };
  }

  const codigoCategoria = catRow!.codigo_categoria as string;
  const codigoDepartamento = depRow!.codigo_departamento as string;
  const codigoContaCorrente = ccRow!.codigo_conta_corrente as string | number;

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
  let omieStatus: "recebido" | "lancado";
  let omieCode: number;

  try {
    const found = await findContaPagarByCnpjValor(
      appKey,
      appSecret,
      supplier.cnpj_cpf as string,
      Number(request.amount),
    );

    if (found) {
      await alterarContaPagarCategoria(appKey, appSecret, found.codigoLancamentoOmie, codigoCategoria);
      omieStatus = "recebido";
      omieCode = found.codigoLancamentoOmie;
    } else {
      // Vencimento: fallback para competência se due_date for nulo
      const dueDateIso: string =
        request.due_date ??
        `${request.reference_year}-${String(request.reference_month).padStart(2, "0")}-01`;

      const emissaoIso = `${request.reference_year}-${String(request.reference_month).padStart(2, "0")}-01`;

      const payload = {
        codigo_lancamento_integracao: request.id as string,
        codigo_cliente_fornecedor: codigoClienteFornecedor,
        data_vencimento: toOmieDate(dueDateIso),
        data_previsao: toOmieDate(dueDateIso),
        data_emissao: toOmieDate(emissaoIso),
        valor_documento: Number(request.amount),
        codigo_categoria: codigoCategoria,
        distribuicao: [{ cCodDep: codigoDepartamento, nPerDep: 100 }],
        id_conta_corrente: Number(codigoContaCorrente),
        ...(request.description ? { observacao: request.description as string } : {}),
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

      let codigoLancamentoOmie: number;
      try {
        ({ codigoLancamentoOmie } = await incluirContaPagar(appKey, appSecret, payload));
      } catch (e) {
        // Código de barras inválido (OCR errado / formato) não pode derrubar o
        // lançamento inteiro: tenta de novo SEM o bloco do boleto. O título é
        // criado; a linha digitável pode ser ajustada depois no Omie.
        const msg = e instanceof Error ? e.message.toLowerCase() : "";
        const isBarcode = msg.includes("código de barras") || msg.includes("codigo de barras") || msg.includes("codigo_barras");
        if (isBarcode && "cnab_integracao_bancaria" in payload) {
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

  // 6. Atualizar ctrl_requests
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
    .select("paying_company_id")
    .eq("id", requestId)
    .maybeSingle();

  if (!req?.paying_company_id) {
    return { error: "Requisição sem empresa pagadora." };
  }

  const result = await launchRequestToOmie(supabase, requestId, req.paying_company_id as string);

  revalidatePath("/ctrl/contas-a-pagar");
  return result;
}
