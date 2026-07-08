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
  clienteRowToOmieData,
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
  title_item: string | null;
  parcela_numero: number;
  parcela_total: number;
  vencimento: string;
  valor: number;
  codigo_integracao: string;
  status: string;
  atracao_id: string | null;
  fornecedor_id: string | null;
}

interface BandInfo {
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
  omie_codigo: number | null;
}

interface AtracaoInfo {
  id: string;
  attachment_path: string | null;
  band: BandInfo;
}

const SERVICO_LABEL: Record<string, string> = {
  margem: "Comissão/BV",
  rider: "Rider",
  camarim: "Camarim",
  extras: "Extras",
};

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
export async function launchContractToOmie(
  db: DB,
  contractId: string,
  legs?: CaseLegKind[],
): Promise<LaunchResult> {
  // legs undefined = todos (comportamento atual). Passar legs restringe o
  // lançamento a essas pernas — Etapa 2 lança pagar_custodia + a-receber;
  // permite disparos independentes por etapa.
  const needsBand = !legs || legs.includes("pagar_custodia");
  const needsClient = !legs || legs.some((l) => l !== "pagar_custodia");
  const { data: contract, error: cErr } = await db
    .from("case_contracts")
    .select(
      "id, contract_number, company_id, attachment_path, client_id, band_id, valor_artista, valor_servicos, atracoes_confirmadas_at",
    )
    .eq("id", contractId)
    .single();
  if (cErr || !contract) return { error: "Contrato não encontrado." };
  // Gate do BV: só lança com o conjunto de atrações confirmado como completo
  // (senão a margem sai errada e trava assim no Omie).
  if (!contract.atracoes_confirmadas_at) {
    return { error: "Confirme na aba Contrato Atração que todos os contratos de artista já foram anexados antes de lançar no Omie." };
  }

  const [{ data: client }, { data: atracoesData }, { data: fornecedoresData }, { data: company }, { data: config }] = await Promise.all([
    db.from("case_clients").select("*").eq("id", contract.client_id).single(),
    db
      .from("case_contract_atracoes")
      .select("id, attachment_path, case_bands(id, name, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, omie_codigo)")
      .eq("contract_id", contractId)
      .order("created_at"),
    db
      .from("case_contract_fornecedores")
      .select("id, attachment_path, descricao, case_bands(id, name, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, omie_codigo)")
      .eq("contract_id", contractId)
      .order("created_at"),
    db.from("companies").select("id, omie_app_key, omie_app_secret").eq("id", contract.company_id).single(),
    db.from("case_omie_config").select("*").eq("company_id", contract.company_id).maybeSingle(),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const atracoes: AtracaoInfo[] = ((atracoesData ?? []) as any[])
    .filter((a) => a.case_bands)
    .map((a) => ({ id: a.id, attachment_path: a.attachment_path, band: a.case_bands }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fornecedores: AtracaoInfo[] = ((fornecedoresData ?? []) as any[])
    .filter((f) => f.case_bands)
    .map((f) => ({ id: f.id, attachment_path: f.attachment_path, band: f.case_bands }));

  if (!client || (needsBand && atracoes.length === 0)) {
    return markContractError(db, contractId, "Cliente ou atrações não encontrados.");
  }

  // Pré-check: o Omie exige CNPJ/CPF para cadastrar. Aponta QUEM está sem
  // documento antes de qualquer chamada (cadastros com omie_codigo já passaram).
  const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const semDoc: string[] = [];
  // Cliente sem CNPJ pode lançar como PF do responsável legal (CPF) — fundo vira nome fantasia.
  if (needsClient && !client.omie_codigo && !digits(client.cnpj_cpf) && !digits(client.cpf_resp_legal)) {
    semDoc.push(`cliente "${client.name}" (informe o CNPJ ou o CPF do responsável legal)`);
  }
  if (needsBand) {
    for (const a of atracoes) if (!a.band.omie_codigo && !digits(a.band.cnpj_cpf)) semDoc.push(`atração "${a.band.name}"`);
    for (const f of fornecedores) if (!f.band.omie_codigo && !digits(f.band.cnpj_cpf)) semDoc.push(`fornecedor "${f.band.name}"`);
  }
  if (semDoc.length > 0) {
    return { error: `Cadastro sem CNPJ/CPF: ${semDoc.join(", ")}. Complete o documento no cadastro (Editar cadastro do cliente) antes de lançar no Omie.` };
  }
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
  // Cada atração e cada fornecedor da verba tem cadastro próprio nos títulos a pagar.
  const bandCodigoByEntidade = new Map<string, number>();
  let clientCodigo = client.omie_codigo ? Number(client.omie_codigo) : null;

  try {
    if (needsBand) {
      for (const a of [...atracoes, ...fornecedores]) {
        let codigo = a.band.omie_codigo ? Number(a.band.omie_codigo) : null;
        if (!codigo) {
          const bandData: OmieSupplierData = {
            id: a.band.id,
            name: a.band.name,
            cnpj_cpf: a.band.cnpj_cpf,
            email: a.band.email,
            phone: a.band.phone,
            banco: a.band.banco,
            agencia: a.band.agencia,
            conta_corrente: a.band.conta_corrente,
            titular_banco: a.band.titular_banco,
            doc_titular: a.band.doc_titular,
            chave_pix: a.band.chave_pix,
          };
          const { codigoCliente } = await syncSupplierToOmieUnit(appKey, appSecret, bandData);
          codigo = codigoCliente;
          await db.from("case_bands").update({ omie_codigo: codigo, omie_synced_at: new Date().toISOString() }).eq("id", a.band.id);
        }
        bandCodigoByEntidade.set(a.id, codigo);
      }
    }
    if (needsClient && !clientCodigo) {
      const clientData = clienteRowToOmieData(client);
      if (!clientData) {
        return markContractError(db, contractId, `Cliente "${client.name}" sem CNPJ/CPF — informe o documento ou o CPF do responsável legal.`);
      }
      const { codigoCliente } = await syncClienteToOmieUnit(appKey, appSecret, clientData);
      clientCodigo = codigoCliente;
      await db.from("case_clients").update({ omie_codigo: clientCodigo, omie_synced_at: new Date().toISOString() }).eq("id", client.id);
    }
  } catch (e) {
    return markContractError(db, contractId, e instanceof Error ? e.message : "Falha ao cadastrar cliente/banda no Omie.");
  }

  // ── Lança os títulos pendentes/erro ────────────────────────────────────
  let titlesQuery = db
    .from("case_titles")
    .select("id, leg, title_item, parcela_numero, parcela_total, vencimento, valor, codigo_integracao, status, atracao_id, fornecedor_id")
    .eq("contract_id", contractId)
    .in("status", ["pendente", "erro"]);
  if (legs) titlesQuery = titlesQuery.in("leg", legs);
  const { data: titles } = await titlesQuery.order("leg").order("parcela_numero");

  const rows = (titles ?? []) as TitleRow[];
  const atracaoById = new Map(atracoes.map((a) => [a.id, a]));
  const fornecedorById = new Map(fornecedores.map((f) => [f.id, f]));
  const primeiraAtracao = atracoes[0] ?? null;
  const anexadoPorChave = new Set<string>();
  let anyOk = false;

  for (const t of rows) {
    const isPagar = t.leg === "pagar_custodia";
    const categoria =
      t.leg === "receber_servicos"
        ? String(config.codigo_categoria_servicos)
        : String(config.codigo_categoria_custodia);
    // A pagar: parceiro é o fornecedor da verba (fornecedor_id) ou a banda da
    // atração do título (fallback: 1ª atração).
    const entidade = t.fornecedor_id
      ? fornecedorById.get(t.fornecedor_id) ?? null
      : (t.atracao_id ? atracaoById.get(t.atracao_id) : null) ?? primeiraAtracao;
    if (isPagar && (!entidade || !bandCodigoByEntidade.get(entidade.id))) {
      await db
        .from("case_titles")
        .update({ status: "erro", launch_error: "Atração/fornecedor do título não encontrado/registrado no Omie.", updated_at: new Date().toISOString() })
        .eq("id", t.id);
      continue;
    }
    const codigoParceiro = isPagar ? bandCodigoByEntidade.get(entidade!.id)! : clientCodigo!;
    const venc = toOmieDate(t.vencimento);
    const itemLabel = t.title_item ? ` - ${SERVICO_LABEL[t.title_item] ?? t.title_item}` : "";
    const parceiroNome = isPagar ? entidade!.band.name : (primeiraAtracao?.band.name ?? "atrações");
    const observacao = `Contrato Case ${parceiroNome} x ${client.name}${itemLabel} (parcela ${t.parcela_numero}/${t.parcela_total})`;
    // Limites do Omie: codigo_lancamento_integracao ≤ 60 (títulos antigos podem
    // ter código longo — cai para o id do título, único e estável) e
    // numero_documento ≤ 20 (usa rótulo curto com o nº do contrato).
    const codigoIntegracao = t.codigo_integracao.length <= 60 ? t.codigo_integracao : `case-t-${t.id}`;
    const numeroDocumento = `CASE-${contract.contract_number}-${t.parcela_numero}`.slice(0, 20);

    try {
      let omieCodigo: number;
      if (isPagar) {
        const { codigoLancamentoOmie } = await incluirContaPagar(appKey, appSecret, {
          codigo_lancamento_integracao: codigoIntegracao,
          codigo_cliente_fornecedor: codigoParceiro,
          data_vencimento: venc,
          data_previsao: venc,
          data_emissao: venc,
          valor_documento: Number(t.valor),
          codigo_categoria: categoria,
          distribuicao: [],
          id_conta_corrente: idContaCorrente,
          observacao,
          numero_documento: numeroDocumento,
        });
        omieCodigo = codigoLancamentoOmie;
      } else {
        const { codigoLancamentoOmie } = await incluirContaReceber(appKey, appSecret, {
          codigo_lancamento_integracao: codigoIntegracao,
          codigo_cliente_fornecedor: codigoParceiro,
          data_vencimento: venc,
          data_previsao: venc,
          data_emissao: venc,
          valor_documento: Number(t.valor),
          codigo_categoria: categoria,
          id_conta_corrente: idContaCorrente,
          observacao,
          numero_documento: numeroDocumento,
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

      // Anexo: a pagar recebe o contrato da PRÓPRIA atração/fornecedor (1º título
      // de cada); a receber recebe o anexo do contrato (1º título de cada leg).
      const anexoChave = isPagar ? `pagar-${t.fornecedor_id ? "forn-" : ""}${entidade!.id}` : t.leg;
      if (!anexadoPorChave.has(anexoChave)) {
        anexadoPorChave.add(anexoChave);
        const anexoPath = isPagar ? entidade!.attachment_path : contract.attachment_path;
        await anexar(db, appKey, appSecret, t.leg, omieCodigo, anexoPath);
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
