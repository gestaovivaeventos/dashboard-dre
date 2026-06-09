# Onda 2+3 — Lançar contas a pagar no Omie — Plano

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps usam checkbox.

**Goal:** Ao enviar para pagamento no Contas a Pagar (com empresa pagadora selecionada), lançar a conta a pagar no Omie dessa empresa — fazendo matching com NF de produto já existente (recebido) ou criando o título (lançado).

**Spec:** docs/superpowers/specs/2026-06-09-contas-a-pagar-omie-design.md
**Pré-requisito:** Onda 1 (De-Para) — no ar. Lançamento exige mapeamento preenchido.
**Validação:** build + lint + SQL; migração com "ok".

**Decisões (defaults):** gatilho = "Enviar para Pagamento"; matching por CNPJ + status EMABERTO + valor exato (centavos); sem De-Para completo → bloqueia; falha Omie → envia + badge + reenviar; empresa pagadora vira `company_id` real.

---

## Estrutura de arquivos
- Create: migração `ctrl_requests` colunas de lançamento + `paying_company_id`
- Modify: `src/lib/supabase/types.ts` (CtrlRequest)
- Create: `src/lib/omie/contapagar.ts` (Listar/Incluir/Alterar conta a pagar)
- Create: `src/lib/ctrl/actions/contapagar-launch.ts` (orquestra matching+lançamento+retry)
- Modify: `src/lib/ctrl/actions/requests.ts` (`sendToPayment` passa a lançar)
- Modify: `src/app/(ctrl)/ctrl/contas-a-pagar/page.tsx` (empresas com Omie + launch status)
- Modify: `src/components/ctrl/contas-a-pagar-table.tsx` (empresa pagadora = company_id; badges/retry; remove EXTRA_PAYING_COMPANIES)

---

## Task 1 — Migração
**Files:** Create `supabase/migrations/2026XXXX_ctrl_contapagar_launch.sql`
```sql
ALTER TABLE ctrl_requests
  ADD COLUMN IF NOT EXISTS paying_company_id uuid REFERENCES companies(id),
  ADD COLUMN IF NOT EXISTS omie_launch_status text
    CHECK (omie_launch_status IN ('pendente','recebido','lancado','erro')),
  ADD COLUMN IF NOT EXISTS omie_contapagar_codigo bigint,
  ADD COLUMN IF NOT EXISTS omie_launch_error text,
  ADD COLUMN IF NOT EXISTS omie_launched_at timestamptz;
```
- [ ] Aplicar (DASH_HERO) após "ok". Verificar colunas. Commit.

## Task 2 — Tipos
**Files:** Modify `src/lib/supabase/types.ts`
- [ ] Adicionar ao `CtrlRequest`: `paying_company_id: string | null; omie_launch_status: "pendente"|"recebido"|"lancado"|"erro"|null; omie_contapagar_codigo: number | null; omie_launch_error: string | null; omie_launched_at: string | null;`
- [ ] Build. Commit.

## Task 3 — Cliente Omie conta a pagar
**Files:** Create `src/lib/omie/contapagar.ts` (usa `omieCall`, endpoint `https://app.omie.com.br/api/v1/financas/contapagar/`)
- [ ] `findContaPagarByCnpjValor(appKey, appSecret, cnpj, valor)`: pagina `ListarContasPagar` com `{ pagina, registros_por_pagina: 200, filtrar_por_cpf_cnpj: <digits>, filtrar_por_status: "EMABERTO" }`; array `conta_pagar_cadastro`; retorna o primeiro com `valor_documento` igual ao `valor` (comparação em centavos: `Math.round(v*100)`), preferindo `id_origem === "NFEP"`. Retorna `{ codigo_lancamento_omie } | null`. Tolerante a `notFound` (→ null).
- [ ] `incluirContaPagar(appKey, appSecret, payload)`: chama `IncluirContaPagar`; retorna `codigo_lancamento_omie`. Lança em fault.
- [ ] `alterarContaPagarCategoria(appKey, appSecret, codigoLancamentoOmie, codigoCategoria)`: chama `AlterarContaPagar` com `{ codigo_lancamento_omie, codigo_categoria }`.
- [ ] Helper `buildContaPagarPayload(req, { codigoClienteFornecedor, codigoCategoria, codigoDepartamento, idContaCorrente })` montando: `codigo_lancamento_integracao` = req.id; `codigo_cliente_fornecedor`; `data_vencimento` (due_date → dd/mm/aaaa); `data_previsao` = mesma; `data_emissao` = `01/MM/AAAA` da competência (reference_month/reference_year); `valor_documento` = amount; `codigo_categoria`; `distribuicao: [{ cCodDep, nPerDep: 100 }]`; `id_conta_corrente`; `observacao` = description; `numero_documento`/`numero_documento_fiscal` = invoice_number (se houver); se payment_method boleto e barcode → `cnab_integracao_bancaria: { codigo_forma_pagamento: "BOL", codigo_barras_boleto: barcode }`.
- [ ] Build. Commit.

