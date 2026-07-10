"use server";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCaseUser } from "@/lib/case/auth";

const ATTACHMENT_BUCKET = "case-attachments";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DB = SupabaseClient<any>;

async function getDb(): Promise<DB> {
  return (createAdminClientIfAvailable() as DB | null) ?? ((await createClient()) as DB);
}

/** Gera URL assinada (5 min) de um PDF do contrato (artista ou venda). */
async function signedUrlFor(
  contractId: string,
  column: "attachment_path" | "sale_contract_path",
): Promise<{ url: string } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();
  const { data: contract } = await db
    .from("case_contracts")
    .select(column)
    .eq("id", contractId)
    .single();
  const path = (contract as Record<string, string | null> | null)?.[column];
  if (!path) return { error: "Arquivo não disponível." };
  const { data, error } = await db.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, 60 * 5);
  if (error || !data?.signedUrl) return { error: "Falha ao gerar link do arquivo." };
  return { url: data.signedUrl };
}

/** URL do contrato do artista (anexo original). */
export async function getContractAttachmentUrl(contractId: string) {
  return signedUrlFor(contractId, "attachment_path");
}

/** URL do contrato de venda gerado. */
export async function getSaleContractUrl(contractId: string) {
  return signedUrlFor(contractId, "sale_contract_path");
}

export interface TituloComprovantes {
  titleId: string;
  descricao: string;
  anexos: Array<{ nome: string; url: string }>;
}

/**
 * Comprovantes (anexos) dos títulos de um contrato, direto do Omie. Resolvido
 * sob demanda (Omie limita a 350ms/chamada) — só para títulos já lançados.
 * pagar_custodia → conta-pagar; receber_* → conta-receber.
 */
export async function getContratoComprovantes(
  contractId: string,
): Promise<{ titulos: TituloComprovantes[] } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();

  const { data: titles } = await db
    .from("case_titles")
    .select("id, leg, title_item, omie_codigo")
    .eq("contract_id", contractId)
    .not("omie_codigo", "is", null)
    .order("leg");
  const rows = (titles ?? []) as Array<{ id: string; leg: string; title_item: string | null; omie_codigo: number }>;
  if (rows.length === 0) return { titulos: [] };

  const { getCaseOmieCreds } = await import("@/lib/case/omie-creds");
  const { listarAnexos, obterAnexoLink } = await import("@/lib/omie/anexo");
  const creds = await getCaseOmieCreds(db);
  if (!creds) return { error: "Empresa Case Shows sem credenciais Omie." };

  const legLabel: Record<string, string> = {
    pagar_custodia: "A pagar — Custódia (artista)",
    receber_custodia: "A receber — Custódia",
    receber_servicos: "A receber — Serviços/BV",
  };

  const titulos: TituloComprovantes[] = [];
  for (const t of rows) {
    const cTabela = t.leg === "pagar_custodia" ? "conta-pagar" : "conta-receber";
    const anexosOmie = await listarAnexos(creds.appKey, creds.appSecret, cTabela, Number(t.omie_codigo));
    const anexos: Array<{ nome: string; url: string }> = [];
    for (const a of anexosOmie) {
      const url = await obterAnexoLink(creds.appKey, creds.appSecret, cTabela, Number(t.omie_codigo), a.nIdAnexo);
      if (url) anexos.push({ nome: a.nome, url });
    }
    if (anexos.length > 0) {
      titulos.push({ titleId: t.id, descricao: legLabel[t.leg] ?? t.leg, anexos });
    }
  }
  return { titulos };
}

/** Reenvia o e-mail de assinatura ClickSign para o cliente. */
export async function resendSignature(
  contractId: string,
): Promise<{ ok: true } | { error: string }> {
  await requireCaseUser();
  const db = await getDb();
  const { data: contract } = await db
    .from("case_contracts")
    .select("clicksign_request_key")
    .eq("id", contractId)
    .single();
  const requestKey = (contract as { clicksign_request_key: string | null } | null)?.clicksign_request_key;
  if (!requestKey) return { error: "Contrato sem pedido de assinatura ativo." };
  try {
    const { resendNotification } = await import("@/lib/case/clicksign");
    await resendNotification(requestKey, "Lembrete: seu contrato aguarda assinatura.");
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha ao reenviar assinatura." };
  }
}
