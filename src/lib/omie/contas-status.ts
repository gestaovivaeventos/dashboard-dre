import { omieCall } from "@/lib/omie/client";

const CONTAPAGAR_URL = "https://app.omie.com.br/api/v1/financas/contapagar/";
const CONTARECEBER_URL = "https://app.omie.com.br/api/v1/financas/contareceber/";

export type ContaKind = "pagar" | "receber";

export interface ContaStatus {
  omieCodigo: number;
  statusTitulo: string;
  pago: boolean;
  /** ISO YYYY-MM-DD da baixa, quando houver. */
  pagoEm: string | null;
}

/** dd/mm/aaaa → YYYY-MM-DD (formato de data do Omie → ISO). */
function omieDateToIso(v: unknown): string | null {
  const s = String(v ?? "").trim();
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Lê o status de pagamento de TODOS os lançamentos de uma unidade Omie
 * (ListarContasPagar/Receber, paginado). Defensivo quanto aos campos: a Omie
 * varia entre `status_titulo` no topo e dentro de `resumo`, e sinaliza baixa por
 * status, data de baixa ou valor baixado.
 */
export async function listContasStatus(
  appKey: string,
  appSecret: string,
  kind: ContaKind,
  opts: { pageSize?: number; maxPages?: number } = {},
): Promise<ContaStatus[]> {
  const url = kind === "pagar" ? CONTAPAGAR_URL : CONTARECEBER_URL;
  const call = kind === "pagar" ? "ListarContasPagar" : "ListarContasReceber";
  const arrKey = kind === "pagar" ? "conta_pagar_cadastro" : "conta_receber_cadastro";
  const pageSize = opts.pageSize ?? 200;
  const maxPages = opts.maxPages ?? 500;
  const out: ContaStatus[] = [];

  for (let pagina = 1; pagina <= maxPages; pagina++) {
    const res = await omieCall(url, call, appKey, appSecret, {
      pagina,
      registros_por_pagina: pageSize,
    });
    if (res.notFound) break;
    const arr = (res.data[arrKey] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const t of arr) {
      const code = Number(t.codigo_lancamento_omie);
      if (!code) continue;
      const resumo = (t.resumo as Record<string, unknown> | undefined) ?? {};
      const statusTitulo = String(t.status_titulo ?? resumo.status_titulo ?? "").toUpperCase().trim();
      const baixa =
        omieDateToIso(t.data_baixa) ??
        omieDateToIso(resumo.data_baixa) ??
        omieDateToIso(t.data_pagamento) ??
        omieDateToIso(t.data_recebimento);
      const valorDoc = num(t.valor_documento);
      const valorBaixado = num(resumo.valor_baixado ?? t.valor_baixado ?? t.valor_pago);
      const pago =
        /PAGO|RECEB|LIQUID|BAIXAD/.test(statusTitulo) ||
        Boolean(baixa) ||
        (valorDoc > 0 && valorBaixado >= valorDoc);
      out.push({ omieCodigo: code, statusTitulo, pago, pagoEm: pago ? baixa : null });
    }
    if (pagina >= Number(res.data.total_de_paginas ?? 1) || arr.length === 0) break;
  }
  return out;
}
