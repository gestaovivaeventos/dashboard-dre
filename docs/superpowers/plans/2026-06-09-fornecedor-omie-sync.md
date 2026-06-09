# Cadastro de fornecedor no Omie por unidade — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ao aprovar um fornecedor novo (ou editado), cadastrá-lo/atualizá-lo no Omie nas unidades que o aprovador selecionar, registrando o resultado por unidade e permitindo reenvio em caso de falha.

**Architecture:** Server actions no módulo ctrl chamam um cliente Omie genérico (`omieCall`) através de um helper de cliente/fornecedor (`syncSupplierToOmieUnit`) que casa por CNPJ (Alterar) ou inclui (Incluir). O mapa fornecedor×unidade×resultado vive em `ctrl_supplier_omie_links`. A flag `omie_sync_required` isenta os 1.069 legados intocados.

**Tech Stack:** Next.js 14 (App Router) server actions, Supabase (Postgres + RLS), Omie REST API (`geral/clientes/`), AES-256-GCM (`decryptSecret`).

**Spec:** `docs/superpowers/specs/2026-06-09-fornecedor-omie-sync-design.md`

**Nota sobre testes:** o projeto não tem framework de testes (ver `CLAUDE.md`). A validação de cada tarefa é `npm run build` (e `npm run lint` quando relevante) + verificações SQL via Supabase. Um smoke test manual contra o Omie real está na última tarefa (cria registro real — usar 1 fornecedor de teste, 1 unidade).

---

## Estrutura de arquivos

- **Criar** `supabase/migrations/20260609180000_ctrl_supplier_omie.sql` — coluna + tabela de vínculo + RLS.
- **Criar** `src/lib/omie/client.ts` — chamador Omie genérico (rate-limit/retry, not-found).
- **Criar** `src/lib/omie/clientes.ts` — `syncSupplierToOmieUnit` + mapeamento de campos.
- **Modificar** `src/lib/supabase/types.ts` — `omie_sync_required` em `CtrlSupplier`; novo tipo de link.
- **Modificar** `src/lib/ctrl/actions/suppliers.ts` — `createSupplier`/`updateSupplier` (flag), `approveSupplier` (assinatura + sync), `resyncSupplierOmie` (nova).
- **Modificar** `src/app/(ctrl)/ctrl/admin/fornecedores/page.tsx` — carregar unidades Omie + links; passar ao componente.
- **Modificar** `src/components/ctrl/fornecedores-table.tsx` — caixinha de unidades no modal; badge/botão reenviar.

---

## Task 1: Migração — flag + tabela de vínculo

**Files:**
- Create: `supabase/migrations/20260609180000_ctrl_supplier_omie.sql`

- [ ] **Step 1: Escrever a migração**

```sql
-- Flag: fornecedor participa do sync com o Omie. Existentes (legados) ficam
-- false (isentos); createSupplier/updateSupplier passam a gravar true.
ALTER TABLE ctrl_suppliers
  ADD COLUMN IF NOT EXISTS omie_sync_required boolean NOT NULL DEFAULT false;

-- Mapa fornecedor × unidade (company) × resultado do cadastro no Omie.
CREATE TABLE IF NOT EXISTS ctrl_supplier_omie_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id uuid NOT NULL REFERENCES ctrl_suppliers(id) ON DELETE CASCADE,
  company_id uuid NOT NULL REFERENCES companies(id),
  omie_codigo_cliente bigint,
  sync_status text NOT NULL DEFAULT 'pendente'
    CHECK (sync_status IN ('pendente','ok','erro')),
  sync_error text,
  synced_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (supplier_id, company_id)
);

CREATE INDEX IF NOT EXISTS ctrl_supplier_omie_links_supplier_idx
  ON ctrl_supplier_omie_links(supplier_id);

ALTER TABLE ctrl_supplier_omie_links ENABLE ROW LEVEL SECURITY;

-- Acesso via client de sessão para papéis de aprovação. As server actions
-- escrevem via service-role (bypassa RLS), mas a policy garante leitura segura.
CREATE POLICY ctrl_supplier_omie_links_rw ON ctrl_supplier_omie_links
  FOR ALL
  USING (has_ctrl_role(ARRAY['admin','csc','aprovacao_fornecedor','contas_a_pagar']))
  WITH CHECK (has_ctrl_role(ARRAY['admin','csc','aprovacao_fornecedor','contas_a_pagar']));
```

