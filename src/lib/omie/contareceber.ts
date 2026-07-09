import { omieCall } from "@/lib/omie/client";

// Contas a receber do Omie. Espelha contapagar.ts — a API IncluirContaReceber
// tem o mesmo formato de payload do IncluirContaPagar, com
// codigo_cliente_fornecedor apontando para o CLIENTE (contratante).
const CONTARECEBER_URL = "https://app.omie.com.br/api/v1/financas/contareceber/";

export interface ContaReceberPayload {
  codigo_lancamento_integracao: string;
  codigo_cliente_fornecedor: number;
  data_vencimento: string;
  data_previsao: string;
  data_emissao: string;
  valor_documento: number;
  codigo_categoria: string;
  id_conta_corrente: number;
  observacao?: string;
  numero_documento?: string;
  numero_parcela?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  distribuicao?: any[];
}

export async function incluirContaReceber(
  appKey: string,
  appSecret: string,
  payload: ContaReceberPayload,
): Promise<{ codigoLancamentoOmie: number }> {
  const { data } = await omieCall(
    CONTARECEBER_URL,
    "IncluirContaReceber",
    appKey,
    appSecret,
    payload as unknown as Record<string, unknown>,
  );
  const code = Number(data.codigo_lancamento_omie);
  if (!code) throw new Error("Omie não retornou codigo_lancamento_omie ao incluir conta a receber.");
  return { codigoLancamentoOmie: code };
}

export interface OmieCategoriaRateio {
  codigo_categoria: string;
  /** Valor absoluto em reais (exato — evita a imprecisão do percentual). */
  valor?: number;
  percentual?: number;
}

/**
 * Reclassifica um título a receber por rateio de categorias.
 * valor_documento é obrigatório. Usamos `valor` absoluto para o rateio fechar
 * exatamente no BV (percentual de 2 casas não bate em valores quebrados).
 */
export async function alterarContaReceberCategorias(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
  valorDocumento: number,
  categorias: OmieCategoriaRateio[],
): Promise<void> {
  await omieCall(CONTARECEBER_URL, "AlterarContaReceber", appKey, appSecret, {
    codigo_lancamento_omie: codigoLancamentoOmie,
    valor_documento: valorDocumento,
    categorias,
  });
}

/** Lê as categorias atualmente aplicadas num título a receber (para conferência). */
export async function consultarContaReceberCategorias(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
): Promise<Array<{ codigo_categoria: string; valor: number; percentual: number }>> {
  const { data } = await omieCall(CONTARECEBER_URL, "ConsultarContaReceber", appKey, appSecret, {
    codigo_lancamento_omie: codigoLancamentoOmie,
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const arr = (data.categorias as any[] | undefined) ?? [];
  return arr.map((c) => ({
    codigo_categoria: String(c.codigo_categoria ?? ""),
    valor: Number(c.valor ?? 0),
    percentual: Number(c.percentual ?? 0),
  }));
}

export async function excluirContaReceber(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
): Promise<void> {
  await omieCall(CONTARECEBER_URL, "ExcluirContaReceber", appKey, appSecret, {
    codigo_lancamento_omie: codigoLancamentoOmie,
  });
}
