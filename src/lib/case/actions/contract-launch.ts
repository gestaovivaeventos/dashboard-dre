"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { decryptSecret } from "@/lib/security/encryption";
import {
  syncSupplierToOmieUnit,
  syncClienteToOmieUnit,
  type OmieSupplierData,
} from "@/lib/omie/clientes";
import { incluirContaPagar, toOmieDate } from "@/lib/omie/contapagar";
import { incluirContaReceber } from "@/lib/omie/contareceber";
import { incluirAnexoContaPagar, incluirAnexoContaReceber } from "@/lib/omie/anexo";
import type { CaseLegKind } from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

type LaunchResult = { ok: true; status: "lancado" | "parcial" | "erro" } | { error: string };

interface TitleRow {
  id: string;
  leg: CaseLegKind;
  parcela_numero: number;
  parcela_total: number;
  vencimento: string;
  valor: number;
  codigo_integracao: string;
  status: string;
}

async function markContractError(db: DB, contractId: string, message: string): Promise<LaunchResult> {
  await db.from("case_contracts").update({ status: "erro", updated_at: new Date().toISOString() }).eq("id", contractId);
  await db.from("case_history").insert({
    contract_id: contractId,
    user_id: null,
    action: "erro",
    comment: message,
  });
  return { error: message };
}

async function anexar(
  db: DB,
  appKey: string,
  appSecret: string,
  leg: CaseLegKind,
  codigo: number,
  path: string | null | undefined,
) {
  if (!path) return;
  try {
    const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(path);
    if (error || !data) return;
    const bytes = Buffer.from(await data.arrayBuffer());
    const fileName = (path.split("/").pop() ?? "contrato").replace(/^\d+-/, "");
    if (leg === "pagar_custodia") {
      await incluirAnexoContaPagar(appKey, appSecret, codigo, fileName, bytes);
    } else {
      await incluirAnexoContaReceber(appKey, appSecret, codigo, fileName, bytes);
    }
  } catch (e) {
    console.error("[case] falha ao anexar no Omie:", e);
  }
}

/**
 * Lança o contrato Case no Omie da Case Shows:
 *   • garante cadastro da banda (fornecedor) e do cliente no Omie
 *   • lança cada título pendente/erro (contas a pagar / a receber)
 *   • anexa o PDF do contrato (best-effort) no 1º título de cada leg
 *   • agrega o status do contrato
 * Idempotente: só processa títulos ainda não lançados.
 */
