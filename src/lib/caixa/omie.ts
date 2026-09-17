// Integração Omie do módulo Caixa. Duas chamadas distintas:
//
//   • cadastro das contas → geral/contacorrente/ · ListarContasCorrentes
//     (1 chamada por EMPRESA — traz banco, agência, conta, tipo)
//   • saldo de cada conta → financas/extrato/ · ListarExtrato
//     (1 chamada por CONTA — é o que domina o tempo da varredura)
//
// Medido em produção (17/09/2026): ~2,4s por conta, bem acima dos 350ms do
// rate-limit — a própria chamada da Omie é lenta. Por isso toda a varredura é
// feita com um relógio de rate-limit POR EMPRESA (`lastRequestRef` do
// omieCall): o limite da Omie é por app_key, então N empresas correm em
// paralelo sem nenhuma estourar o intervalo. Serializado, o grupo inteiro
// passaria dos 300s de teto da Vercel.

import { omieCall } from "@/lib/omie/client";

const CONTAS_URL = "https://app.omie.com.br/api/v1/geral/contacorrente/";
const EXTRATO_URL = "https://app.omie.com.br/api/v1/financas/extrato/";

/** Cria o relógio de rate-limit de uma empresa. Um por app_key. */
export function newOmieClock(): { value: number } {
  return { value: 0 };
}

export interface OmieContaCorrente {
  omieCcId: string;
  descricao: string;
  tipo: string | null;
  bancoCodigo: string | null;
  agencia: string | null;
  conta: string | null;
  ativo: boolean;
}

/**
 * Cadastro completo das contas correntes da empresa.
 *
 * Usa a `ListarContasCorrentes` (completa), não a `ListarResumoContasCorrentes`
 * de @/lib/omie/cadastros: só a completa traz `codigo_banco`, `codigo_agencia`
 * e `numero_conta_corrente`, que viram colunas da tela.
 *
 * NÃO filtra por ativo: precisamos ver as inativas para marcá-las como tal em
 * caixa_accounts (conta que some do cadastro nunca é apagada — o histórico de
 * saldo dela continua sendo um fato).
 */
export async function listOmieContasCorrentes(
  appKey: string,
  appSecret: string,
  clock: { value: number },
): Promise<OmieContaCorrente[]> {
  const out: OmieContaCorrente[] = [];
  let pagina = 1;
  let totalPaginas = 1;

  do {
    const { data, notFound } = await omieCall(
      CONTAS_URL,
      "ListarContasCorrentes",
      appKey,
      appSecret,
      { pagina, registros_por_pagina: 200, apenas_importado_api: "N" },
      { lastRequestRef: clock },
    );
    if (notFound) break;

    const lista = (data.ListarContasCorrentes ?? []) as Array<Record<string, unknown>>;
    for (const item of lista) {
      const omieCcId = String(item.nCodCC ?? "").trim();
      if (!omieCcId) continue;
      out.push({
        omieCcId,
        descricao: String(item.descricao ?? "").trim(),
        tipo: str(item.tipo_conta_corrente),
        bancoCodigo: str(item.codigo_banco),
        agencia: str(item.codigo_agencia),
        conta: str(item.numero_conta_corrente),
        // A Omie marca baixa com `inativo = "S"`; qualquer outro valor é ativa.
        ativo: item.inativo !== "S",
      });
    }

    totalPaginas = Number(data.total_de_paginas ?? 1);
    pagina += 1;
  } while (pagina <= totalPaginas);

  return out;
}

export interface OmieSaldo {
  saldo: number;
  saldoDisponivel: number | null;
  saldoConciliado: number | null;
}

/**
 * Saldo de UMA conta corrente, hoje.
 *
 * ⚠️ `nSaldoAtual` é o saldo ao FIM DO PERÍODO PEDIDO, não "o saldo de agora".
 * Conferido contra a Omie em 17/09/2026 (scripts/caixa-omie-probe.ts): a mesma
 * conta devolveu 11.960,67 pedindo 18/08→18/08 e 7.445,80 pedindo até hoje.
 * Por isso `dPeriodoFinal` é SEMPRE hoje. Se alguém alargar o período achando
 * que mexe só no tamanho do payload, o saldo da tela vira histórico sem que
 * nada quebre nem avise.
 *
 * A janela hoje→hoje é também a mais barata: traz só os movimentos do dia (3
 * contra 66 numa janela de 30 dias, na mesma conta).
 *
 * @param hojeBR dia de hoje em Brasília, 'YYYY-MM-DD' (de todayBR()).
 */
export async function fetchOmieSaldo(
  appKey: string,
  appSecret: string,
  omieCcId: string,
  hojeBR: string,
  clock: { value: number },
): Promise<OmieSaldo | null> {
  const dia = toOmieDate(hojeBR);
  const { data, notFound } = await omieCall(
    EXTRATO_URL,
    "ListarExtrato",
    appKey,
    appSecret,
    { nCodCC: Number(omieCcId), dPeriodoInicial: dia, dPeriodoFinal: dia },
    { lastRequestRef: clock },
  );
  // Conta sem nenhum movimento na história devolve "não encontrado". Não é
  // erro — é saldo zero — mas também não é um número que a Omie confirmou,
  // então devolvemos null e a linha fica "nunca capturado" em vez de mentir 0.
  if (notFound) return null;

  const saldo = num(data.nSaldoAtual);
  if (saldo === null) return null;

  return {
    saldo,
    saldoDisponivel: num(data.nSaldoDisponivel),
    saldoConciliado: num(data.nSaldoConciliado),
  };
}

/** 'YYYY-MM-DD' → 'DD/MM/YYYY', o formato que a Omie espera. */
function toOmieDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
