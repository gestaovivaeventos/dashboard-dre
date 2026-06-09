import { omieCall } from "@/lib/omie/client";

const CONTAPAGAR_URL = "https://app.omie.com.br/api/v1/financas/contapagar/";

const cents = (v: number) => Math.round(v * 100);

// Procura um título EM ABERTO do fornecedor (por CNPJ) com valor igual.
// Prefere os originados de NF-e de entrada (id_origem === 'NFEP').
export async function findContaPagarByCnpjValor(
  appKey: string,
  appSecret: string,
  cnpj: string,
  valor: number,
): Promise<{ codigoLancamentoOmie: number } | null> {
  const doc = (cnpj ?? "").replace(/\D/g, "");
  if (!doc) return null;
  let pagina = 1;
  let total = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const matches: any[] = [];
  do {
    const { data, notFound } = await omieCall(CONTAPAGAR_URL, "ListarContasPagar", appKey, appSecret, {
      pagina,
      registros_por_pagina: 200,
      filtrar_por_cpf_cnpj: doc,
      filtrar_por_status: "EMABERTO",
    });
    if (notFound) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (data.conta_pagar_cadastro as any[] | undefined) ?? [];
    for (const t of arr) {
      if (cents(Number(t.valor_documento)) === cents(valor)) matches.push(t);
    }
    total = Number(data.total_de_paginas ?? 1);
    pagina += 1;
  } while (pagina <= total);
  if (matches.length === 0) return null;
  const preferred = matches.find((t) => t.id_origem === "NFEP") ?? matches[0];
  return { codigoLancamentoOmie: Number(preferred.codigo_lancamento_omie) };
}

export interface ContaPagarPayload {
  codigo_lancamento_integracao: string;
  codigo_cliente_fornecedor: number;
  data_vencimento: string;
  data_previsao: string;
  data_emissao: string;
  valor_documento: number;
  codigo_categoria: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  distribuicao: any[];
  id_conta_corrente: number;
  observacao?: string;
  numero_documento?: string;
  numero_documento_fiscal?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cnab_integracao_bancaria?: any;
}

export async function incluirContaPagar(
  appKey: string,
  appSecret: string,
  payload: ContaPagarPayload,
): Promise<{ codigoLancamentoOmie: number }> {
  const { data } = await omieCall(CONTAPAGAR_URL, "IncluirContaPagar", appKey, appSecret, payload as unknown as Record<string, unknown>);
  const code = Number(data.codigo_lancamento_omie);
  if (!code) throw new Error("Omie não retornou codigo_lancamento_omie ao incluir conta a pagar.");
  return { codigoLancamentoOmie: code };
}

export async function alterarContaPagarCategoria(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
  codigoCategoria: string,
): Promise<void> {
  await omieCall(CONTAPAGAR_URL, "AlterarContaPagar", appKey, appSecret, {
    codigo_lancamento_omie: codigoLancamentoOmie,
    codigo_categoria: codigoCategoria,
  });
}

// dd/mm/aaaa a partir de 'YYYY-MM-DD'
export function toOmieDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