- [ ] **Step 2: Aplicar no banco**

Aplicar via Supabase MCP (`apply_migration`, project DASH_HERO `hlophikvgtqoexqwxxis`, name `ctrl_supplier_omie`) — mostrar o SQL e aguardar "ok" do Marcelo antes (regra do projeto para DDL).

- [ ] **Step 3: Verificar**

```sql
SELECT
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name='ctrl_suppliers' AND column_name='omie_sync_required') AS flag_ok,
  (SELECT count(*) FROM information_schema.tables
     WHERE table_name='ctrl_supplier_omie_links') AS tabela_ok,
  (SELECT count(*) FROM ctrl_suppliers WHERE omie_sync_required) AS ja_marcados;
```
Esperado: `flag_ok=1, tabela_ok=1, ja_marcados=0` (legados todos isentos).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260609180000_ctrl_supplier_omie.sql
git commit -m "feat(ctrl): schema sync fornecedor↔Omie (flag + tabela de vínculo)"
```

---

## Task 2: Tipos

**Files:**
- Modify: `src/lib/supabase/types.ts`

- [ ] **Step 1: Adicionar `omie_sync_required` ao tipo `CtrlSupplier`**

Localizar a interface `CtrlSupplier` (campos `from_omie`, `omie_id`, etc.) e adicionar, junto aos demais campos booleanos:

```typescript
  omie_sync_required: boolean;
