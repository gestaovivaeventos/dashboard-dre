# Cadastro de fornecedor no Omie por unidade

**Data:** 2026-06-09
**Módulo:** Compras (ctrl)

## Objetivo

Quando um fornecedor novo é aprovado no módulo de Compras, cadastrá-lo também
no Omie. O aprovador escolhe em quais unidades (uma ou mais) o fornecedor será
cadastrado. Edições em fornecedores devolvem-no a "pendente" e, na reaprovação,
os dados são atualizados no Omie.

Primeira etapa de uma evolução maior: lançar as requisições diretamente no Omie.

## Contexto atual

- `ctrl_suppliers`: fornecedores do módulo. Fluxo: `pendente` → `aprovado`/`rejeitado`.
  Editar (`updateSupplier`) volta para `pendente`. Aprovar (`approveSupplier`)
  vincula tipos de despesa. Colunas relevantes: `name`, `cnpj_cpf`, `email`,
  `phone`, dados bancários/PIX (`banco`, `agencia`, `conta_corrente`,
  `titular_banco`, `doc_titular`, `chave_pix`, `pix_key_type`), `from_omie`,
  `omie_id` (modelo antigo de empresa única — não usado por esta feature).
- Aprovação restrita aos papéis `csc`, `admin`, `aprovacao_fornecedor`.
- **15 unidades têm conexão Omie** (companies com `omie_app_key`/`omie_app_secret`):
  Feat Producoes, Hero Holding, Salvaterra Condominio, SGX, Terrazzo, Village,
  e Viva Barbacena/BH/Campo Grande/Cuiaba/Curitiba/Go/Juiz de Fora/Petropolis/
  Volta Redonda.
- **1.069 fornecedores pendentes hoje** são legados — já cadastrados no Omie.
- Credenciais Omie são criptografadas (`decryptSecret`). O padrão de chamada
  HTTP (rate-limit 350ms + retry em 5xx) está em `src/lib/omie/sync.ts`
  (`omieRequest`, privado).

## Decisões (acordadas)

1. **Sem auto-aprovação afetada** — esta feature não muda o fluxo de requisições.
2. **Falha de sync em uma unidade:** aprova mesmo assim e registra o resultado
   por unidade (`ok`/`erro`); unidades com erro ficam sinalizadas com botão
   "Reenviar ao Omie". Não bloqueia a aprovação.
3. **Reaprovação após edição:** a caixinha de unidades vem pré-marcada com as
   unidades onde o fornecedor já foi vinculado; o aprovador pode ajustar.
4. **Legados incluídos na fase 1** via casamento por CNPJ (sem duplicar no Omie).

## Modelo de dados

### `ctrl_suppliers` (alteração)
- `omie_sync_required boolean NOT NULL DEFAULT false`
  - Existentes (1.069 legados) permanecem `false` → **isentos** de sync.
  - `createSupplier` grava `true`.
  - `updateSupplier` grava `true` (qualquer edição passa a exigir sync na
    reaprovação — inclusive de legado editado).

### `ctrl_supplier_omie_links` (nova tabela)
Mapa fornecedor × unidade × resultado do sync.
- `id uuid pk default gen_random_uuid()`
- `supplier_id uuid not null references ctrl_suppliers(id) on delete cascade`
- `company_id uuid not null references companies(id)`
- `omie_codigo_cliente bigint` — código interno do cliente no Omie (retornado)
- `sync_status text not null default 'pendente' check (sync_status in ('pendente','ok','erro'))`
- `sync_error text`
- `synced_at timestamptz`
- `created_at timestamptz default now()`, `updated_at timestamptz default now()`
- `unique (supplier_id, company_id)`
- Índice por `supplier_id`.
- RLS: leitura/escrita para papéis ctrl de aprovação (`csc`/`admin`/
  `aprovacao_fornecedor`) — seguindo o padrão das demais tabelas ctrl; escrita
  via service-role nas server actions.

## Integração Omie

### `src/lib/omie/client.ts` (novo — chamador genérico)
Extrai o padrão de `omieRequest` para reuso: `omieCall(endpoint, call, appKey,
appSecret, param)` com rate-limit (350ms) e retry em 5xx/rede. Trata
faultstring de "não encontrado" como resultado vazio, não como erro (necessário
para a busca por CNPJ). (Não refatora `sync.ts` agora — apenas disponibiliza o
chamador para a nova feature.)

### `src/lib/omie/clientes.ts` (novo)
`syncSupplierToOmieUnit(appKey, appSecret, supplier): Promise<{ codigoCliente: number }>`

