import { omieCall } from "@/lib/omie/client";

const CONTAPAGAR_URL = "https://app.omie.com.br/api/v1/financas/contapagar/";

const cents = (v: number) => Math.round(v * 100);

// Procura um título de NF de produto (id_origem 'NFEP') do fornecedor (por CNPJ)
// com valor igual, ainda em aberto. SÓ casa com NFEP — títulos de previsão
// recorrente (RPTP), manuais (MANP) etc. NÃO contam como "faturado em compras"
// e não devem ser evoluídos. Sem match NFEP → null (cria lançamento novo).
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
      if (t.id_origem === "NFEP" && cents(Number(t.valor_documento)) === cents(valor)) {
        matches.push(t);
      }
    }
    total = Number(data.total_de_paginas ?? 1);
    pagina += 1;
  } while (pagina <= total);
  if (matches.length === 0) return null;
  return { codigoLancamentoOmie: Number(matches[0].codigo_lancamento_omie) };
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

// Normaliza para casar "previsão"/"PREVISAO"/"Previsao" etc.
function normalize(s: string): string {
  return (s ?? "")
    .toString()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

// Procura a PREVISÃO recorrente do fornecedor para o mês do vencimento da
// requisição: título em aberto, do CNPJ, com a palavra "previsão" na observação
// e vencimento no mesmo mês/ano de `dueDateIso` (YYYY-MM-DD). Havendo vários,
// retorna o de valor mais próximo de `amount`. Sem match → null.
export async function findPrevisaoContaPagar(
  appKey: string,
  appSecret: string,
  cnpj: string,
  dueDateIso: string,
  amount: number,
): Promise<
  | { codigoLancamentoOmie: number; valorAtual: number; vencimento: string; observacao: string }
  | null
> {
  const doc = (cnpj ?? "").replace(/\D/g, "");
  if (!doc) return null;
  const [ano, mes] = dueDateIso.split("-");
  if (!ano || !mes) return null;

  let pagina = 1;
  let total = 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidatos: any[] = [];
  do {
    const { data, notFound } = await omieCall(
      CONTAPAGAR_URL,
      "ListarContasPagar",
      appKey,
      appSecret,
      {
        pagina,
        registros_por_pagina: 200,
        filtrar_por_cpf_cnpj: doc,
        filtrar_por_status: "EMABERTO",
      },
    );
    if (notFound) break;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arr = (data.conta_pagar_cadastro as any[] | undefined) ?? [];
    for (const t of arr) {
      const venc = String(t.data_vencimento ?? ""); // dd/mm/aaaa
      const [, vm, vy] = venc.split("/");
      const mesmoMes = vm === mes && vy === ano;
      const ehPrevisao = normalize(String(t.observacao ?? "")).includes("previsao");
      if (mesmoMes && ehPrevisao) candidatos.push(t);
    }
    total = Number(data.total_de_paginas ?? 1);
    pagina += 1;
  } while (pagina <= total);

  if (candidatos.length === 0) return null;
  candidatos.sort(
    (a, b) =>
      Math.abs(Number(a.valor_documento) - amount) -
      Math.abs(Number(b.valor_documento) - amount),
  );
  const m = candidatos[0];
  return {
    codigoLancamentoOmie: Number(m.codigo_lancamento_omie),
    valorAtual: Number(m.valor_documento),
    vencimento: String(m.data_vencimento ?? ""),
    observacao: String(m.observacao ?? ""),
  };
}

// Edita um título existente (a previsão) sobrescrevendo todos os campos pela
// requisição. `payload` é o mesmo do IncluirContaPagar, sem
// codigo_lancamento_integracao (o título já existe), mais codigo_lancamento_omie.
export async function alterarContaPagar(
  appKey: string,
  appSecret: string,
  payload: Omit<ContaPagarPayload, "codigo_lancamento_integracao"> & {
    codigo_lancamento_omie: number;
  },
): Promise<{ codigoLancamentoOmie: number }> {
  const { data } = await omieCall(
    CONTAPAGAR_URL,
    "AlterarContaPagar",
    appKey,
    appSecret,
    payload as unknown as Record<string, unknown>,
  );
  const code = Number(data.codigo_lancamento_omie ?? payload.codigo_lancamento_omie);
  return { codigoLancamentoOmie: code };
}

// dd/mm/aaaa a partir de 'YYYY-MM-DD'
export function toOmieDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
