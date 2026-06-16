# Editar previsão do Omie ao enviar requisição para pagamento

**Data:** 2026-06-16
**Módulo:** Compras / Controladoria (ctrl)

## Objetivo

A maioria das despesas recorrentes mensais já está lançada no Omie como
**previsão** (títulos em aberto com a palavra "previsão" na observação). Hoje,
ao enviar uma requisição para pagamento, o sistema sempre tenta casar com uma
**nota fiscal NFEP** de valor igual e, não achando, cria um título novo — o que
duplica a previsão recorrente.

Esta feature faz o sistema, ao enviar para pagamento, procurar a **previsão** do
mesmo fornecedor vencendo no mês e perguntar se a requisição deve **editar essa
previsão** em vez de criar um título novo. Ao confirmar, todos os campos do
título (valor, vencimento, categoria, departamento, observação etc.) são
sobrescritos pelos dados da requisição.

## Contexto atual

- O lançamento no Omie acontece em **"Enviar para pagamento"** (Contas a Pagar),
  não na aprovação. `sendToPayment(requestIds[], payingCompanyId)`
  (`src/lib/ctrl/actions/requests.ts`) marca as requisições como `agendado` e
  chama `launchRequestToOmie` para cada uma.
- `launchRequestToOmie` (`src/lib/ctrl/actions/contapagar-launch.ts`):
  1. garante o fornecedor na empresa (`syncSupplierToOmieUnit`),
  2. faz matching via `findContaPagarByCnpjValor` — que **só casa NFEP** de valor
     igual e, nesse caso, só altera a categoria (`alterarContaPagarCategoria`),
  3. não achando, cria título novo (`incluirContaPagar`).
- `findContaPagarByCnpjValor` (`src/lib/omie/contapagar.ts`) **exclui de
  propósito** títulos de previsão (RPTP) — esta feature trata desse caso por um
  caminho separado, sem alterar esse matching de NFEP.
- `omie_launch_status` em `ctrl_requests` hoje: `lancado`, `recebido`, `erro`
  (texto). Coluna `omie_contapagar_codigo` guarda o código do título no Omie.

## Decisões (acordadas)

1. **Gatilho:** no "Enviar para pagamento", em **dois passos** (preview →
   confirmação), porque exige confirmação humana no meio do fluxo.
2. **Critério de match da previsão:** mesmo fornecedor + palavra "previsão" na
   observação + vencimento dentro do mesmo mês/ano do vencimento da requisição.
   O **valor é ignorado** no filtro (o objetivo é justamente atualizar o valor).
3. **Vários matches:** escolhe automaticamente a previsão de **valor mais
   próximo** do valor da requisição; a confirmação é só dessa.
4. **Ao editar:** sobrescreve **todos os campos** pela requisição, **inclusive a
   observação** (some o marcador "previsão" — o título passa a ser o real).
5. **Sem previsão encontrada:** cria título novo (comportamento atual).

## Critério de match (detalhe)

Dada uma requisição com `due_date` (fallback: dia 1 de
`reference_year`/`reference_month`) e `amount`:

1. `ListarContasPagar` filtrado por `filtrar_por_cpf_cnpj` = CNPJ/CPF do
   fornecedor e `filtrar_por_status: "EMABERTO"`, paginando (200/página) como em
   `findContaPagarByCnpjValor`.
2. Mantém o título como candidato quando:
   - a observação contém "previsao" após normalização (lowercase + remoção de
     acentos), **e**
   - o `data_vencimento` do título cai no mesmo mês/ano do vencimento da
     requisição.
3. Entre os candidatos, escolhe o de menor `|valor_documento − amount|`.
   Empate → o primeiro retornado pelo Omie.
4. Nenhum candidato → `null` (cria novo).

Implementado como nova função em `src/lib/omie/contapagar.ts`:

```
findPrevisaoContaPagar(appKey, appSecret, cnpj, dueDateIso, amount):
  Promise<{ codigoLancamentoOmie, valorAtual, vencimento, observacao } | null>
```

## Passo 1 — Preview

Nova server action em `src/lib/ctrl/actions/requests.ts` (ou
`contapagar-launch.ts`):

```
previewPrevisaoMatches(requestIds: string[], payingCompanyId: string):
  Promise<{ ok: true; matches: Array<{
    requestId: string
    requestNumber: number
    supplierName: string
    amount: number
    dueDate: string | null
    previsao: { codigo: number; valorAtual: number; vencimento: string; observacao: string } | null
  }> } | { error: string }>
```

- Guarda de papel: igual ao `sendToPayment`
  (`gerente`/`diretor`/`csc`/`contas_a_pagar`/`admin`).
