import { normalizeDoc } from "@/lib/ctrl/cnpj";
import type { OmiePartner } from "@/lib/omie/clientes";

// Importação de fornecedores da Omie para o Compras (por empresa). Parte PURA e
// testável: decide QUAIS cadastros entram e monta as linhas. A leitura da Omie e
// a escrita no banco ficam na rota (api/ctrl/suppliers/import-omie).
//
// Regra do dono (07/10/2026): importar SÓ os cadastros marcados como
// "Fornecedor" na Omie — não clientes, prestadores nem transportadoras. Entram
// como `pendente`, para o Contas a Pagar ou um admin homologar (mesmo fluxo do
// cadastro manual). Chave PIX e dados bancários vêm junto (mesma importação da
// Viva).

// Faixa Unicode de marcas combinantes, montada em runtime para manter o source
// ASCII (mesmo padrão de routing.ts).
const COMBINING_DIACRITICS = new RegExp(
  "[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]",
  "g",
);

function normalizeTag(tag: string): string {
  return tag.normalize("NFD").replace(COMBINING_DIACRITICS, "").trim().toLowerCase();
}

/** True quando o cadastro da Omie está marcado como Fornecedor (ignora acento/caixa). */
export function isFornecedorTag(tags: string[]): boolean {
  return tags.some((t) => normalizeTag(t) === "fornecedor");
}

/** Uma linha de `ctrl_suppliers` pronta para inserir (espelha o que a Viva importou). */
export interface SupplierImportRow {
  org_id: string;
  from_omie: true;
  // Fornecedor vindo da Omie JÁ existe lá — não precisa ser reenviado. O `omie_id`
  // é o que deixa `syncSupplierToOmieUnit` reaproveitar o cadastro na homologação.
  omie_sync_required: false;
  omie_id: number;
  name: string;
  cnpj_cpf: string | null;
  email: string | null;
  phone: string | null;
  // Regras de pagamento copiadas da Omie (pedido do dono): PIX + dados bancários.
  chave_pix: string | null;
  banco: string | null;
  agencia: string | null;
  conta_corrente: string | null;
  titular_banco: string | null;
  doc_titular: string | null;
  transf_padrao: boolean;
  status: "pendente";
  created_by: string;
}

export interface PlanResult {
  rows: SupplierImportRow[];
  /** Quantos cadastros marcados como Fornecedor foram encontrados na Omie. */
  fornecedorCount: number;
  /** Quantos Fornecedores já estavam cadastrados na empresa (não reimportados). */
  skippedExisting: number;
}

/**
 * Decide o que importar a partir dos cadastros lidos da Omie.
 *
 * - Só os marcados como Fornecedor.
 * - Dedup DENTRO da empresa: por documento normalizado (a mesma normalização do
 *   índice único `ctrl_suppliers_doc_norm_unique`), e por `omie_id` para os sem
 *   documento (estrangeiro). Confere contra o que já existe E contra a própria
 *   lista (a Omie pode ter o mesmo documento em dois CNPJs da empresa).
 */
export function planSupplierImport(
  partners: OmiePartner[],
  opts: {
    orgId: string;
    createdBy: string;
    existingDocs: Set<string>;
    existingOmieIds: Set<string>;
  },
): PlanResult {
  const rows: SupplierImportRow[] = [];
  const seenDocs = new Set(opts.existingDocs);
  const seenOmie = new Set(opts.existingOmieIds);
  let fornecedorCount = 0;
  let skippedExisting = 0;

  for (const p of partners) {
    if (!isFornecedorTag(p.tags)) continue;
    fornecedorCount += 1;

    const doc = p.cnpj_cpf ? normalizeDoc(p.cnpj_cpf) : "";
    const omieKey = String(p.omie_codigo);

    if (doc) {
      if (seenDocs.has(doc)) {
        skippedExisting += 1;
        continue;
      }
      seenDocs.add(doc);
    } else {
      // Sem documento (estrangeiro): o único identificador estável é o código Omie.
      if (seenOmie.has(omieKey)) {
        skippedExisting += 1;
        continue;
      }
      seenOmie.add(omieKey);
    }

    rows.push({
      org_id: opts.orgId,
      from_omie: true,
      omie_sync_required: false,
      omie_id: p.omie_codigo,
      name: p.name,
      cnpj_cpf: p.cnpj_cpf,
      email: p.email,
      phone: p.phone,
      chave_pix: p.chave_pix,
      banco: p.banco,
      agencia: p.agencia,
      conta_corrente: p.conta_corrente,
      titular_banco: p.titular_banco,
      doc_titular: p.doc_titular,
      transf_padrao: p.transf_padrao,
      status: "pendente",
      created_by: opts.createdBy,
    });
  }

  return { rows, fornecedorCount, skippedExisting };
}