Algoritmo (idempotente, sem duplicar):
1. `ListarClientes` filtrando por `cnpj_cpf` (dígitos).
2. **Achou** (legado ou já cadastrado) → `AlterarCliente` identificando por
   `codigo_cliente_omie`, enviando os dados + `codigo_cliente_integracao =
   supplier.id` (adota o registro no nosso namespace). Retorna o código.
3. **Não achou** → `IncluirCliente` com `codigo_cliente_integracao = supplier.id`.
   Retorna o `codigo_cliente_omie` gerado.

Mapeamento de campos (Omie `geral/clientes/`):
- `codigo_cliente_integracao`: `supplier.id`
- `razao_social` e `nome_fantasia`: `supplier.name`
- `cnpj_cpf`: dígitos de `supplier.cnpj_cpf`
- `pessoa_fisica`: `"S"` se 11 dígitos (CPF), senão `"N"`
- `email`: `supplier.email`
- `telefone1_ddd` / `telefone1_numero`: derivados de `supplier.phone` (best-effort)
- `tags`: `[{ tag: "Fornecedor" }]`
- Dados bancários (quando presentes): `dadosBancarios` com `codigo_banco`,
  `agencia`, `conta_corrente`, `doc_titular`, `nome_titular`, `chave_pix`.

Erros de negócio do Omie (CNPJ inválido, campo obrigatório) sobem como exceção
e são gravados em `sync_error` da unidade.

## Server actions (`src/lib/ctrl/actions/suppliers.ts`)

### `approveSupplier(supplierId, expenseTypeIds, companyIds: string[])`
- Vínculo de tipos de despesa: inalterado.
- Se `supplier.omie_sync_required === false` (legado intocado): ignora Omie,
  aprova como hoje (sem exigir unidades).
- Se `true`:
  - Valida `companyIds.length >= 1` ("Selecione ao menos uma unidade…").
  - Para cada `companyId`: upsert do link (`pendente`), decripta credenciais,
    chama `syncSupplierToOmieUnit`. Sucesso → `sync_status='ok'`,
    `omie_codigo_cliente`, `synced_at`. Falha → `sync_status='erro'`,
    `sync_error`. (Sequencial; unidades são contas Omie distintas.)
  - **Aprova o fornecedor independentemente do resultado** das unidades.
  - Histórico: resumo (`N ok, M erro`).
  - Retorna `{ ok, results: [{ companyId, ok, error? }] }` para a UI sinalizar.
- Não remove links de unidades desmarcadas (não há remoção segura no Omie);
  o conjunto marcado define onde (re)sincronizar agora.

### `resyncSupplierOmie(supplierId, companyId)`
Reexecuta `syncSupplierToOmieUnit` para um link existente (botão "Reenviar ao
Omie" nas unidades com `erro`). Atualiza o link. Papéis: `csc`/`admin`/
`aprovacao_fornecedor`.

### `createSupplier` / `updateSupplier`
- `createSupplier`: grava `omie_sync_required = true`.
- `updateSupplier`: grava `omie_sync_required = true` (mantém o reset para
  `pendente` já existente). Links existentes são preservados (servem de
  pré-seleção na reaprovação).

## UI (`src/components/ctrl/fornecedores-table.tsx` + página)

- Página `admin/fornecedores`: além dos fornecedores, carrega as **unidades com
  conexão Omie** (companies com credenciais) e os **links existentes** por
  fornecedor; passa para o componente.
- Modal de aprovar:
  - Mantém a seleção de tipos de despesa.
  - Quando `supplier.omie_sync_required`: mostra a **caixinha de unidades**
    (checkbox das unidades Omie), **pré-marcada** com os `company_id` já
    vinculados. Obrigatório ≥1. Texto explicando que o fornecedor será
    cadastrado/atualizado no Omie dessas unidades.
  - Quando legado intocado (`false`): sem caixinha (comportamento atual).
- Lista/detalhe de fornecedor aprovado: para cada link com `erro`, badge
  "Falha no Omie — <unidade>" + botão "Reenviar ao Omie".

## Fora de escopo (fases futuras)

- Lançar requisições diretamente no Omie (próxima etapa).
- Remover fornecedor do Omie ao desmarcar unidade.
- Sincronização em massa dos 1.069 legados (só sincronizam quando editados).

## Riscos / notas

- `ListarClientes` por CNPJ assume CNPJ único por unidade. Se houver múltiplos
  matches, usa o primeiro e registra observação no histórico.
- Aprovar com muitas unidades faz várias chamadas sequenciais (~0,5–1s cada);
  aceitável para ação de admin. Pode paralelizar depois se necessário.
- `ENCRYPTION_KEY` deve estar correto (já é pré-requisito do sync atual).