- Resolve fornecedor + CNPJ por requisição; chama `findPrevisaoContaPagar`.
- **Best-effort:** se a chamada ao Omie falhar para uma requisição, retorna
  `previsao: null` (cairá em "criar novo") — o erro não bloqueia o preview.

## Passo 2 — Confirmação + execução

- A tabela de Contas a Pagar (`src/components/ctrl/contas-a-pagar-table.tsx`),
  ao clicar "Enviar para pagamento", primeiro chama `previewPrevisaoMatches`.
- Se **nenhuma** requisição tem previsão, segue direto para `sendToPayment` como
  hoje.
- Se houver previsões, abre um diálogo listando só essas linhas:
  *"Fornecedor X — previsão vence dd/mm, R$ atual → R$ novo. Editar previsão?"*
  com toggle por linha: **Editar previsão** (padrão) / **Criar título novo**.
- Ao confirmar, chama `sendToPayment(requestIds, payingCompanyId, decisoes)`
  onde `decisoes: Record<string, number | "novo">` mapeia requestId →
  `codigoLancamentoOmie` (editar) ou `"novo"` (criar).

`sendToPayment` ganha o 3º parâmetro opcional `decisoes`. Para cada requisição,
repassa `previsaoCodigo` (quando a decisão é editar) ao `launchRequestToOmie`.

## Edição no Omie

Nova função completa em `src/lib/omie/contapagar.ts`:

```
alterarContaPagar(appKey, appSecret, payload: ContaPagarPayload & { codigo_lancamento_omie: number })
```

Chama `AlterarContaPagar` enviando o mesmo conjunto de campos do
`incluirContaPagar` (valor, vencimento, previsão, emissão, categoria,
distribuição/departamento, conta corrente, observação, nº documento, bloco
CNAB/boleto) **mais** `codigo_lancamento_omie` como identificador. Não envia
`codigo_lancamento_integracao` (o título já existe e tem origem de previsão).

`launchRequestToOmie` ganha parâmetro opcional `previsaoCodigo?: number`:

- **Com `previsaoCodigo`:** pula o `findContaPagarByCnpjValor`; monta o mesmo
  payload do caminho de inclusão e chama `alterarContaPagar` nesse código.
  `omieStatus = "previsao_editada"`, `omieCode = previsaoCodigo`.
- **Sem `previsaoCodigo`:** comportamento atual (NFEP match → categoria, ou
  inclui novo).
- Fallback de boleto inválido (retry sem CNAB) vale também na edição.
- Anexos (boleto/NF) continuam best-effort, iguais a hoje.

## Mudanças de dados / estado

- `ctrl_requests.omie_launch_status`: novo valor possível **`previsao_editada`**
  (coluna texto — sem migration de enum; só novo valor). `omie_contapagar_codigo`
  recebe o código da previsão editada.
- UI de Contas a Pagar: badge própria para `previsao_editada` ("Previsão
  editada").
- `ctrl_history`: ação registra "Previsão editada no Omie (código N)".

## Erros / bordas

- Falha no Omie ao editar: marca `omie_launch_status = "erro"` +
  `omie_launch_error`, igual ao fluxo atual; botão "Reenviar" reexecuta.
- Reenvio (`resyncContaPagar`): hoje rechama `launchRequestToOmie` sem
  `previsaoCodigo`. Como o título da previsão já tem o código gravado em
  `omie_contapagar_codigo`, o reenvio de uma previsão editada passa
  `previsaoCodigo` = `omie_contapagar_codigo` quando `omie_launch_status` era
  `previsao_editada`, para não criar duplicata.
- Fornecedor sem CNPJ/CPF: nunca casa previsão → cria novo (atual).
- Concorrência: se a previsão foi paga/baixada entre o preview e a confirmação,
  o `AlterarContaPagar` falha → erro tratado + reenvio.

## Fora de escopo

- Casar previsão na **aprovação** (decidido: só no envio para pagamento).
- Editar previsão de múltiplas empresas pagadoras numa tacada (o envio já é por
  empresa pagadora).
- Reconciliar previsões órfãs (que ninguém enviou) — segue manual no Omie.

## Riscos / notas

- `ListarContasPagar` por CNPJ assume CNPJ por fornecedor; vários títulos são
  esperados (é o caso de uso). O filtro por palavra + mês reduz o conjunto.
- A escolha automática "valor mais próximo" pode errar quando há duas previsões
  legítimas de valores parecidos no mesmo mês; a confirmação humana mitiga
  (a pessoa vê o vencimento e o valor atual antes de confirmar).
