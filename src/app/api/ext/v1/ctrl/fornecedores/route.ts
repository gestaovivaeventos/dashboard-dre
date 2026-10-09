import { NextResponse } from "next/server";

import { getSuppliers } from "@/lib/ctrl/actions/suppliers";
import { extError, withExtCtrl } from "@/lib/ext-api/handler";

export const dynamic = "force-dynamic";

// Mesma lista da Nova Requisição: aprovados + pendentes. O fornecedor ainda não
// homologado pode ser escolhido; a trava é no Contas a Pagar, no envio.
export async function GET(request: Request) {
  return withExtCtrl(request, async () => {
    const result = await getSuppliers(["aprovado", "pendente"]);
    if ("error" in result) return extError(400, result.error ?? "Erro ao listar fornecedores.");
    return NextResponse.json({
      fornecedores: result.suppliers.map((s) => ({
        id: s.id,
        nome: s.name,
        nomeFantasia: s.nome_fantasia,
        documento: s.cnpj_cpf,
        status: s.status,
        estrangeiro: s.estrangeiro,
        pix: s.chave_pix ? { chave: s.chave_pix, tipo: s.pix_key_type, padrao: s.pix_padrao } : null,
        banco: s.banco
          ? {
              banco: s.banco,
              agencia: s.agencia,
              conta: s.conta_corrente,
              tipoConta: s.transf_tipo_conta,
              titular: s.titular_banco,
              docTitular: s.doc_titular,
              padrao: s.transf_padrao,
            }
          : null,
      })),
    });
  });
}
