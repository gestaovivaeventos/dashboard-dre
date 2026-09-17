"use server";

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";
import { decryptSecret } from "@/lib/security/encryption";
import { syncSupplierToOmieUnit } from "@/lib/omie/clientes";
import { toOmieDate } from "@/lib/omie/contapagar";
import { incluirContaReceber } from "@/lib/omie/contareceber";
import { incluirAnexoContaReceber } from "@/lib/omie/anexo";
import { resolveBand } from "@/lib/case/resolve-cadastros";
import { CASE_COMPANY_ID } from "@/lib/case/constants";
import { cents } from "@/lib/case/parcelas";
import type { CaseBandInput, CaseParcelaInput } from "@/lib/case/types";

const ATTACHMENT_BUCKET = "case-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

export interface BvArtisticoInput {
  /** Presente = edição do rascunho. */
  contract_id?: string | null;
  /** Artista que nos deve a comissão — é ele que vai no CR do Omie. */
  band: CaseBandInput;
  event_name: string | null;
  event_date: string | null;
  /** Valor da comissão. Quase sempre digitado: o contrato anexado não o traz. */
  valor_comissao: number;
  /** Uma linha por parcela do recebimento (o padrão é uma só). */
  receber_schedule: CaseParcelaInput[];
  attachment_path: string | null;
  observacao: string | null;
}

type SaveResult = { ok: true; contractId: string; contractNumber: number } | { error: string };

/**
 * Cria/edita um BV artístico. Diferente do contrato de show: não tem cliente,
 * não gera contrato de venda nem vai à ClickSign — o único efeito no Omie é a
 * conta a RECEBER da comissão, lançada contra o cadastro do artista.
 */
export async function salvarBvArtistico(input: BvArtisticoInput): Promise<SaveResult> {
  const ctx = await requireCaseUser();
  const db = await getDb();

  const valor = Number(input.valor_comissao) || 0;
  if (valor <= 0) return { error: "Informe o valor da comissão." };
  if (!input.band?.name?.trim()) return { error: "Informe o artista que vai pagar a comissão." };

  const parcelas = (input.receber_schedule ?? []).filter((p) => p.vencimento && Number(p.valor) > 0);
  if (parcelas.length === 0) return { error: "Informe ao menos uma data de recebimento." };
  const somaCents = parcelas.reduce((a, p) => a + cents(Number(p.valor)), 0);
  if (somaCents !== cents(valor)) {
    return { error: "A soma das parcelas não confere com o valor da comissão." };
  }

  let bandId: string;
  try {
    bandId = await resolveBand(db, input.band, ctx.id, "atracao");
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao salvar o cadastro do artista." };
  }

  const fields = {
    kind: "bv_artistico",
    company_id: CASE_COMPANY_ID,
    client_id: null,
    band_id: bandId,
    event_name: input.event_name,
    event_date: input.event_date,
    // A comissão é receita de serviço/BV — os demais valores do contrato de show
    // não existem aqui e ficam zerados (o CHECK valor_artista <= valor_atracao_cliente
    // continua valendo com 0 e 0).
    valor_artista: 0,
    valor_atracao_cliente: 0,
    valor_servicos: valor,
    valor_custodia: 0,
    valor_margem: valor,
    receber_schedule: parcelas,
    attachment_path: input.attachment_path,
    observacao: input.observacao,
    updated_at: new Date().toISOString(),
  };

  let contractId = input.contract_id ?? null;
  let contractNumber: number;
  if (contractId) {
    const { data: atual } = await db
      .from("case_contracts")
      .select("id, contract_number, kind, status")
      .eq("id", contractId)
      .maybeSingle();
    if (!atual || atual.kind !== "bv_artistico") return { error: "BV artístico não encontrado." };
    if (atual.status !== "rascunho") {
      return { error: "Este BV já foi lançado no Omie — não dá para editar os valores." };
    }
    await db.from("case_contracts").update(fields).eq("id", contractId);
    contractNumber = Number(atual.contract_number);
  } else {
    const { data: criado, error } = await db
      .from("case_contracts")
      .insert({ ...fields, status: "rascunho", created_by: ctx.id })
      .select("id, contract_number")
      .single();
    if (error || !criado) return { error: `Falha ao salvar o BV: ${error?.message ?? "?"}` };
    contractId = criado.id as string;
    contractNumber = Number(criado.contract_number);
  }

  const gerado = await gerarTitulosBv(db, contractId!, contractNumber, parcelas);
  if ("error" in gerado) return gerado;

  await db.from("case_history").insert({
    contract_id: contractId,
    user_id: ctx.id,
    action: input.contract_id ? "editado" : "criado",
    comment: `BV artístico — comissão de R$ ${valor.toFixed(2)}`,
  });

  revalidatePath("/case/contratos");
  return { ok: true, contractId: contractId!, contractNumber };
}