```

- [ ] **Step 2: Adicionar o tipo do vínculo ao fim do bloco de tipos ctrl**

```typescript
export interface CtrlSupplierOmieLink {
  id: string;
  supplier_id: string;
  company_id: string;
  omie_codigo_cliente: number | null;
  sync_status: "pendente" | "ok" | "erro";
  sync_error: string | null;
  synced_at: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compila sem erros de tipo.

- [ ] **Step 4: Commit**

```bash
git add src/lib/supabase/types.ts
git commit -m "feat(ctrl): tipos omie_sync_required + CtrlSupplierOmieLink"
```

---

## Task 3: Cliente Omie genérico

**Files:**
- Create: `src/lib/omie/client.ts`

- [ ] **Step 1: Escrever o chamador genérico**

```typescript
// Chamador genérico da API Omie com rate-limit (350ms) e retry em 5xx/rede.
// Diferente do omieRequest privado do sync.ts, trata respostas "não
// encontrado" como resultado vazio (necessário para a busca por CNPJ).

const REQUEST_INTERVAL_MS = 350;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Rate-limit conservador por processo. Cada unidade é uma conta Omie distinta,
// então poderia ser por-conta; um global simples é suficiente aqui.
const lastRequest = { value: 0 };

export const OMIE_CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";

// Frases que a Omie retorna em faultstring quando não há registro — NÃO são erro.
const NOT_FOUND_HINTS = [
  "não encontrado",
  "nao encontrado",
  "não existem registros",
  "nao existem registros",
  "nenhum registro",
  "not found",
];

export interface OmieResult {
  data: Record<string, unknown>;
  notFound: boolean;
}

export async function omieCall(
  endpoint: string,
  call: string,
  appKey: string,
  appSecret: string,
  param: Record<string, unknown>,
): Promise<OmieResult> {
  const MAX_ATTEMPTS = 4;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const elapsed = Date.now() - lastRequest.value;
    if (lastRequest.value > 0 && elapsed < REQUEST_INTERVAL_MS) {
      await sleep(REQUEST_INTERVAL_MS - elapsed);
    }

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
        cache: "no-store",
      });
    } catch (err) {
      lastRequest.value = Date.now();
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt === MAX_ATTEMPTS) throw lastError;
      await sleep(600 * 2 ** (attempt - 1));
      continue;
    }
    lastRequest.value = Date.now();

    if (!response.ok) {
      if (response.status >= 500 && attempt < MAX_ATTEMPTS) {
        lastError = new Error(`Omie HTTP ${response.status} em ${call}.`);
        await sleep(600 * 2 ** (attempt - 1));
        continue;
      }
      throw new Error(`Omie HTTP ${response.status} em ${call}.`);
    }

    const data = (await response.json()) as Record<string, unknown>;
    const faultRaw = data.faultstring ?? data.faultcode;
    if (faultRaw) {
      const msg = String(data.faultstring ?? "").toLowerCase();
      if (NOT_FOUND_HINTS.some((h) => msg.includes(h))) {
        return { data, notFound: true };
      }
      throw new Error(String(data.faultstring ?? `Erro Omie em ${call}.`));
    }
    return { data, notFound: false };
  }

  throw lastError ?? new Error(`Falha ao chamar Omie em ${call}.`);
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compila (módulo ainda não importado por ninguém — ok).

- [ ] **Step 3: Commit**

```bash
git add src/lib/omie/client.ts
git commit -m "feat(omie): chamador genérico omieCall com tratamento de not-found"
```

---

## Task 4: Helper de sync de fornecedor

**Files:**
- Create: `src/lib/omie/clientes.ts`

- [ ] **Step 1: Escrever o helper**

```typescript
import { omieCall, OMIE_CLIENTES_URL } from "@/lib/omie/client";

export interface OmieSupplierData {
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
}

function onlyDigits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function buildClientePayload(supplier: OmieSupplierData): Record<string, unknown> {
  const doc = onlyDigits(supplier.cnpj_cpf);
  const phone = onlyDigits(supplier.phone);
  const payload: Record<string, unknown> = {
    codigo_cliente_integracao: supplier.id,
    razao_social: supplier.name,
    nome_fantasia: supplier.name,
    cnpj_cpf: doc,
    pessoa_fisica: doc.length === 11 ? "S" : "N",
    email: supplier.email ?? "",
    tags: [{ tag: "Fornecedor" }],
  };
  if (phone.length >= 10) {
    payload.telefone1_ddd = phone.slice(0, 2);
    payload.telefone1_numero = phone.slice(2);
  }
  if (supplier.banco || supplier.agencia || supplier.conta_corrente || supplier.chave_pix) {
    payload.dadosBancarios = {
      codigo_banco: onlyDigits(supplier.banco),
      agencia: supplier.agencia ?? "",
      conta_corrente: onlyDigits(supplier.conta_corrente),
      doc_titular: onlyDigits(supplier.doc_titular) || doc,
      nome_titular: supplier.titular_banco ?? supplier.name,
      chave_pix: supplier.chave_pix ?? "",
    };
  }
  return payload;
}

// Cadastra/atualiza o fornecedor em UMA unidade Omie, sem duplicar:
//   1. Procura por CNPJ (cobre legado e re-sync) → AlterarCliente.
//   2. Não achou → IncluirCliente.
// Em ambos grava codigo_cliente_integracao = supplier.id para adotar o registro.
export async function syncSupplierToOmieUnit(
  appKey: string,
  appSecret: string,
  supplier: OmieSupplierData,
): Promise<{ codigoCliente: number }> {
  const doc = onlyDigits(supplier.cnpj_cpf);
  if (!doc) throw new Error("Fornecedor sem CNPJ/CPF — não é possível cadastrar no Omie.");

  const list = await omieCall(OMIE_CLIENTES_URL, "ListarClientes", appKey, appSecret, {
    pagina: 1,
    registros_por_pagina: 50,
    clientesFiltro: { cnpj_cpf: doc },
  });

  let existingCode: number | null = null;
  if (!list.notFound) {
    const arr =
      (list.data.clientes_cadastro as Array<Record<string, unknown>> | undefined) ?? [];
    const match = arr.find((c) => onlyDigits(String(c.cnpj_cpf ?? "")) === doc) ?? arr[0];
    if (match?.codigo_cliente_omie) existingCode = Number(match.codigo_cliente_omie);
  }

  const fields = buildClientePayload(supplier);

  if (existingCode) {
    const res = await omieCall(OMIE_CLIENTES_URL, "AlterarCliente", appKey, appSecret, {
      ...fields,
      codigo_cliente_omie: existingCode,
    });
    return { codigoCliente: Number((res.data.codigo_cliente_omie as number) ?? existingCode) };
  }

  const res = await omieCall(OMIE_CLIENTES_URL, "IncluirCliente", appKey, appSecret, fields);
  const code = Number(res.data.codigo_cliente_omie as number);
  if (!code) throw new Error("Omie não retornou codigo_cliente_omie ao incluir.");
  return { codigoCliente: code };
}
```

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: compila.

- [ ] **Step 3: Commit**

```bash
git add src/lib/omie/clientes.ts
git commit -m "feat(omie): syncSupplierToOmieUnit (casa por CNPJ, Alterar/Incluir)"
```

---

## Task 5: Server actions de fornecedor

**Files:**
- Modify: `src/lib/ctrl/actions/suppliers.ts`

- [ ] **Step 1: Imports no topo do arquivo**

Logo após o import de `CtrlSupplier`:

```typescript
import { decryptSecret } from "@/lib/security/encryption";
import { syncSupplierToOmieUnit, type OmieSupplierData } from "@/lib/omie/clientes";
```

- [ ] **Step 2: `createSupplier` — gravar a flag**

No objeto passado a `.insert({ ... })` dentro de `createSupplier`, adicionar logo após `status: "pendente",`:

```typescript
      omie_sync_required: true,
```

- [ ] **Step 3: `updateSupplier` — gravar a flag**

No objeto `payload` de `updateSupplier`, logo após `rejection_reason: null,`:

```typescript
    // Qualquer edição passa a exigir (re)sync com o Omie na reaprovação.
    omie_sync_required: true,
```

- [ ] **Step 4: Reescrever `approveSupplier` (assinatura + sync)**

Substituir TODA a função `approveSupplier` por:

```typescript
export async function approveSupplier(
  supplierId: string,
  expenseTypeIds: string[],
  companyIds: string[] = [],
) {
  const ctx = await requireCtrlRole("csc", "admin", "aprovacao_fornecedor");

  if (!Array.isArray(expenseTypeIds) || expenseTypeIds.length === 0) {
    return { error: "Selecione ao menos um tipo de despesa." };
  }

  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  // Carrega o fornecedor (campos p/ Omie + flag).
  const { data: supplier, error: supErr } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix, omie_sync_required",
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
    .insert(expenseTypeIds.map((expenseTypeId) => ({ supplier_id: supplierId, expense_type_id: expenseTypeId })));
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
      cnpj_cpf: supplier.cnpj_cpf,
      email: supplier.email,
      phone: supplier.phone,
      banco: supplier.banco,
      agencia: supplier.agencia,
      conta_corrente: supplier.conta_corrente,
      titular_banco: supplier.titular_banco,
      doc_titular: supplier.doc_titular,
      chave_pix: supplier.chave_pix,
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
```

- [ ] **Step 5: Adicionar `resyncSupplierOmie` (logo após `approveSupplier`)**

```typescript
// Reenvia o fornecedor ao Omie em uma unidade (botão "Reenviar ao Omie").
export async function resyncSupplierOmie(supplierId: string, companyId: string) {
  await requireCtrlRole("csc", "admin", "aprovacao_fornecedor");
  const adminClient = createAdminClientIfAvailable();
  const supabase = adminClient ?? (await createClient());

  const { data: supplier } = await supabase
    .from("ctrl_suppliers")
    .select(
      "id, name, cnpj_cpf, email, phone, banco, agencia, conta_corrente, titular_banco, doc_titular, chave_pix",
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
```

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: compila. (A chamada antiga `approveSupplier(supplierId, ids)` no componente continua válida — o 3º parâmetro tem default `[]` — então não quebra antes da Task 7.)

- [ ] **Step 7: Commit**

```bash
git add src/lib/ctrl/actions/suppliers.ts
git commit -m "feat(ctrl): approveSupplier sincroniza fornecedor no Omie por unidade + resync"
```

---

## Task 6: Página de fornecedores — carregar unidades Omie e links

**Files:**
- Modify: `src/app/(ctrl)/ctrl/admin/fornecedores/page.tsx`

- [ ] **Step 1: Carregar unidades Omie e links em `getData`**

Em `getData`, trocar o `Promise.all` de 2 para 4 consultas:

```typescript
  const [suppliersResult, expenseTypesResult, omieCompaniesResult, linksResult] = await Promise.all([
    supabase
      .from("ctrl_suppliers")
      .select(
        `id, name, cnpj_cpf, email, phone, omie_id, from_omie, omie_sync_required,
         chave_pix, pix_key_type, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao, pix_padrao,
         status, rejection_reason, created_at, approved_at,
         approver:users!ctrl_suppliers_approved_by_fkey(name, email),
         ctrl_supplier_expense_types(expense_type_id)`,
      )
      .order("name"),
    supabase.from("ctrl_expense_types").select("id, name").order("name"),
    supabase
      .from("companies")
      .select("id, name")
      .eq("active", true)
      .not("omie_app_key", "is", null)
      .not("omie_app_secret", "is", null)
      .order("name"),
    supabase
      .from("ctrl_supplier_omie_links")
      .select("supplier_id, company_id, sync_status, sync_error"),
  ]);
```

- [ ] **Step 2: Agrupar links por fornecedor e devolver no retorno de `getData`**

Antes do `return` de `getData`, adicionar:

```typescript
  const linksBySupplier = new Map<string, Array<{ company_id: string; sync_status: string; sync_error: string | null }>>();
  for (const link of (linksResult.data ?? []) as Array<{ supplier_id: string; company_id: string; sync_status: string; sync_error: string | null }>) {
    const list = linksBySupplier.get(link.supplier_id) ?? [];
    list.push({ company_id: link.company_id, sync_status: link.sync_status, sync_error: link.sync_error });
    linksBySupplier.set(link.supplier_id, list);
  }
```

E no objeto retornado por `getData`, adicionar dois campos (e o campo `omie_sync_required` em cada supplier do tipo inline — adicionar `omie_sync_required: boolean | null;` na lista de campos do array de suppliers):

```typescript
    omieCompanies: (omieCompaniesResult.data ?? []) as Array<{ id: string; name: string }>,
    linksBySupplier,
```

- [ ] **Step 3: Passar os novos dados ao componente**

Na desestruturação do retorno:

```typescript
  const { suppliers, expenseTypes, suppliersError, omieCompanies, linksBySupplier } = await getData();
```

No `.map((s) => { ... })` que monta as linhas, adicionar ao objeto retornado (após `expense_type_ids: ...`):

```typescript
              omie_sync_required: s.omie_sync_required ?? false,
              omie_links: linksBySupplier.get(s.id) ?? [],
```

E no JSX `<FornecedoresTable ... />`, adicionar a prop:

```typescript
          omieCompanies={omieCompanies}
```

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: vai falhar com erro de tipo em `FornecedoresTable` (props `omieCompanies`, `omie_sync_required`, `omie_links` ainda não existem). Isso é esperado — corrigido na Task 7.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(ctrl)/ctrl/admin/fornecedores/page.tsx"
git commit -m "feat(ctrl): página de fornecedores carrega unidades Omie e links"
```

---

## Task 7: UI — caixinha de unidades no modal + reenviar

**Files:**
- Modify: `src/components/ctrl/fornecedores-table.tsx`

- [ ] **Step 1: Imports e tipos de props**

Atualizar o import de actions:

```typescript
import { approveSupplier, rejectSupplier, updateSupplier, resyncSupplierOmie } from "@/lib/ctrl/actions/suppliers";
```

No tipo `SupplierRow` (campos como `expense_type_ids: string[];`), adicionar:

```typescript
  omie_sync_required: boolean;
  omie_links: Array<{ company_id: string; sync_status: string; sync_error: string | null }>;
```

No tipo de props `FornecedoresTableProps` (onde estão `suppliers`, `expenseTypes`, `canApprove`), adicionar:

```typescript
  omieCompanies: Array<{ id: string; name: string }>;
```

E na desestruturação `export function FornecedoresTable({ suppliers, expenseTypes, canApprove })`:

```typescript
export function FornecedoresTable({ suppliers, expenseTypes, canApprove, omieCompanies }: FornecedoresTableProps) {
```

- [ ] **Step 2: Estado de unidades selecionadas**

Logo após `const [selectedExpenseTypes, setSelectedExpenseTypes] = useState<Set<string>>(new Set());`:

```typescript
  const [selectedUnits, setSelectedUnits] = useState<Set<string>>(new Set());
```

- [ ] **Step 3: Pré-seleção ao abrir, limpeza ao fechar, toggle**

Na função que abre o modal de aprovar (a que faz `setSelectedExpenseTypes(new Set(supplier.expense_type_ids));`), adicionar logo abaixo dessa linha:

```typescript
    setSelectedUnits(new Set(supplier.omie_links.map((l) => l.company_id)));
```

Em `closeApproveModal`, após `setSelectedExpenseTypes(new Set());`:

```typescript
    setSelectedUnits(new Set());
```

Após a função `toggleExpenseType`, adicionar:

```typescript
  const toggleUnit = (id: string) => {
    setSelectedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
```

- [ ] **Step 4: `confirmApprove` — validar unidades e enviar companyIds**

Substituir a função `confirmApprove` por:

```typescript
  const confirmApprove = () => {
    if (!approveModal) return;
    if (selectedExpenseTypes.size === 0) {
      setFeedback({ kind: "error", msg: "Selecione ao menos um tipo de despesa." });
      return;
    }
    if (approveModal.omie_sync_required && selectedUnits.size === 0) {
      setFeedback({ kind: "error", msg: "Selecione ao menos uma unidade para cadastro no Omie." });
      return;
    }
    const supplierId = approveModal.id;
    const ids = Array.from(selectedExpenseTypes);
    const units = Array.from(selectedUnits);
    setActingId(supplierId);
    startTransition(async () => {
      const result = await approveSupplier(supplierId, ids, units);
      setActingId(null);
      if ("error" in result && result.error) {
        setFeedback({ kind: "error", msg: `Falha ao aprovar: ${result.error}` });
      } else {
        const errs = (result.omieResults ?? []).filter((r) => !r.ok);
        setFeedback(
          errs.length
            ? { kind: "error", msg: `Aprovado, mas ${errs.length} unidade(s) falharam no Omie. Use "Reenviar" na lista.` }
            : { kind: "success", msg: "Fornecedor aprovado e cadastrado no Omie." },
        );
        closeApproveModal();
      }
    });
  };
```

- [ ] **Step 5: Seção de unidades no modal**

Logo após o fechamento da seção "Tipos de despesa" (a `</section>` que vem antes do `</div>` do corpo rolável do modal de aprovar), inserir:

```tsx
              {approveModal.omie_sync_required && (
                <section className="rounded-lg border bg-background shadow-sm">
                  <header className="flex items-center gap-2 border-b px-4 py-2.5">
                    <Truck className="h-4 w-4 text-primary" />
                    <h4 className="text-sm font-semibold">
                      Unidades para cadastro no Omie <span className="text-destructive">*</span>
                    </h4>
                  </header>
                  <div className="p-4">
                    {omieCompanies.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Nenhuma unidade com conexão Omie configurada.
                      </p>
                    ) : (
                      <>
                        <p className="mb-2 text-xs text-muted-foreground">
                          O fornecedor será cadastrado/atualizado no Omie de cada unidade marcada.
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {omieCompanies.map((c) => {
                            const checked = selectedUnits.has(c.id);
                            return (
                              <label
                                key={c.id}
                                className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm hover:bg-muted/40"
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleUnit(c.id)}
                                  className="h-4 w-4"
                                />
                                <span>{c.name}</span>
                              </label>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                </section>
              )}
```

Garantir que `Truck` está importado de `lucide-react` no topo (o componente já importa ícones como `Contact`, `Banknote`, `Tags`; adicionar `Truck` à lista se ausente).

- [ ] **Step 6: Badge de falha + botão Reenviar na lista**

Localizar onde cada linha de fornecedor renderiza ações/labels (a lista principal usa `s` como item; o botão "Aprovar" está por volta da linha 417). Adicionar, na área de uma linha de fornecedor **aprovado** (`s.status === "aprovado"`), o seguinte bloco que mostra as unidades com erro e um botão de reenvio por unidade:

```tsx
                {s.status === "aprovado" && s.omie_links.some((l) => l.sync_status === "erro") && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {s.omie_links
                      .filter((l) => l.sync_status === "erro")
                      .map((l) => {
                        const unit = omieCompanies.find((c) => c.id === l.company_id);
                        return (
                          <span
                            key={l.company_id}
                            className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700"
                            title={l.sync_error ?? undefined}
                          >
                            Falha no Omie: {unit?.name ?? l.company_id}
                            {canApprove && (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                  setActingId(s.id);
                                  startTransition(async () => {
                                    const r = await resyncSupplierOmie(s.id, l.company_id);
                                    setActingId(null);
                                    setFeedback(
                                      "error" in r && r.error
                                        ? { kind: "error", msg: `Reenvio falhou: ${r.error}` }
                                        : { kind: "success", msg: "Reenviado ao Omie." },
                                    );
                                  });
                                }}
                                className="ml-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
                              >
                                Reenviar
                              </button>
                            )}
                          </span>
                        );
                      })}
                  </div>
                )}
```

(Inserir dentro do container que renderiza cada fornecedor `s` na lista, abaixo do nome/labels — escolher o ponto onde os nomes de tipos de despesa já são exibidos, perto da linha ~340.)

- [ ] **Step 7: Build + lint**

Run: `npm run build`
Expected: compila sem erros de tipo.
Run: `npm run lint`
Expected: sem novos erros.

- [ ] **Step 8: Commit**

```bash
git add src/components/ctrl/fornecedores-table.tsx
git commit -m "feat(ctrl): seleção de unidades Omie na aprovação + reenviar fornecedor"
```

---

## Task 8: Verificação manual (smoke test) + fechamento

**Files:** nenhum (verificação)

- [ ] **Step 1: Subir local**

Run: `npm run dev`

- [ ] **Step 2: Criar um fornecedor de teste**

Na tela de Fornecedores, criar um fornecedor com CNPJ de teste válido. Confirmar via SQL que nasceu com a flag:

```sql
SELECT id, name, omie_sync_required, status FROM ctrl_suppliers
WHERE name ILIKE '%teste omie%';
```
Esperado: `omie_sync_required = true, status = 'pendente'`.

- [ ] **Step 3: Aprovar selecionando UMA unidade**

Aprovar o fornecedor de teste, escolhendo 1 tipo de despesa e **1 unidade** (ex.: a menos crítica). Confirmar o vínculo:

```sql
SELECT company_id, sync_status, omie_codigo_cliente, sync_error
FROM ctrl_supplier_omie_links
WHERE supplier_id = '<id-do-fornecedor-teste>';
```
Esperado: `sync_status = 'ok'` e `omie_codigo_cliente` preenchido. Conferir no Omie da unidade que o cliente/fornecedor apareceu.

- [ ] **Step 4: Editar e reaprovar (idempotência)**

Editar o fornecedor (ex.: telefone). Confirmar que voltou a `pendente`. Reaprovar — a caixinha deve vir com a unidade anterior **pré-marcada**. Após aprovar, confirmar no Omie que o registro foi **atualizado** (mesmo `codigo_cliente`, sem duplicado):

```sql
SELECT company_id, sync_status, omie_codigo_cliente FROM ctrl_supplier_omie_links
WHERE supplier_id = '<id-do-fornecedor-teste>';
```
Esperado: mesmo `omie_codigo_cliente` de antes.

- [ ] **Step 5: Confirmar isenção dos legados**

Aprovar um fornecedor legado (qualquer um dos pendentes que já existiam). A caixinha de unidades **não** deve aparecer; aprova direto. Nenhuma linha nova em `ctrl_supplier_omie_links` para ele.

- [ ] **Step 6: Limpeza do registro de teste no Omie**

Excluir manualmente o cliente de teste no(s) Omie(s) da(s) unidade(s) usada(s), para não deixar lixo.

- [ ] **Step 7: Commit final (se houver ajustes)**

```bash
git commit -am "chore(ctrl): ajustes pós smoke test do sync de fornecedor Omie"
```

---

## Self-review (cobertura do spec)

- Cadastro no Omie ao aprovar fornecedor novo → Task 5 (approveSupplier) + Task 4.
- Aprovador escolhe unidade(s) → Task 7 (caixinha) + Task 6 (lista de unidades).
- Todas as unidades com conexão Omie disponíveis → Task 6 (filtro `omie_app_key/secret not null`).
- Legados isentos → Task 1 (default false) + Task 5 (pula sync quando false) + Task 8 step 5.
- Edição volta a pendente e atualiza no Omie na reaprovação → Task 5 (updateSupplier flag) + Task 4 (Alterar por CNPJ) + Task 7 (pré-seleção) + Task 8 step 4.
- Falha por unidade não bloqueia + reenvio → Task 5 (try/catch por unidade) + Task 7 (badge + Reenviar).
- Sem duplicar legado no Omie → Task 4 (casa por CNPJ → Alterar).
