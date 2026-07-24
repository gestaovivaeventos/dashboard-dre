import { omieCall } from "@/lib/omie/client";

const CONTAPAGAR_URL = "https://app.omie.com.br/api/v1/financas/contapagar/";
const PROJETOS_URL = "https://app.omie.com.br/api/v1/geral/projetos/";

const cents = (v: number) => Math.round(v * 100);

// Normaliza um nome para comparação: minúsculas, sem acento, espaços colapsados
// e aparados nas pontas. Usada para casar o nome do evento (ControlHub) com o
// nome do projeto cadastrado na Omie da empresa.
function normalizeNome(s: string | null | undefined): string {
  return (s ?? "")
    .toString()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Procura um projeto pelo NOME no cadastro de projetos da empresa (ListarProjetos)
// e devolve o código numérico do projeto (nCodProj) — o valor aceito em
// `codigo_projeto` do IncluirContaPagar. Casa por nome normalizado
// (case/acento-insensível). Prefere projeto ATIVO; se só houver homônimo
// inativo, usa-o como fallback. Retorna null quando não existe projeto com esse
// nome (o chamador então lança sem projeto — não criamos projeto na Omie).
export async function findProjetoByNome(
  appKey: string,
  appSecret: string,
  nome: string,
): Promise<number | null> {
  const alvo = normalizeNome(nome);
  if (!alvo) return null;

  let pagina = 1;
  let total = 1;
  let fallbackInativo: number | null = null;
  do {
    const { data, notFound } = await omieCall(
      PROJETOS_URL,
      "ListarProjetos",
      appKey,
      appSecret,
      { pagina, registros_por_pagina: 500 },
    );
    if (notFound) break;
    // A Omie retorna o array de projetos sob `cadastro`; extraímos de forma
    // tolerante (primeiro array do payload) para não depender do nome da chave.
    const arr =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((data.cadastro as any[] | undefined) ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (Object.values(data).find(Array.isArray) as any[] | undefined)) ??
      [];
    for (const p of arr) {
      const nomeProjeto = normalizeNome(String(p.nome ?? p.cNome ?? ""));
      if (nomeProjeto !== alvo) continue;
      const codigo = Number(p.codigo ?? p.nCodProj ?? p.nCodProjeto ?? 0);
      if (!codigo) continue;
      const inativo = String(p.inativo ?? p.cInativo ?? "").toUpperCase() === "S";
      if (!inativo) return codigo;
      if (fallbackInativo === null) fallbackInativo = codigo;
    }
    total = Number(data.total_de_paginas ?? 1);
    pagina += 1;
  } while (pagina <= total);

  return fallbackInativo;
}

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
  // Código numérico do projeto Omie (nCodProj). Vinculado a partir do evento da
  // requisição quando há projeto homônimo na Omie da empresa.
  codigo_projeto?: number;
  observacao?: string;
  numero_documento?: string;
  numero_documento_fiscal?: string;
  numero_pedido?: string;
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

// Vincula um projeto (codigo_projeto) a um título já existente via
// AlterarContaPagar. Usado no caminho "recebido" (título de NF já no Omie),
// para que o projeto do evento também apareça nesses títulos.
export async function alterarContaPagarProjeto(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
  codigoProjeto: number,
): Promise<void> {
  await omieCall(CONTAPAGAR_URL, "AlterarContaPagar", appKey, appSecret, {
    codigo_lancamento_omie: codigoLancamentoOmie,
    codigo_projeto: codigoProjeto,
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
      // Previsão recorrente nativa do Omie (id_origem 'RPTP', cuja observação
      // costuma vir vazia) OU título marcado manualmente com "previsão" na obs.
      const ehPrevisao =
        String(t.id_origem ?? "") === "RPTP" ||
        normalize(String(t.observacao ?? "")).includes("previsao");
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

// Exclui um título (usado para remover a previsão recorrente após criar o
// título real na substituição).
export async function excluirContaPagar(
  appKey: string,
  appSecret: string,
  codigoLancamentoOmie: number,
): Promise<void> {
  await omieCall(CONTAPAGAR_URL, "ExcluirContaPagar", appKey, appSecret, {
    codigo_lancamento_omie: codigoLancamentoOmie,
  });
}

// dd/mm/aaaa a partir de 'YYYY-MM-DD'
export function toOmieDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}
