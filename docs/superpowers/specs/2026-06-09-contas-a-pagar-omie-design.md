# Lançar contas a pagar do Control Hub no Omie (Fase 2)

**Data:** 2026-06-09
**Módulo:** Compras (ctrl) — Contas a Pagar
**Pré-requisito:** Fase 1 (fornecedor → Omie por unidade) — concluída. O
`ctrl_supplier_omie_links` já guarda o `codigo_cliente` do fornecedor por empresa.

## Objetivo

Quando o Contas a Pagar seleciona a empresa pagadora e aprova/envia uma
requisição, o lançamento vai para o Omie **dessa empresa**, com a categoria,
departamento, conta corrente, valores e datas corretos. Antes de lançar, o
sistema verifica se a despesa já entrou no Omie via NF de produto (Compras) e,
nesse caso, evolui essa NF em vez de criar um lançamento novo.

## Decisões (acordadas)

1. **Empresa pagadora** deixa de ser texto livre e passa a referenciar uma
   `companies` real **com conexão Omie**. (V Company já foi cadastrada como
   empresa com credenciais — id `c15c2ddc-d3b6-465a-998d-d8c323f0be81`.) O hack
   `EXTRA_PAYING_COMPANIES` ("V Company" como texto) é removido.
2. **Matching de NF de produto:** o Omie já importa as NFs de produto
   automaticamente. Existe a opção de a NF **gerar uma conta a pagar** — é essa
   evolução que usamos. Matching por **CNPJ + valor**. Se casar: evolui a NF
   (gera a conta a pagar a partir dela), **altera a categoria** dessa conta para
   a do De-Para, e o card do Control Hub vira **"recebido"**.
3. **Data de emissão** = **dia 1** do mês/ano de competência do Control Hub.
4. **De-Para por empresa é obrigatório:** sem o mapeamento (tipo de despesa →
   categoria e setor → departamento) **daquela empresa**, o lançamento é
   **bloqueado** (erro claro).
5. **Conta corrente** = a conta **OmieCash** da empresa (uma por empresa; toda
   empresa tem a sua).
6. **Fornecedor** precisa estar aprovado para a requisição existir. No momento
   do lançamento, se o fornecedor ainda não tiver `codigo_cliente` na empresa
   pagadora, o sistema **cadastra-o na hora** nessa empresa (reusa a Fase 1) e
   segue.
7. **Documento:** `invoice_number` (nº da NF) e `barcode` (linha digitável)
   capturados na requisição vão para o lançamento (nº do documento / código de
   barras).

## Modelo de dados (novo)

- `ctrl_expense_type_omie_categoria`
  - `expense_type_id uuid → ctrl_expense_types`
  - `company_id uuid → companies`
  - `codigo_categoria text` (código da categoria no Omie), `nome_categoria text`
  - `unique(expense_type_id, company_id)`
- `ctrl_sector_omie_departamento`
  - `sector_id uuid → ctrl_sectors`, `company_id uuid → companies`
  - `codigo_departamento text`, `nome_departamento text`
  - `unique(sector_id, company_id)`
- `ctrl_company_omie_config`
  - `company_id uuid PK → companies`
  - `codigo_conta_corrente text` (a OmieCash da empresa), `nome_conta_corrente text`
- `ctrl_requests` (novas colunas)
  - `paying_company_id uuid → companies` (substitui o uso do texto `paying_company`;
    o texto fica para histórico/migração)
  - `omie_launch_status text check in ('pendente','recebido','lancado','erro')`
  - `omie_contapagar_codigo bigint` (código do lançamento/título no Omie)
  - `omie_launch_error text`, `omie_launched_at timestamptz`

## Componentes

### 2A/2B/2C — Painel de De-Para (Control Hub)
Nova tela admin (ex.: `/ctrl/admin/omie-mapeamento`). Por empresa Omie:
- Lista as **categorias** (`ListarCategorias`), **departamentos**
  (`ListarDepartamentos`) e **contas correntes** (`ListarContasCorrentes`) da
  empresa (carregadas do Omie, com cache/sync).
- Permite mapear: cada **tipo de despesa → categoria**; cada **setor →
  departamento**; e escolher a **conta corrente OmieCash** da empresa
  (default: a que tiver "omiecash"/"omie cash" no nome).
- Indicador de cobertura ("X de Y tipos mapeados nesta empresa").

### 2D — Matching de NF de produto (Compras)  ✅ API confirmada
**Constatação da pesquisa:** o Omie **não** expõe API para "evoluir uma NF
importada em conta a pagar". O `cGeraFinanceiro` só age na inclusão/alteração da
nota. Na prática, o monitor de NF-e do Omie importa a NF e — **se a empresa
estiver configurada para gerar financeiro** — já cria o título em contas a pagar
com `id_origem = "NFEP"`. Logo o matching é feito contra o **título já existente**.

