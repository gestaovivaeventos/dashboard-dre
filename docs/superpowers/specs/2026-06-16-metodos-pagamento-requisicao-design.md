# Métodos de pagamento da nova requisição — ajustes

**Data:** 2026-06-16
**Módulo:** Compras / Controladoria (ctrl)

## Objetivo

Três ajustes no formulário de nova requisição e no lançamento Omie:

1. Novo método de pagamento **PIX Copia e Cola**, com campo para colar o código.
2. **Conta corrente por método de pagamento**: dinheiro usa a conta "caixa
   físico" e cartão de crédito usa a conta "cartão"; os demais métodos seguem a
   conta corrente padrão atual.
3. Remover a opção **"Não sei"** da pergunta "O fornecedor emite nota fiscal?".

## Contexto atual

- Formulário: `src/components/ctrl/nova-requisicao-form.tsx`. Métodos hoje:
  `boleto`, `pix`, `transferencia`, `cartao_credito`, `dinheiro` (estado
  `paymentMethod`, default `boleto`). A disponibilidade de `pix`/`transferencia`
  depende dos dados do fornecedor (`selectedSupplier.chave_pix` /
  `banco`+`conta_corrente`). O PIX atual preenche a chave do cadastro e
  **desabilita** o campo quando há fornecedor selecionado.
- `payment_method` em `ctrl_requests` tem CHECK:
  `('boleto','pix','transferencia','cartao_credito','dinheiro')`
  (migração `20260421000003_ctrl_requests_full_schema.sql`). `pix_key` é texto
  livre; `pix_key_type` tem CHECK `('cpf','cnpj','email','telefone','aleatoria')`.
- Conta corrente: uma por empresa em `ctrl_company_omie_config.codigo_conta_corrente`.
  Configurada no admin `ctrl/admin/omie-mapeamento` a partir da lista
  `contasCorrentes` sincronizada do Omie. Lida no launch em
  `src/lib/ctrl/actions/contapagar-launch.ts` (linhas ~99-120) e gravada por
  `saveContaCorrente` em `src/lib/ctrl/actions/omie-mapping.ts`.
- Pergunta "emite nota fiscal" (`supplierIssuesInvoice`): opções `sim`,
  `sim_apos_pagamento`, `nao`, `nao_sei`. Campo não tem constraint no banco.

## Decisões (acordadas)

1. PIX Copia e Cola = **método de pagamento separado** (não um tipo de chave).
2. Remover **apenas** a opção "Não sei" (manter a pergunta e as demais).
3. Contas correntes caixa/cartão = **config por empresa no admin**, escolhidas da
   lista Omie já sincronizada.
4. Fallback do item 2: se a conta específica do método não estiver configurada,
   usa a **conta padrão**; erro só quando nem a padrão existe.

## 1. PIX Copia e Cola

### Banco (migração)
Recriar o CHECK de `payment_method` para incluir `pix_copia_cola`:
`('boleto','pix','transferencia','cartao_credito','dinheiro','pix_copia_cola')`.

### Formulário
- Nova opção `{ value: "pix_copia_cola", label: "PIX Copia e Cola" }` no seletor.
- Sempre disponível (adicionar a `avail`/`newAvail` incondicionalmente), porque é
  pagamento avulso — não depende do cadastro do fornecedor.
- Quando selecionado, renderizar uma seção própria com um **textarea** "Código
  PIX (copia e cola)" → estado existente `pixKey` (reusado). **Editável mesmo com
  fornecedor selecionado** (diferente do PIX comum). `pixKeyType` fica vazio.
- Submit: enviar `pix_key = pixKey`, `pix_key_type = undefined`. `payment_method
  = "pix_copia_cola"`.
- Validação: bloquear submit com mensagem em PT se `pix_copia_cola` e `pixKey`
  vazio ("Cole o código PIX copia e cola.").
- Tipos: ampliar o union de `payment_method` no payload do submit
  (`"boleto" | "pix" | "transferencia" | "cartao_credito" | "dinheiro" |
  "pix_copia_cola"`) e onde mais o union aparecer (ex.: tipo do input de
  `createRequest`).
- Omie: nenhum tratamento especial no launch (igual ao PIX comum); só a conta
  corrente (segue regra do item 2 → conta padrão).

### Anexo
O bloco de anexo genérico (`attachmentBlock`) já é exibido para métodos que não
são boleto; `pix_copia_cola` o exibe normalmente (comprovante opcional).

## 2. Conta corrente por método de pagamento

### Banco (migração)
`ctrl_company_omie_config`: adicionar `codigo_conta_corrente_caixa text` e
`codigo_conta_corrente_cartao text` (nullable).

### Admin (omie-mapeamento)
- `getOmieMappingData` passa a retornar `contaCorrenteCaixa` e
  `contaCorrenteCartao` (além de `contaCorrente`).
- `saveContaCorrente(companyId, codigo, tipo?)` — estender para gravar qual
  conta. Abordagem: novo parâmetro `tipo: "padrao" | "caixa" | "cartao"`
  (default `"padrao"`), atualizando a coluna correspondente no mesmo upsert por
  `company_id`. (Mantém uma única função, sem duplicar.)
- UI da página/cliente do omie-mapeamento: dois seletores novos abaixo do atual,
  "Conta corrente — Dinheiro (caixa físico)" e "Conta corrente — Cartão de
  crédito", populados pela mesma lista `contasCorrentes`, salvando via
  `saveContaCorrente` com o `tipo` correspondente.

### Launch
Em `launchRequestToOmie`, ao montar os dados:
- Buscar as três colunas (`codigo_conta_corrente`, `_caixa`, `_cartao`).
- Resolver:
  - `dinheiro` → `_caixa ?? padrao`
  - `cartao_credito` → `_cartao ?? padrao`
  - demais → `padrao`
- A checagem de "conta corrente" faltante (`missing.push("conta corrente")`)
  passa a olhar a conta **resolvida** (não só a padrão): erro só quando a conta
  resolvida for nula.

## 3. Remover "Não sei"

- No `nova-requisicao-form.tsx`, remover a linha
  `<option value="nao_sei">Não sei</option>`.
- Nenhuma migração: o campo não tem constraint; requisições antigas com
  `nao_sei` continuam exibindo o valor salvo sem quebrar.

## Fora de escopo

- Validar o formato do BR Code (copia e cola) — aceitamos o texto colado como
  está (igual ao tratamento atual de chave PIX).
- Enviar o PIX copia e cola como forma de pagamento estruturada ao Omie (hoje
  nem o PIX comum é enviado estruturado; só boleto usa o bloco CNAB).
- Migrar registros antigos `nao_sei`.

## Riscos / notas

- O CHECK de `payment_method` é recriado por migração; rodar via Supabase MCP no
  projeto DASH_HERO (`hlophikvgtqoexqwxxis`) com confirmação do Marcelo (DDL).
- `saveContaCorrente` com novo parâmetro: conferir todos os call sites atuais
  (passam só `companyId, codigo`) — o default `"padrao"` mantém compatibilidade.
- Se as contas caixa/cartão não forem configuradas, o fallback para a padrão
  evita bloquear o lançamento — mas o dinheiro/cartão cairá na conta padrão
  silenciosamente; aceitável e documentado.