## Task 4 — Orquestração do lançamento
**Files:** Create `src/lib/ctrl/actions/contapagar-launch.ts`
- [ ] `launchRequestToOmie(supabase, request, company)` (interno, recebe admin client):
  1. Resolver mapeamentos da empresa: categoria do `expense_type_id` (`ctrl_expense_type_omie_categoria`), departamento do `sector_id` (`ctrl_sector_omie_departamento`), conta corrente (`ctrl_company_omie_config`). Se faltar qualquer um → `{ error: "Mapeamento Omie incompleto para <empresa> (…)" }` (NÃO lança).
  2. Garantir fornecedor na empresa: buscar `ctrl_supplier_omie_links` (supplier, company). Se ausente/sem `omie_codigo_cliente` → `syncSupplierToOmieUnit` na hora, gravar link, usar o código.
  3. Decriptar credenciais da empresa.
  4. Matching: `findContaPagarByCnpjValor(cnpj do fornecedor, amount)`.
     - Achou → `alterarContaPagarCategoria(codigo, codigoCategoria)`; status `recebido`, grava `omie_contapagar_codigo`.
     - Não achou → `incluirContaPagar(buildContaPagarPayload(...))`; status `lancado`, grava código.
  5. Gravar `omie_launch_status`, `omie_contapagar_codigo`, `omie_launched_at`, `omie_launch_error=null`. Erro Omie → `omie_launch_status='erro'`, `omie_launch_error=msg`. Retorna `{ ok, status }` ou `{ error }`.
- [ ] `resyncContaPagar(requestId)` (exportada, papéis contas_a_pagar/csc/admin): recarrega request + paying_company_id e re-roda `launchRequestToOmie`.
- [ ] Build. Commit.

## Task 5 — Fluxo no Contas a Pagar
**Files:** Modify `requests.ts` (`sendToPayment`), `contas-a-pagar/page.tsx`, `contas-a-pagar-table.tsx`
- [ ] `sendToPayment(requestIds, payingCompanyId)`: valida company com Omie; grava `paying_company_id` (+ `paying_company` = nome p/ compat) e status `agendado`; para cada request, roda `launchRequestToOmie`; coleta resultados. Mapeamento incompleto → retorna erro e NÃO envia aquele (ou bloqueia o lote — bloquear por item, reportando quais faltam). Mantém histórico.
- [ ] page: lista empresas pagadoras = `companies` com Omie (remove dependência do texto). Carrega `omie_launch_status`/erro para badges.
- [ ] table: seletor de empresa pagadora usa `company_id` (value = id, label = name); **remove `EXTRA_PAYING_COMPANIES`/`payingCompanyOptions`**; badge de status do lançamento (recebido/lançado/erro) + botão **"Reenviar ao Omie"** (chama `resyncContaPagar`) em erro.
- [ ] Build + lint. Commit.

## Task 6 — Fechamento
- [ ] Build/lint finais; merge; push.

## Self-review (cobertura do spec)
- 2D matching → T3 (findContaPagarByCnpjValor) + T4 (passo 4). 2E lançamento → T3/T4. 2F fluxo/empresa real/status/retry → T1,T2,T5.
- Fornecedor on-the-fly → T4 passo 2. Bloqueio sem mapeamento → T4 passo 1 + T5.
- Documento (invoice/boleto) no lançamento → T3 buildContaPagarPayload.

## Riscos
- Cria títulos REAIS no Omie ao enviar para pagamento. Matching evita duplicar; mapeamento obrigatório evita lançamento errado.
- `id_conta_corrente`/`codigo_cliente_fornecedor` são inteiros (nCodCC/nCodCli) — garantir conversão.
- Empresa sem geração automática de financeiro pela NF: não haverá match → lança como novo (comportamento aceitável).