/** Títulos do BV: uma conta a receber por parcela, sempre leg receber_servicos. */
async function gerarTitulosBv(
  db: DB,
  contractId: string,
  contractNumber: number,
  parcelas: CaseParcelaInput[],
): Promise<{ ok: true } | { error: string }> {
  // Rascunho: nenhum título foi ao Omie ainda, então regerar é seguro.
  await db.from("case_titles").delete().eq("contract_id", contractId).is("omie_codigo", null);
  const rows = parcelas.map((p, i) => ({
    contract_id: contractId,
    leg: "receber_servicos",
    title_item: "margem",
    parcela_numero: i + 1,
    parcela_total: parcelas.length,
    vencimento: p.vencimento,
    valor: Number(p.valor),
    codigo_integracao: `case-bv-${contractNumber}-${i + 1}`,
    status: "pendente",
  }));
  const { error } = await db.from("case_titles").insert(rows);
  if (error) return { error: `Falha ao gerar os títulos: ${error.message}` };
  return { ok: true };
}

type LaunchResult = { ok: true; status: "lancado" | "parcial" | "erro" } | { error: string };

/**
 * Lança no Omie a conta a receber da comissão. O parceiro do título é o
 * ARTISTA (mesmo cadastro que serve de fornecedor nos contratos de show — no
 * Omie o cadastro é único), e a categoria é a de serviços/BV.
 */
