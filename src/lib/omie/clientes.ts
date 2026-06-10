import { omieCall, OMIE_CLIENTES_URL } from "@/lib/omie/client";

export interface OmieSupplierData {
  id: string;
  name: string;
  cnpj_cpf: string | null;
  email: string | null;
  phone: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  chave_pix: string | null;
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function buildClientePayload(supplier: OmieSupplierData): Record<string, unknown> {
  const doc = onlyDigits(supplier.cnpj_cpf);
  const phone = onlyDigits(supplier.phone);
  const payload: Record<string, unknown> = {
    codigo_cliente_integracao: supplier.id,
    razao_social: supplier.name,
    nome_fantasia: supplier.name,
    cnpj_cpf: doc,
    pessoa_fisica: doc.length === 11 ? "S" : "N",
    email: supplier.email ?? "",
    tags: [{ tag: "Fornecedor" }],
  };
  if (phone.length >= 10) {
    payload.telefone1_ddd = phone.slice(0, 2);
    payload.telefone1_numero = phone.slice(2);
  }
  // dadosBancarios da Omie NÃO aceita chave_pix (Tag [CHAVE_PIX] não faz parte
  // da estrutura). Só enviamos quando há dados bancários de fato — PIX-only não
  // entra aqui (a chave não é necessária para o cadastro do cliente no Omie).
  if (supplier.banco || supplier.agencia || supplier.conta_corrente) {
    payload.dadosBancarios = {
      codigo_banco: onlyDigits(supplier.banco),
      agencia: supplier.agencia ?? "",
      conta_corrente: onlyDigits(supplier.conta_corrente),
      doc_titular: onlyDigits(supplier.doc_titular) || doc,
      nome_titular: supplier.titular_banco ?? supplier.name,
    };
  }
  return payload;
}

// Cadastra/atualiza o fornecedor em UMA unidade Omie, sem duplicar:
//   1. Procura por CNPJ (cobre legado e re-sync) → AlterarCliente.
//   2. Não achou → IncluirCliente.
// Em ambos grava codigo_cliente_integracao = supplier.id para adotar o registro.
export async function syncSupplierToOmieUnit(
  appKey: string,
  appSecret: string,
  supplier: OmieSupplierData,
): Promise<{ codigoCliente: number }> {
  const doc = onlyDigits(supplier.cnpj_cpf);
  if (!doc) throw new Error("Fornecedor sem CNPJ/CPF — não é possível cadastrar no Omie.");

  const list = await omieCall(OMIE_CLIENTES_URL, "ListarClientes", appKey, appSecret, {
    pagina: 1,
    registros_por_pagina: 50,
    clientesFiltro: { cnpj_cpf: doc },
  });

  let existingCode: number | null = null;
  if (!list.notFound) {
    const arr =
      (list.data.clientes_cadastro as Array<Record<string, unknown>> | undefined) ?? [];
    const match = arr.find((c) => onlyDigits(String(c.cnpj_cpf ?? "")) === doc) ?? arr[0];
    if (match?.codigo_cliente_omie) existingCode = Number(match.codigo_cliente_omie);
  }

  const fields = buildClientePayload(supplier);

  if (existingCode) {
    const res = await omieCall(OMIE_CLIENTES_URL, "AlterarCliente", appKey, appSecret, {
      ...fields,
      codigo_cliente_omie: existingCode,
    });
    return { codigoCliente: Number((res.data.codigo_cliente_omie as number) ?? existingCode) };
  }

  const res = await omieCall(OMIE_CLIENTES_URL, "IncluirCliente", appKey, appSecret, fields);
  const code = Number(res.data.codigo_cliente_omie as number);
  if (!code) throw new Error("Omie não retornou codigo_cliente_omie ao incluir.");
  return { codigoCliente: code };
}
