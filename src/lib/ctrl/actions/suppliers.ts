"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { requireCtrlRole } from "@/lib/ctrl/auth";
import { normalizePixTelefone } from "@/lib/ctrl/bancos";
import { CNPJ_LENGTH, CPF_LENGTH, normalizeDoc } from "@/lib/ctrl/cnpj";
import { enderecoMissing, hasAnyEndereco, maskCep } from "@/lib/ctrl/endereco";
import { notifyAdmins } from "@/lib/ctrl/notifications";
import { omieNameError } from "@/lib/ctrl/supplier-name";
import type { CtrlSupplier, CtrlSupplierStatus } from "@/lib/supabase/types";
import { decryptSecret } from "@/lib/security/encryption";
import { syncSupplierToOmieUnit, type OmieSupplierData } from "@/lib/omie/clientes";

// `status` aceita um valor ou uma lista. A tela de Nova Requisição usa a lista
// (aprovado + pendente): o fornecedor ainda não homologado pode ser escolhido e
// a requisição segue o fluxo normal de aprovação — a trava passou a ser no
// Contas a Pagar, no momento do envio para pagamento.
export async function getSuppliers(
  status?: CtrlSupplierStatus | CtrlSupplierStatus[],
) {
  await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin", "aprovacao_fornecedor");
  const supabase = await createClient();

  // A API limita 1000 linhas/requisição e já há >1000 fornecedores — pagina em
  // blocos para não cortar a cauda da lista (nomes com "T" em diante sumiam).
  const pageSize = 1000;
  const all: CtrlSupplier[] = [];
  for (let from = 0; ; from += pageSize) {
    let query = supabase
      .from("ctrl_suppliers")
      .select("*, ctrl_supplier_expense_types(ctrl_expense_types(id, name))")
      .order("name")
      .range(from, from + pageSize - 1);
    if (Array.isArray(status)) {
      if (status.length > 0) query = query.in("status", status);
    } else if (status) {
      query = query.eq("status", status);
    }

    const { data, error } = await query;
    if (error) return { error: error.message };
    all.push(...((data ?? []) as CtrlSupplier[]));
    if (!data || data.length < pageSize) break;
  }
  return { suppliers: all };
}