export async function launchContractToOmie(db: DB, contractId: string): Promise<LaunchResult> {
  const { data: contract, error: cErr } = await db
    .from("case_contracts")
    .select(
      "id, company_id, attachment_path, client_id, band_id, valor_artista, valor_servicos",
    )
    .eq("id", contractId)
    .single();
  if (cErr || !contract) return { error: "Contrato não encontrado." };

  const [{ data: client }, { data: band }, { data: company }, { data: config }] = await Promise.all([
    db.from("case_clients").select("*").eq("id", contract.client_id).single(),
    db.from("case_bands").select("*").eq("id", contract.band_id).single(),
    db.from("companies").select("id, omie_app_key, omie_app_secret").eq("id", contract.company_id).single(),
    db.from("case_omie_config").select("*").eq("company_id", contract.company_id).maybeSingle(),
  ]);

  if (!client || !band) return markContractError(db, contractId, "Cliente ou banda não encontrados.");
  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return markContractError(db, contractId, "Empresa Case Shows sem credenciais Omie configuradas.");
  }
  if (!config?.codigo_categoria_custodia || !config?.codigo_categoria_servicos || !config?.codigo_conta_corrente) {
    return markContractError(
      db,
      contractId,
      "Configuração Omie do Case incompleta — mapeie as categorias e a conta corrente em Case › Configuração Omie.",
    );
  }

  let appKey: string;
  let appSecret: string;
  try {
    appKey = decryptSecret(company.omie_app_key);
    appSecret = decryptSecret(company.omie_app_secret);
  } catch {
    return markContractError(db, contractId, "Falha ao descriptografar credenciais Omie da Case Shows.");
  }

  const idContaCorrente = Number(config.codigo_conta_corrente);

  // ── Garante cadastros no Omie ──────────────────────────────────────────
  let bandCodigo = band.omie_codigo ? Number(band.omie_codigo) : null;
  let clientCodigo = client.omie_codigo ? Number(client.omie_codigo) : null;

  try {
    if (!bandCodigo) {
      const bandData: OmieSupplierData = {
        id: band.id,
        name: band.name,
        cnpj_cpf: band.cnpj_cpf,
        email: band.email,
        phone: band.phone,
        banco: band.banco,
        agencia: band.agencia,
        conta_corrente: band.conta_corrente,
        titular_banco: band.titular_banco,
        doc_titular: band.doc_titular,
        chave_pix: band.chave_pix,
      };
      const { codigoCliente } = await syncSupplierToOmieUnit(appKey, appSecret, bandData);
      bandCodigo = codigoCliente;
      await db.from("case_bands").update({ omie_codigo: bandCodigo, omie_synced_at: new Date().toISOString() }).eq("id", band.id);
    }
    if (!clientCodigo) {
      const clientData: OmieSupplierData = {
        id: client.id,
        name: client.name,
        cnpj_cpf: client.cnpj_cpf,
        email: client.email,
        phone: client.phone,
        banco: null,
        agencia: null,
        conta_corrente: null,
        titular_banco: null,
        doc_titular: null,
        chave_pix: null,
      };
      const { codigoCliente } = await syncClienteToOmieUnit(appKey, appSecret, clientData);
      clientCodigo = codigoCliente;
      await db.from("case_clients").update({ omie_codigo: clientCodigo, omie_synced_at: new Date().toISOString() }).eq("id", client.id);
    }
  } catch (e) {
    return markContractError(db, contractId, e instanceof Error ? e.message : "Falha ao cadastrar cliente/banda no Omie.");
  }

  // ── Lança os títulos pendentes/erro ────────────────────────────────────
  const { data: titles } = await db
    .from("case_titles")
    .select("id, leg, parcela_numero, parcela_total, vencimento, valor, codigo_integracao, status")
    .eq("contract_id", contractId)
    .in("status", ["pendente", "erro"])
    .order("leg")
    .order("parcela_numero");

  const rows = (titles ?? []) as TitleRow[];
  const anexadoPorLeg = new Set<CaseLegKind>();
  let anyOk = false;

  for (const t of rows) {
    const isPagar = t.leg === "pagar_custodia";
    const categoria =
      t.leg === "receber_servicos"
        ? String(config.codigo_categoria_servicos)
        : String(config.codigo_categoria_custodia);
    const codigoParceiro = isPagar ? bandCodigo! : clientCodigo!;
    const venc = toOmieDate(t.vencimento);
    const observacao = `Contrato Case ${band.name} x ${client.name} (parcela ${t.parcela_numero}/${t.parcela_total})`;

    try {
      let omieCodigo: number;
      if (isPagar) {
        const { codigoLancamentoOmie } = await incluirContaPagar(appKey, appSecret, {
          codigo_lancamento_integracao: t.codigo_integracao,
          codigo_cliente_fornecedor: codigoParceiro,
          data_vencimento: venc,
          data_previsao: venc,
          data_emissao: venc,
          valor_documento: Number(t.valor),
          codigo_categoria: categoria,
          distribuicao: [],
          id_conta_corrente: idContaCorrente,
          observacao,
          numero_documento: t.codigo_integracao,
        });
        omieCodigo = codigoLancamentoOmie;
      } else {
        const { codigoLancamentoOmie } = await incluirContaReceber(appKey, appSecret, {
          codigo_lancamento_integracao: t.codigo_integracao,
          codigo_cliente_fornecedor: codigoParceiro,
          data_vencimento: venc,
          data_previsao: venc,
          data_emissao: venc,
          valor_documento: Number(t.valor),
          codigo_categoria: categoria,
          id_conta_corrente: idContaCorrente,
          observacao,
          numero_documento: t.codigo_integracao,
          numero_parcela: `${t.parcela_numero}/${t.parcela_total}`,
        });
        omieCodigo = codigoLancamentoOmie;
      }

      await db
        .from("case_titles")
        .update({
          omie_codigo: omieCodigo,
          status: "lancado",
          launch_error: null,
          launched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      anyOk = true;

      if (!anexadoPorLeg.has(t.leg)) {
        anexadoPorLeg.add(t.leg);
        await anexar(db, appKey, appSecret, t.leg, omieCodigo, contract.attachment_path);
      }
    } catch (e) {
      await db
        .from("case_titles")
        .update({
          status: "erro",
          launch_error: e instanceof Error ? e.message : "Erro desconhecido no Omie.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", t.id);
    }
  }

  // ── Status agregado ────────────────────────────────────────────────────
  // Considera o quadro completo dos títulos do contrato (não só os desta rodada).
  const { data: allTitles } = await db
    .from("case_titles")
    .select("status")
    .eq("contract_id", contractId);
  const statuses = (allTitles ?? []).map((t: { status: string }) => t.status);
  const allLancado = statuses.length > 0 && statuses.every((s: string) => s === "lancado");

  const finalStatus: "lancado" | "parcial" | "erro" = allLancado
    ? "lancado"
    : anyOk || statuses.includes("lancado")
      ? "parcial"
      : "erro";

  await db
    .from("case_contracts")
    .update({ status: finalStatus, updated_at: new Date().toISOString() })
    .eq("id", contractId);

  await db.from("case_history").insert({
    contract_id: contractId,
    user_id: null,
    action: finalStatus === "erro" ? "erro" : "lancado",
    comment:
      finalStatus === "lancado"
        ? "Todos os títulos lançados no Omie."
        : finalStatus === "parcial"
          ? "Lançamento parcial — alguns títulos com erro/pendentes."
          : "Falha ao lançar os títulos no Omie.",
  });

  revalidatePath("/case/contratos");
  revalidatePath("/case/dashboard");

  return { ok: true, status: finalStatus };
}

/** Reenvio manual: reprocessa apenas títulos pendentes/erro do contrato. */
export async function resyncContract(contractId: string): Promise<LaunchResult> {
  await requireCaseUser();
  const db = (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
  return launchContractToOmie(db, contractId);
}
