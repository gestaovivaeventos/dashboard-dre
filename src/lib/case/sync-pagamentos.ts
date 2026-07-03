import type { SupabaseClient } from "@supabase/supabase-js";

import { listContasStatus, type ContaStatus } from "@/lib/omie/contas-status";
import { getCaseOmieCreds } from "@/lib/case/omie-creds";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

export interface CasePagamentosSyncResult {
  skipped?: string;
  atualizados: number;
  pagos: number;
}

interface TitleRow {
  id: string;
  leg: string;
  omie_codigo: number | string | null;
  pago: boolean | null;
  omie_status: string | null;
}

/**
 * Espelha o status de pagamento (pago/omie_status/pago_em) dos títulos já
 * lançados no Omie da Case. Match POR LEG: pagar_custodia → contas a pagar; as
 * demais (receber_*) → contas a receber (o codigo_lancamento_omie é único só
 * dentro de cada módulo). Só grava quando algo mudou.
 */
export async function syncCasePagamentosFromOmie(db: DB): Promise<CasePagamentosSyncResult> {
  const creds = await getCaseOmieCreds(db);
  if (!creds) return { skipped: "Empresa Case Shows sem credenciais Omie.", atualizados: 0, pagos: 0 };

  const { data: titles } = await db
    .from("case_titles")
    .select("id, leg, omie_codigo, pago, omie_status")
    .not("omie_codigo", "is", null);
  const rows = (titles ?? []) as TitleRow[];
  if (rows.length === 0) return { atualizados: 0, pagos: 0 };

  const [pagar, receber] = await Promise.all([
    listContasStatus(creds.appKey, creds.appSecret, "pagar"),
    listContasStatus(creds.appKey, creds.appSecret, "receber"),
  ]);
  const toMap = (arr: ContaStatus[]) => new Map(arr.map((c) => [c.omieCodigo, c]));
  const mapPagar = toMap(pagar);
  const mapReceber = toMap(receber);

  let atualizados = 0;
  let pagos = 0;
  const now = new Date().toISOString();

  for (const t of rows) {
    const code = Number(t.omie_codigo);
    if (!code) continue;
    const st = (t.leg === "pagar_custodia" ? mapPagar : mapReceber).get(code);
    if (!st) continue;
    const pagoNovo = st.pago;
    const statusNovo = st.statusTitulo || null;
    if (Boolean(t.pago) === pagoNovo && (t.omie_status ?? null) === statusNovo) continue;
    await db
      .from("case_titles")
      .update({
        pago: pagoNovo,
        omie_status: statusNovo,
        pago_em: pagoNovo ? (st.pagoEm ? `${st.pagoEm}T00:00:00Z` : now) : null,
        updated_at: now,
      })
      .eq("id", t.id);
    atualizados += 1;
    if (pagoNovo && !t.pago) pagos += 1;
  }

  return { atualizados, pagos };
}