export async function lancarBvArtistico(contractId: string): Promise<LaunchResult> {
  await requireCaseUser();
  const db = await getDb();

  const { data: contract } = await db
    .from("case_contracts")
    .select("id, contract_number, kind, company_id, band_id, attachment_path, event_name")
    .eq("id", contractId)
    .maybeSingle();
  if (!contract || contract.kind !== "bv_artistico") return { error: "BV artístico não encontrado." };

  const [{ data: band }, { data: company }, { data: config }, { data: titles }] = await Promise.all([
    db.from("case_bands").select("*").eq("id", contract.band_id).single(),
    db.from("companies").select("omie_app_key, omie_app_secret").eq("id", contract.company_id).single(),
    db
      .from("case_omie_config")
      .select("codigo_categoria_servicos, codigo_conta_corrente")
      .eq("company_id", contract.company_id)
      .maybeSingle(),
    db
      .from("case_titles")
      .select("id, parcela_numero, parcela_total, vencimento, valor, codigo_integracao, status, omie_codigo")
      .eq("contract_id", contractId)
      .order("parcela_numero"),
  ]);

  if (!band) return { error: "Cadastro do artista não encontrado." };
  if (!(band.cnpj_cpf ?? "").replace(/\D/g, "") && !band.omie_codigo) {
    return { error: `Informe o CNPJ ou CPF de "${band.name}" — o Omie precisa do documento para emitir o título.` };
  }
  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Credenciais Omie da Case não configuradas." };
  }
  if (!config?.codigo_categoria_servicos || !config?.codigo_conta_corrente) {
    return { error: "Configuração Omie incompleta: mapeie a categoria de serviços/BV e a conta corrente." };
  }

  const appKey = decryptSecret(company.omie_app_key as string);
  const appSecret = decryptSecret(company.omie_app_secret as string);

  let codigoParceiro = band.omie_codigo ? Number(band.omie_codigo) : null;
  if (!codigoParceiro) {
    try {
      const { codigoCliente } = await syncSupplierToOmieUnit(appKey, appSecret, {
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
      });
      codigoParceiro = codigoCliente;
      await db
        .from("case_bands")
        .update({ omie_codigo: codigoCliente, omie_synced_at: new Date().toISOString() })
        .eq("id", band.id);
    } catch (e) {
      return { error: `Falha ao cadastrar o artista no Omie: ${e instanceof Error ? e.message : e}` };
    }
  }

  const pendentes = (titles ?? []).filter((t) => !t.omie_codigo);
  let erros = 0;
  let primeiro = true;
  for (const t of pendentes) {
    const venc = toOmieDate(t.vencimento);
    const observacao = `BV artístico ${band.name}${contract.event_name ? ` — ${contract.event_name}` : ""} (parcela ${t.parcela_numero}/${t.parcela_total})`;
    try {
      const { codigoLancamentoOmie } = await incluirContaReceber(appKey, appSecret, {
        codigo_lancamento_integracao: t.codigo_integracao,
        codigo_cliente_fornecedor: codigoParceiro!,
        data_vencimento: venc,
        data_previsao: venc,
        data_emissao: venc,
        valor_documento: Number(t.valor),
        codigo_categoria: String(config.codigo_categoria_servicos),
        id_conta_corrente: Number(config.codigo_conta_corrente),
        observacao,
        numero_documento: `CASE-BV-${contract.contract_number}-${t.parcela_numero}`.slice(0, 20),
        numero_parcela: `${t.parcela_numero}/${t.parcela_total}`,
      });
      await db
        .from("case_titles")
        .update({
          omie_codigo: codigoLancamentoOmie,
          status: "lancado",
          launch_error: null,
          launched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", t.id);
      // O contrato do artista vai anexado ao primeiro título — é a prova do BV.
      if (primeiro) {
        primeiro = false;
        await anexarContrato(db, appKey, appSecret, codigoLancamentoOmie, contract.attachment_path);
      }
    } catch (e) {
      erros += 1;
      await db
        .from("case_titles")
        .update({
          status: "erro",
          launch_error: e instanceof Error ? e.message : String(e),
          updated_at: new Date().toISOString(),
        })
        .eq("id", t.id);
    }
  }

  const { data: depois } = await db.from("case_titles").select("status").eq("contract_id", contractId);
  const todos = depois ?? [];
  const lancados = todos.filter((t) => t.status === "lancado").length;
  const status: "lancado" | "parcial" | "erro" =
    lancados === todos.length && todos.length > 0 ? "lancado" : lancados > 0 ? "parcial" : "erro";

  await db
    .from("case_contracts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", contractId);
  await db.from("case_history").insert({
    contract_id: contractId,
    user_id: null,
    action: erros > 0 ? "erro" : "lancado",
    comment: erros > 0 ? `BV artístico com ${erros} título(s) em erro` : "BV artístico lançado no Omie",
  });

  revalidatePath("/case/contratos");
  revalidatePath(`/case/contratos/${contractId}`);
  return { ok: true, status };
}

async function anexarContrato(
  db: DB,
  appKey: string,
  appSecret: string,
  codigo: number,
  path: string | null | undefined,
) {
  if (!path) return;
  try {
    const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).download(path);
    if (error || !data) return;
    const bytes = Buffer.from(await data.arrayBuffer());
    const fileName = (path.split("/").pop() ?? "contrato").replace(/^\d+-/, "");
    await incluirAnexoContaReceber(appKey, appSecret, codigo, fileName, bytes);
  } catch (e) {
    console.error("[case/bv] falha ao anexar o contrato no Omie:", e);
  }
}