export async function approveSupplier(
  supplierId: string,
  expenseTypeIds: string[],
  companyIds: string[] = [],
) {
  const ctx = await requireCtrlRole("gerente", "csc", "admin", "aprovacao_fornecedor");

  if (!Array.isArray(expenseTypeIds) || expenseTypeIds.length === 0) {
    return { error: "Selecione ao menos um tipo de despesa." };
  }

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Carrega o fornecedor (campos p/ Omie + flag).
  const { data: supplier, error: supErr } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, nome_fantasia, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, transf_padrao, omie_sync_required, estrangeiro, codigo_pais, estado, cidade, endereco, endereco_numero, bairro, complemento, cep",
    )
    .eq("id", supplierId)
    .maybeSingle();

  if (supErr || !supplier) return { error: "Fornecedor não encontrado." };

  if (supplier.omie_sync_required && companyIds.length === 0) {
    return { error: "Selecione ao menos uma unidade para cadastro no Omie." };
  }

  const { error: updateError } = await supabase
    .from("ctrl_suppliers")
    .update({
      status: "aprovado",
      approved_by: ctx.id,
      approved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", supplierId);

  if (updateError) return { error: updateError.message };

  // Substitui os vínculos de tipo de despesa pelos selecionados.
  const { error: deleteError } = await supabase
    .from("ctrl_supplier_expense_types")
    .delete()
    .eq("supplier_id", supplierId);
  if (deleteError) return { error: deleteError.message };

  const { error: insertError } = await supabase
    .from("ctrl_supplier_expense_types")
    .insert(
      expenseTypeIds.map((expenseTypeId) => ({
        supplier_id: supplierId,
        expense_type_id: expenseTypeId,
      })),
    );
  if (insertError) return { error: insertError.message };

  // Sincroniza no Omie nas unidades selecionadas (só fornecedores do novo fluxo).
  const omieResults: { companyId: string; ok: boolean; error?: string }[] = [];
  if (supplier.omie_sync_required && companyIds.length > 0) {
    const { data: companies } = await supabase
      .from("companies")
      .select("id, name, omie_app_key, omie_app_secret")
      .in("id", companyIds);

    const supplierData: OmieSupplierData = {
      id: supplier.id,
      name: supplier.name,
      nome_fantasia: supplier.nome_fantasia,
      cnpj_cpf: supplier.cnpj_cpf,
      email: supplier.email,
      phone: supplier.phone,
      banco: supplier.banco,
      agencia: supplier.agencia,
      conta_corrente: supplier.conta_corrente,
      titular_banco: supplier.titular_banco,
      doc_titular: supplier.doc_titular,
      chave_pix: supplier.chave_pix,
      transf_padrao: supplier.transf_padrao ?? false,
      estrangeiro: supplier.estrangeiro ?? false,
      codigo_pais: supplier.codigo_pais,
      estado: supplier.estado,
      cidade: supplier.cidade,
      endereco: supplier.endereco,
      endereco_numero: supplier.endereco_numero,
      bairro: supplier.bairro,
      complemento: supplier.complemento,
      cep: supplier.cep,
    };

    for (const companyId of companyIds) {
      const company = (companies ?? []).find((c) => c.id === companyId);
      const now = new Date().toISOString();

      await supabase.from("ctrl_supplier_omie_links").upsert(
        { supplier_id: supplierId, company_id: companyId, sync_status: "pendente", updated_at: now },
        { onConflict: "supplier_id,company_id" },
      );

      if (!company?.omie_app_key || !company?.omie_app_secret) {
        await supabase
          .from("ctrl_supplier_omie_links")
          .update({ sync_status: "erro", sync_error: "Unidade sem credenciais Omie.", updated_at: now })
          .eq("supplier_id", supplierId)
          .eq("company_id", companyId);
        omieResults.push({ companyId, ok: false, error: "Unidade sem credenciais Omie." });
        continue;
      }

      try {
        const appKey = decryptSecret(company.omie_app_key);
        const appSecret = decryptSecret(company.omie_app_secret);
        const { codigoCliente } = await syncSupplierToOmieUnit(appKey, appSecret, supplierData);
        await supabase
          .from("ctrl_supplier_omie_links")
          .update({
            sync_status: "ok",
            omie_codigo_cliente: codigoCliente,
            sync_error: null,
            synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("supplier_id", supplierId)
          .eq("company_id", companyId);
        omieResults.push({ companyId, ok: true });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await supabase
          .from("ctrl_supplier_omie_links")
          .update({ sync_status: "erro", sync_error: msg, updated_at: new Date().toISOString() })
          .eq("supplier_id", supplierId)
          .eq("company_id", companyId);
        omieResults.push({ companyId, ok: false, error: msg });
      }
    }
  }

  const okCount = omieResults.filter((r) => r.ok).length;
  const errCount = omieResults.length - okCount;
  await logSupplierHistory(supabase, {
    supplierId,
    userId: ctx.id,
    action: "aprovado",
    comment:
      `${expenseTypeIds.length} tipo(s) de despesa` +
      (omieResults.length ? ` · Omie: ${okCount} ok, ${errCount} erro` : ""),
  });

  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true, omieResults };
}

// Reenvia o fornecedor ao Omie em uma unidade (botão "Reenviar ao Omie").
export async function resyncSupplierOmie(supplierId: string, companyId: string) {
  await requireCtrlRole("gerente", "csc", "admin", "aprovacao_fornecedor");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: supplier } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, nome_fantasia, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, transf_padrao, estrangeiro, codigo_pais, estado, cidade, endereco, endereco_numero, bairro, complemento, cep",
    )
    .eq("id", supplierId)
    .maybeSingle();
  if (!supplier) return { error: "Fornecedor não encontrado." };

  const { data: company } = await supabase
    .from("companies")
    .select("id, omie_app_key, omie_app_secret")
    .eq("id", companyId)
    .maybeSingle();
  if (!company?.omie_app_key || !company?.omie_app_secret) {
    return { error: "Unidade sem credenciais Omie." };
  }

  const now = new Date().toISOString();
  await supabase.from("ctrl_supplier_omie_links").upsert(
    { supplier_id: supplierId, company_id: companyId, sync_status: "pendente", updated_at: now },
    { onConflict: "supplier_id,company_id" },
  );

  try {
    const { codigoCliente } = await syncSupplierToOmieUnit(
      decryptSecret(company.omie_app_key),
      decryptSecret(company.omie_app_secret),
      supplier as OmieSupplierData,
    );
    await supabase
      .from("ctrl_supplier_omie_links")
      .update({
        sync_status: "ok",
        omie_codigo_cliente: codigoCliente,
        sync_error: null,
        synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("supplier_id", supplierId)
      .eq("company_id", companyId);
    revalidatePath("/ctrl/admin/fornecedores");
    return { ok: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await supabase
      .from("ctrl_supplier_omie_links")
      .update({ sync_status: "erro", sync_error: msg, updated_at: new Date().toISOString() })
      .eq("supplier_id", supplierId)
      .eq("company_id", companyId);
    return { error: msg };
  }
}

export async function rejectSupplier(supplierId: string, reason: string) {
  const ctx = await requireCtrlRole("gerente", "csc", "admin", "aprovacao_fornecedor");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { error } = await supabase
    .from("ctrl_suppliers")
    .update({
      status: "rejeitado",
      rejection_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", supplierId);

  if (error) return { error: error.message };

  await logSupplierHistory(supabase, {
    supplierId,
    userId: ctx.id,
    action: "rejeitado",
    comment: reason,
  });

  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true };
}

export async function updateSupplier(
  supplierId: string,
  data: {
    name?: string;
    nome_fantasia?: string | null;
    cnpj_cpf?: string | null;
    email?: string | null;
    phone?: string | null;
    chave_pix?: string | null;
    pix_key_type?: string | null;
    banco?: string | null;
    agencia?: string | null;
    conta_corrente?: string | null;
    titular_banco?: string | null;
    doc_titular?: string | null;
    transf_padrao?: boolean;
    transf_tipo_conta?: "corrente" | "poupanca" | null;
    pix_padrao?: boolean;
    // Fornecedor estrangeiro.
    estrangeiro?: boolean;
    pais?: string | null;
    codigo_pais?: string | null;
    // Endereço (comum aos dois fluxos; CEP/bairro só no brasileiro).
    estado?: string | null;
    cidade?: string | null;
    endereco?: string | null;
    endereco_numero?: string | null;
    bairro?: string | null;
    complemento?: string | null;
    cep?: string | null;
  },
) {
  // Any user in CTRL can edit a supplier they can see. The act of editing
  // resets the approval, so even non-approvers can effectively "demote"
  // a supplier back to pending — that's the desired behaviour (mistakes
  // in bank data need to be flagged for re-approval).
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin", "aprovacao_fornecedor");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Snapshot do registro atual pra calcular diff antes do update.
  const { data: current } = await supabase
    .from("ctrl_suppliers")
    .select(
      "name, nome_fantasia, cnpj_cpf, email, phone, chave_pix, pix_key_type, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao, transf_tipo_conta, pix_padrao, cep, endereco, endereco_numero, bairro, cidade, estado, complemento",
    )
    .eq("id", supplierId)
    .maybeSingle();

  // Build an update payload that only touches the fields actually provided.
  // Empty strings explicitly mean "clear this field"; undefined means "leave
  // it alone".
  const payload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    // Any edit invalidates the previous approval — back to pending.
    status: "pendente",
    approved_by: null,
    approved_at: null,
    rejection_reason: null,
    // Qualquer edição passa a exigir (re)sync com o Omie na reaprovação.
    omie_sync_required: true,
  };
  if (data.name !== undefined) {
    const trimmed = data.name.trim();
    if (!trimmed) return { error: "O nome do fornecedor não pode ficar vazio." };
    if (trimmed.length > 60) {
      return { error: "O nome do fornecedor deve ter no máximo 60 caracteres (limite do Omie)." };
    }
    // A Omie não aceita acento nem cedilha na razão social/nome fantasia.
    const nameOmieError = omieNameError(trimmed);
    if (nameOmieError) return { error: nameOmieError };
    payload.name = trimmed;
  }
  if (data.nome_fantasia !== undefined) {
    const trimmedNomeFantasia = data.nome_fantasia?.trim().toUpperCase() || "";
    if (!trimmedNomeFantasia) return { error: "O nome fantasia do fornecedor não pode ficar vazio." };
    if (trimmedNomeFantasia.length > 60) {
      return { error: "O nome fantasia deve ter no máximo 60 caracteres (limite do Omie)." };
    }
    const fantasiaOmieError = omieNameError(trimmedNomeFantasia);
    if (fantasiaOmieError) return { error: fantasiaOmieError };
    payload.nome_fantasia = trimmedNomeFantasia;
  }
  if (data.cnpj_cpf !== undefined) {
    payload.cnpj_cpf = data.cnpj_cpf?.trim() || null;
    // Impede editar o documento para um que já pertence a outro fornecedor.
    const normalizedDoc = normalizeDoc(payload.cnpj_cpf as string | null);
    if (normalizedDoc) {
      const { data: existing, error: dupErr } = await supabase.rpc(
        "ctrl_find_supplier_by_doc",
        { p_doc: payload.cnpj_cpf as string },
      );
      if (dupErr) return { error: dupErr.message };
      const match = ((existing ?? []) as Array<{ id: string; name: string; status: string }>)
        .find((s) => s.id !== supplierId);
      if (match) {
        const statusLabel = match.status === "aprovado" ? "aprovado" : "em aprovação";
        return {
          error: `Já existe um fornecedor ${statusLabel} com este CNPJ/CPF: ${match.name}.`,
        };
      }
    }
  }
  if (data.email !== undefined) payload.email = data.email?.trim() || null;
  if (data.phone !== undefined) payload.phone = data.phone?.trim() || null;
  if (data.chave_pix !== undefined) {
    const tipo = (data.pix_key_type ?? payload.pix_key_type)?.toString().trim();
    const chave = data.chave_pix?.trim() || null;
    payload.chave_pix = chave && tipo === "telefone" ? normalizePixTelefone(chave) : chave;
  }
  if (data.pix_key_type !== undefined) payload.pix_key_type = data.pix_key_type?.trim() || null;
  if (data.banco !== undefined) payload.banco = data.banco?.trim() || null;
  if (data.agencia !== undefined) payload.agencia = data.agencia?.trim() || null;
  if (data.conta_corrente !== undefined) payload.conta_corrente = data.conta_corrente?.trim() || null;
  if (data.titular_banco !== undefined) payload.titular_banco = data.titular_banco?.trim() || null;
  if (data.doc_titular !== undefined) payload.doc_titular = data.doc_titular?.trim() || null;
  if (data.transf_padrao !== undefined) payload.transf_padrao = data.transf_padrao;
  // Sub-tipo da conta (corrente/poupança) só faz sentido com transferência padrão;
  // ao desligar a transferência, zera o tipo. Se explicitado, prevalece.
  if (data.transf_tipo_conta !== undefined) {
    payload.transf_tipo_conta = data.transf_tipo_conta ?? null;
  } else if (data.transf_padrao === false) {
    payload.transf_tipo_conta = null;
  }
  if (data.pix_padrao !== undefined) payload.pix_padrao = data.pix_padrao;

  // Fornecedor estrangeiro: quando marcado, País e Estado são obrigatórios e os
  // campos brasileiros de documento deixam de ser exigidos. Quando desmarcado,
  // limpamos os campos de exterior para o cadastro voltar ao fluxo brasileiro.
  if (data.estrangeiro !== undefined) {
    const isEstrangeiro = !!data.estrangeiro;
    payload.estrangeiro = isEstrangeiro;
    if (isEstrangeiro) {
      const codigoPais = (data.codigo_pais ?? "").trim();
      const paisNome = (data.pais ?? "").trim();
      const estado = (data.estado ?? "").trim();
      if (!codigoPais || !paisNome) return { error: "Selecione o País do fornecedor estrangeiro." };
      if (!estado) return { error: "Informe o Estado do fornecedor estrangeiro." };
      payload.pais = paisNome;
      payload.codigo_pais = codigoPais;
      payload.estado = estado;
      payload.cidade = data.cidade?.trim() || null;
      payload.endereco = data.endereco?.trim() || null;
      payload.endereco_numero = data.endereco_numero?.trim() || null;
      payload.complemento = data.complemento?.trim() || null;
      // CEP/bairro são do endereço nacional — não se aplicam ao exterior.
      payload.bairro = null;
      payload.cep = null;
    } else {
      // Fluxo brasileiro: a Omie exige endereço completo. Os cadastros
      // anteriores a esta regra ficaram sem endereço, então na edição só
      // cobramos quando o fornecedor já tem um endereço gravado (não deixa
      // apagar) ou quando o usuário começa a preencher (não deixa salvar pela
      // metade) — editar só o banco de um cadastro legado segue possível.
      const endereco = {
        cep: maskCep(data.cep ?? ""),
        endereco: data.endereco?.trim() ?? "",
        endereco_numero: data.endereco_numero?.trim() ?? "",
        bairro: data.bairro?.trim() ?? "",
        cidade: data.cidade?.trim() ?? "",
        estado: (data.estado ?? "").trim().toUpperCase(),
        complemento: data.complemento?.trim() ?? "",
      };
      const jaTinhaEndereco = hasAnyEndereco(
        (current ?? {}) as unknown as Record<string, string | null>,
      );
      const faltando = enderecoMissing(endereco);
      if (faltando.length && (jaTinhaEndereco || hasAnyEndereco(endereco))) {
        return {
          error: `A Omie exige o endereço completo do fornecedor. Preencha: ${faltando.join(", ")}.`,
        };
      }
      payload.pais = null;
      payload.codigo_pais = null;
      payload.estado = endereco.estado || null;
      payload.cidade = endereco.cidade || null;
      payload.endereco = endereco.endereco || null;
      payload.endereco_numero = endereco.endereco_numero || null;
      payload.bairro = endereco.bairro || null;
      payload.complemento = endereco.complemento || null;
      payload.cep = endereco.cep || null;
    }
  }

  const { error } = await supabase
    .from("ctrl_suppliers")
    .update(payload)
    .eq("id", supplierId);

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      return { error: "Já existe um fornecedor com este CNPJ/CPF." };
    }
    return { error: error.message };
  }

  // Calcula diff campo a campo (so loga campos do payload — descarta os
  // internos como status/approved_by que sao consequencia da edicao).
  const TRACKED = [
    "name",
    "nome_fantasia",
    "cnpj_cpf",
    "email",
    "phone",
    "chave_pix",
    "pix_key_type",
    "banco",
    "agencia",
    "conta_corrente",
    "titular_banco",
    "doc_titular",
    "transf_padrao",
    "transf_tipo_conta",
    "pix_padrao",
    "cep",
    "endereco",
    "endereco_numero",
    "bairro",
    "cidade",
    "estado",
    "complemento",
  ] as const;
  const changes: Record<string, [unknown, unknown]> = {};
  if (current) {
    for (const k of TRACKED) {
      if (k in payload) {
        const before = (current as Record<string, unknown>)[k] ?? null;
        const after = payload[k] ?? null;
        if (before !== after) changes[k] = [before, after];
      }
    }
  }

  await logSupplierHistory(supabase, {
    supplierId,
    userId: ctx.id,
    action: "editado",
    changes: Object.keys(changes).length > 0 ? changes : null,
  });

  revalidatePath("/ctrl/admin/fornecedores");
  return { ok: true };
}

export async function createSupplier(data: {
  name: string;
  nome_fantasia?: string;
  cnpj_cpf?: string;
  email?: string;
  phone?: string;
  chave_pix?: string;
  pix_key_type?: string;
  banco?: string;
  agencia?: string;
  conta_corrente?: string;
  titular_banco?: string;
  doc_titular?: string;
  transf_padrao?: boolean;
  // Sub-tipo da transferência padrão (Conta Corrente x Poupança) — usado na
  // finalidade do lançamento em contas a pagar.
  transf_tipo_conta?: "corrente" | "poupanca";
  pix_padrao?: boolean;
  // Tipos de despesa pré-vinculados no cadastro (já vêm marcados na aprovação).
  expenseTypeIds?: string[];
  // Anexos opcionais do cadastro (object paths no bucket ctrl-attachments).
  attachmentPaths?: string[];
  // Fornecedor estrangeiro (sem CNPJ/CPF; exige País e Estado).
  estrangeiro?: boolean;
  pais?: string;
  codigo_pais?: string;
  // Endereço — obrigatório no fluxo brasileiro (exigência da Omie).
  estado?: string;
  cidade?: string;
  endereco?: string;
  endereco_numero?: string;
  bairro?: string;
  complemento?: string;
  cep?: string;
}) {
  const ctx = await requireCtrlRole("solicitante", "gerente", "diretor", "csc", "admin");

  const isEstrangeiro = !!data.estrangeiro;

  if (isEstrangeiro) {
    // Estrangeiro dispensa CNPJ/CPF, mas País e Estado passam a ser obrigatórios
    // — a Omie precisa deles (codigo_pais + estado="EX") para o cadastro do exterior.
    if (!data.codigo_pais?.trim() || !data.pais?.trim()) {
      return { error: "Selecione o País do fornecedor estrangeiro." };
    }
    if (!data.estado?.trim()) {
      return { error: "Informe o Estado do fornecedor estrangeiro." };
    }
  } else {
    if (!data.cnpj_cpf?.trim()) {
      // CNPJ ou CPF é obrigatório — sem documento, fornecedor nao pode ser
      // identificado de forma unica e cria duplicatas no Omie.
      return { error: "Informe o CNPJ ou CPF do fornecedor." };
    }
    // Tamanho mínimo do documento (defesa em profundidade — o formulário já
    // valida). CNPJ (numérico ou alfanumérico) tem 14 posições; CPF, 11 dígitos.
    // Documento com letra é sempre CNPJ.
    const docNorm = normalizeDoc(data.cnpj_cpf);
    if (docNorm.length !== CPF_LENGTH && docNorm.length !== CNPJ_LENGTH) {
      const pareceCnpj = /[A-Z]/.test(docNorm) || docNorm.length > CPF_LENGTH;
      return {
        error: pareceCnpj
          ? `O CNPJ informado contém menos de ${CNPJ_LENGTH} caracteres, abaixo do mínimo.`
          : `O documento informado é inválido: informe um CPF (${CPF_LENGTH} dígitos) ou um CNPJ (${CNPJ_LENGTH} caracteres).`,
      };
    }
    // Endereço completo é exigência da Omie no cadastro de fornecedor — sem
    // ele o IncluirCliente é recusado lá.
    const faltaEndereco = enderecoMissing(data);
    if (faltaEndereco.length) {
      return {
        error: `A Omie exige o endereço completo do fornecedor. Preencha: ${faltaEndereco.join(", ")}.`,
      };
    }
  }

  // Método marcado como padrão = o pagamento sai por ele sem ninguém perguntar
  // nada depois. Então os dados daquele método têm que vir completos.
  if (data.pix_padrao) {
    const faltando = [
      !data.pix_key_type?.trim() && "Tipo",
      !data.chave_pix?.trim() && "Chave",
    ].filter(Boolean) as string[];
    if (faltando.length) {
      return {
        error: `Para usar o PIX como método de pagamento padrão, preencha: ${faltando.join(", ")}.`,
      };
    }
  }
  if (data.transf_padrao) {
    const faltando = [
      !data.banco?.trim() && "Banco",
      !data.agencia?.trim() && "Agência",
      !data.conta_corrente?.trim() && "Conta corrente",
      !data.titular_banco?.trim() && "Titular da conta",
      !data.doc_titular?.trim() && "CPF/CNPJ do titular",
    ].filter(Boolean) as string[];
    if (faltando.length) {
      return {
        error: `Para usar a transferência como método de pagamento padrão, preencha: ${faltando.join(", ")}.`,
      };
    }
  }
  // requireCtrlRole already enforces auth + role. We use the admin client
  // here because RLS on ctrl_suppliers checks has_ctrl_role() against
  // user_module_roles directly — DRE admins (who get an implicit ctrl admin
  // in the session context) don't always have a matching row there, so the
  // insert would fail via the regular client.
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Padroniza o nome do fornecedor sempre em CAIXA ALTA — vale tanto para
  // razão social (PJ) quanto para nome completo (PF). Mantém o cadastro
  // consistente no sistema e no Omie.
  const trimmedName = data.name.trim().toUpperCase();
  if (!trimmedName) return { error: "O nome do fornecedor é obrigatório." };
  // 60 é o limite do campo no Omie (razao_social/nome_fantasia).
  if (trimmedName.length > 60) {
    return { error: "O nome do fornecedor deve ter no máximo 60 caracteres (limite do Omie)." };
  }
  const trimmedNomeFantasia = (data.nome_fantasia ?? "").trim().toUpperCase();
  if (!trimmedNomeFantasia) return { error: "O nome fantasia do fornecedor é obrigatório." };
  if (trimmedNomeFantasia.length > 60) {
    return { error: "O nome fantasia deve ter no máximo 60 caracteres (limite do Omie)." };
  }
  // A Omie não aceita acento nem cedilha na razão social/nome fantasia.
  const nameOmieError = omieNameError(trimmedName) ?? omieNameError(trimmedNomeFantasia);
  if (nameOmieError) return { error: nameOmieError };

  // Dedupe por CNPJ/CPF normalizado (só dígitos) — bloqueia mesmo se o
  // existente ainda estiver pendente, pra evitar fila de duplicatas em
  // aprovação. A comparação roda no banco (ctrl_find_supplier_by_doc): o scan
  // antigo no JS era cortado em 1000 linhas pelo PostgREST e, com >1000
  // fornecedores, documentos além desse limite escapavam e permitiam recadastro.
  const normalizedDoc = normalizeDoc(data.cnpj_cpf);
  if (normalizedDoc) {
    const { data: existing, error: dupErr } = await supabase.rpc(
      "ctrl_find_supplier_by_doc",
      { p_doc: data.cnpj_cpf },
    );
    if (dupErr) return { error: dupErr.message };
    const match = (existing ?? [])[0] as
      | { id: string; name: string; status: string; cnpj_cpf: string | null }
      | undefined;
    if (match) {
      const statusLabel = match.status === "aprovado" ? "aprovado" : "em aprovação";
      return {
        error: `Já existe um fornecedor ${statusLabel} com este CNPJ/CPF: ${match.name}.`,
      };
    }
  }

  const attachmentPaths = (data.attachmentPaths ?? []).filter(Boolean);
  const insertPayload: Record<string, unknown> = {
      name: trimmedName,
      nome_fantasia: trimmedNomeFantasia,
      cnpj_cpf: data.cnpj_cpf?.trim() || null,
      email: data.email?.trim() || null,
      phone: data.phone?.trim() || null,
      chave_pix:
        data.chave_pix?.trim() && data.pix_key_type?.trim() === "telefone"
          ? normalizePixTelefone(data.chave_pix)
          : data.chave_pix?.trim() || null,
      pix_key_type: data.pix_key_type?.trim() || null,
      banco: data.banco?.trim() || null,
      agencia: data.agencia?.trim() || null,
      conta_corrente: data.conta_corrente?.trim() || null,
      titular_banco: data.titular_banco?.trim() || null,
      doc_titular: data.doc_titular?.trim() || null,
      transf_padrao: data.transf_padrao ?? false,
      transf_tipo_conta: data.transf_padrao ? (data.transf_tipo_conta ?? "corrente") : null,
      pix_padrao: data.pix_padrao ?? false,
      estrangeiro: isEstrangeiro,
      pais: isEstrangeiro ? data.pais?.trim() || null : null,
      codigo_pais: isEstrangeiro ? data.codigo_pais?.trim() || null : null,
      // Endereço vale para os dois fluxos; CEP/bairro só existem no brasileiro
      // (no exterior o Estado é sempre "EX").
      estado: data.estado?.trim().toUpperCase() || null,
      cidade: data.cidade?.trim() || null,
      endereco: data.endereco?.trim() || null,
      endereco_numero: data.endereco_numero?.trim() || null,
      bairro: isEstrangeiro ? null : data.bairro?.trim() || null,
      complemento: data.complemento?.trim() || null,
      cep: isEstrangeiro ? null : maskCep(data.cep ?? "") || null,
      status: "pendente",
      omie_sync_required: true,
      created_by: ctx.id,
  };
  if (attachmentPaths.length > 0) insertPayload.attachment_paths = attachmentPaths;

  let { data: inserted, error } = await supabase
    .from("ctrl_suppliers")
    .insert(insertPayload)
    .select("id")
    .single();

  // 42703 = coluna inexistente: migration 20260817120000 (attachment_paths)
  // ainda não aplicada. Um anexo opcional não pode impedir o cadastro — refaz
  // o insert sem ele e registra no log. Os arquivos ficam no bucket, mas o
  // fornecedor entra normalmente na fila de homologação.
  if (error && (error as { code?: string }).code === "42703" && attachmentPaths.length > 0) {
    console.error(
      "createSupplier: coluna attachment_paths ausente (migration 20260817120000 pendente) — cadastro salvo sem os anexos.",
    );
    delete insertPayload.attachment_paths;
    ({ data: inserted, error } = await supabase
      .from("ctrl_suppliers")
      .insert(insertPayload)
      .select("id")
      .single());
  }

  if (error || !inserted) {
    // Índice único parcial (ctrl_suppliers_doc_norm_unique) — fallback caso o
    // dedupe acima perca uma corrida entre dois cadastros simultâneos.
    if ((error as { code?: string } | null)?.code === "23505") {
      return { error: "Já existe um fornecedor com este CNPJ/CPF." };
    }
    return { error: error?.message ?? "Falha ao cadastrar o fornecedor." };
  }

  // Vínculos de tipo de despesa escolhidos no cadastro. Ficam gravados desde já
  // e reaparecem pré-marcados na tela de aprovação (que ainda pode ajustá-los).
  const expenseTypeIds = (data.expenseTypeIds ?? []).filter(Boolean);
  if (expenseTypeIds.length > 0) {
    const { error: linkError } = await supabase
      .from("ctrl_supplier_expense_types")
      .insert(
        expenseTypeIds.map((expenseTypeId) => ({
          supplier_id: inserted.id,
          expense_type_id: expenseTypeId,
        })),
      );
    // Não falha o cadastro por causa do vínculo — o fornecedor já existe e o
    // aprovador consegue selecionar os tipos manualmente se algo escapar aqui.
    if (linkError) console.error("createSupplier: falha ao vincular tipos de despesa", linkError);
  }

  await logSupplierHistory(supabase, {
    supplierId: inserted.id,
    userId: ctx.id,
    action: "criado",
  });

  // Fornecedor novo nasce "pendente": avisa quem homologa (Contas a Pagar +
  // admins) para o cadastro não ficar parado esperando uma requisição travar no
  // pagamento. Sem request_id — a notificação é sobre o fornecedor, e aponta
  // para a tela de Fornecedores.
  await notifyAdmins({
    requestId: null,
    title: "Novo fornecedor aguardando homologação",
    message: `O fornecedor "${trimmedName}" foi cadastrado e aguarda homologação. Acesse Fornecedores para homologar.`,
    type: "fornecedor_pendente",
  });

  revalidatePath("/ctrl/admin/fornecedores");
  revalidatePath("/home");
  return { supplierId: inserted.id };
}

// ─── Anexos do cadastro ──────────────────────────────────────────────────────

export interface SupplierAttachment {
  name: string;
  url: string;
}

// Gera URLs assinadas (5 min) dos anexos opcionais do cadastro do fornecedor.
// Usado pela tela de Fornecedores (detalhe e homologação) para conferir os
// documentos que o cadastrante anexou. Assina com o admin client: a leitura
// vale para qualquer papel do módulo, não só para quem subiu o arquivo.
export async function getSupplierAttachments(
  supplierId: string,
): Promise<{ attachments: SupplierAttachment[] } | { error: string }> {
  await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "contas_a_pagar",
    "admin",
    "aprovacao_fornecedor",
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: supplier, error } = await supabase
    .from("ctrl_suppliers")
    .select("attachment_paths")
    .eq("id", supplierId)
    .maybeSingle<{ attachment_paths: string[] | null }>();

  if (error) {
    // 42703 = migration 20260817120000 ainda não aplicada. Sem coluna não há
    // anexo para mostrar — a tela segue funcionando sem a seção.
    if ((error as { code?: string }).code === "42703") return { attachments: [] };
    return { error: error.message };
  }
  if (!supplier) return { error: "Fornecedor não encontrado." };

  const paths = supplier.attachment_paths ?? [];
  if (paths.length === 0) return { attachments: [] };

  const attachments: SupplierAttachment[] = [];
  for (const path of paths) {
    const { data: signed, error: signErr } = await supabase.storage
      .from("ctrl-attachments")
      .createSignedUrl(path, 60 * 5);
    if (signErr || !signed) continue;
    // Nome original: o path é `${userId}/${timestamp}-${nomeSeguro}`.
    const name = (path.split("/").pop() ?? "anexo").replace(/^\d+-/, "");
    attachments.push({ name, url: signed.signedUrl });
  }
  return { attachments };
}