Antes de lançar, na empresa pagadora:
1. `ListarContasPagar` (`financas/contapagar/`) com `filtrar_por_cpf_cnpj =
   <CNPJ do fornecedor>` (só dígitos) + janela de datas; **filtrar o valor no
   nosso lado** (a API não filtra por valor) — match por `valor_documento`
   igual em centavos.
2. **Casou** (preferir registros com `id_origem='NFEP'`): `AlterarContaPagar`
   com `{ codigo_lancamento_omie, codigo_categoria: <De-Para> }`; card →
   `recebido` (guarda `omie_contapagar_codigo`).
3. **Não casou:** segue para 2E (`IncluirContaPagar`).

**Pré-condição:** depende de a empresa estar configurada no Omie para gerar
financeiro a partir da NF importada. Onde não gerar, não haverá título para
casar → cai no lançamento manual (2E). (Confirmar a config por empresa.)

**Parâmetros a definir:** tolerância de valor (default: igualdade exata em
centavos) e janela de busca (ex.: emissão/vencimento nos últimos N dias).

### 2E — Lançamento (`financas/contapagar/` → `IncluirContaPagar`)  (campos confirmados)
Payload (empresa pagadora):
- `codigo_lancamento_integracao` = id da requisição (chave idempotente; evita
  duplicar se reenviar).
- `codigo_cliente_fornecedor` = `nCodCli` do fornecedor (link da Fase 1 em
  `ctrl_supplier_omie_links` para (fornecedor, empresa pagadora); se ausente,
  cadastra o fornecedor na empresa na hora e usa o código retornado).
- `codigo_categoria` = De-Para (2A) do tipo de despesa nessa empresa.
- `data_vencimento` = `due_date` (formato `dd/mm/aaaa`).
- `data_previsao` = `due_date` (obrigatório pela Omie; usamos o vencimento).
- `data_emissao` = dia **1** do mês/ano de competência (`dd/mm/aaaa`).
- `valor_documento` = `amount`.
- `distribuicao` = `[{ cCodDep: <departamento do De-Para 2B>, nPerDep: 100 }]`.
- `id_conta_corrente` = `nCodCC` da OmieCash da empresa (2C).
- `observacao` = descrição da requisição.
- `numero_documento`/`numero_documento_fiscal` = `invoice_number` (quando houver).
- Boleto: `cnab_integracao_bancaria = { codigo_forma_pagamento: "BOL",
  codigo_barras_boleto: <barcode> }` (não há campo de código de barras na raiz).
- Sucesso → `omie_launch_status='lancado'` + `omie_contapagar_codigo`
  (`codigo_lancamento_omie`).

### 2F — Fluxo e estados no Control Hub
- Seleção da empresa pagadora no Contas a Pagar passa a gravar
  `paying_company_id` (empresa real com Omie). Lista = `companies` com
  credenciais Omie.
- Ao enviar para pagamento: valida De-Para da empresa (2A/2B/2C) — se faltar,
  **bloqueia** com mensagem clara. Roda matching (2D) → recebido OU lança (2E).
- Resultado por requisição (`omie_launch_status`) com badge e botão
  **"Reenviar ao Omie"** em caso de erro (análogo ao fornecedor).
- Falha não corrompe o estado de pagamento; fica sinalizada para reenvio.

## Sequência (ondas, cada uma testável em produção)

1. **Onda 1 — De-Para (2A/2B/2C):** painel + tabelas + carregamento de
   categorias/departamentos/contas do Omie. Não lança nada ainda. Marcelo
   preenche os mapeamentos.
2. **Onda 2 — Spike + Matching (2D):** confirmar a API do Omie e implementar o
   matching/evolução de NF. **Tem que vir antes de habilitar lançamentos reais**
   para não duplicar contas a pagar de fornecedores que entram por NF de produto.
3. **Onda 3 — Lançamento (2E) + Fluxo (2F):** empresa pagadora como `company_id`,
   IncluirContaPagar, on-the-fly do fornecedor, estados/badge/retry. Junta tudo.

## Riscos / pontos de atenção

- **2D é o maior risco** (mecânica exata no Omie). O spike resolve antes de
  comprometer a Onda 3.
- **Duplicidade:** habilitar lançamento (Onda 3) sem o matching (Onda 2) pode
  duplicar contas a pagar. Por isso a ordem.
- **Cobertura do De-Para:** lançamento bloqueia sem mapeamento — o painel
  precisa deixar claro o que falta por empresa.
- **Volume de chamadas Omie** no envio (matching + eventual cadastro de
  fornecedor + lançamento): sequencial, com o rate-limit já existente.
- **`paying_company` legado (texto):** requisições antigas ficam com o texto;
  só as novas usam `paying_company_id`. Migração de texto→id é best-effort.

## Fora de escopo (por ora)
- Conciliação/baixa de pagamento no Omie (só lançamos a conta a pagar).
- Edição/cancelamento no Omie a partir do Control Hub depois de lançado.
- Mapeamento automático (sugestão por nome) — pode ser um incremento do painel.