// ─── Historico ───────────────────────────────────────────────────────────────

async function logSupplierHistory(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  params: {
    supplierId: string;
    userId: string;
    action: "criado" | "editado" | "aprovado" | "rejeitado";
    changes?: Record<string, [unknown, unknown]> | null;
    comment?: string | null;
  },
) {
  const { error } = await supabase.from("ctrl_supplier_history").insert({
    supplier_id: params.supplierId,
    user_id: params.userId,
    action: params.action,
    changes: params.changes ?? null,
    comment: params.comment ?? null,
  });
  if (error) console.error("[supplier_history] Falha ao registrar:", error);
}

export interface SupplierHistoryEntry {
  id: string;
  action: "criado" | "editado" | "aprovado" | "rejeitado" | string;
  changes: Record<string, [unknown, unknown]> | null;
  comment: string | null;
  createdAt: string;
  user: { id: string; name: string | null; email: string | null } | null;
}

export async function getSupplierHistory(
  supplierId: string,
): Promise<{ entries?: SupplierHistoryEntry[]; error?: string }> {
  await requireCtrlRole(
    "solicitante",
    "gerente",
    "diretor",
    "csc",
    "admin",
    "aprovacao_fornecedor",
  );
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data, error } = await supabase
    .from("ctrl_supplier_history")
    .select(
      `id, action, changes, comment, created_at,
       user:users!ctrl_supplier_history_user_id_fkey(id, name, email)`,
    )
    .eq("supplier_id", supplierId)
    .order("created_at", { ascending: false });

  if (error) return { error: error.message };

  type Row = {
    id: string;
    action: string;
    changes: Record<string, [unknown, unknown]> | null;
    comment: string | null;
    created_at: string;
    user:
      | { id: string; name: string | null; email: string | null }
      | Array<{ id: string; name: string | null; email: string | null }>
      | null;
  };
  const entries: SupplierHistoryEntry[] = ((data ?? []) as Row[]).map((row) => {
    const u = Array.isArray(row.user) ? row.user[0] ?? null : row.user;
    return {
      id: row.id,
      action: row.action,
      changes: row.changes,
      comment: row.comment,
      createdAt: row.created_at,
      user: u,
    };
  });

  // Fornecedores aprovados antes do historico existir nao tem entry "aprovado".
  // Sintetiza uma a partir de approved_by/approved_at quando ausente.
  const hasApprovalEntry = entries.some((e) => e.action === "aprovado");
  if (!hasApprovalEntry) {
    const { data: sup } = await supabase
      .from("ctrl_suppliers")
      .select(
        `status, approved_at,
         approver:users!ctrl_suppliers_approved_by_fkey(id, name, email)`,
      )
      .eq("id", supplierId)
      .maybeSingle<{
        status: string;
        approved_at: string | null;
        approver:
          | { id: string; name: string | null; email: string | null }
          | Array<{ id: string; name: string | null; email: string | null }>
          | null;
      }>();

    if (sup?.status === "aprovado" && sup.approved_at) {
      const approver = Array.isArray(sup.approver) ? sup.approver[0] ?? null : sup.approver;
      entries.push({
        id: `synthetic-approval-${supplierId}`,
        action: "aprovado",
        changes: null,
        comment: null,
        createdAt: sup.approved_at,
        user: approver,
      });
      // Reordena para manter desc por data (a nova entry pode ser mais antiga ou
      // mais nova que algum edito subsequente).
      entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    }
  }

  return { entries };
}
