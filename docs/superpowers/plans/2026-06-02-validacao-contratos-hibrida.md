# Validação de Contratos — modelo híbrido (LLM extrai, código valida)

Plano de implementação por etapas. Decisão (2026-06-02): arquitetura **híbrida** —
o LLM só **extrai/classifica**; o **código** ([validate.ts](../../../src/lib/contracts/validate.ts))
faz toda comparação exata, datas, cronograma, BV e o veredito. Cada etapa é
independente e entregável sozinha; fazer na ordem.

> Estado atual (já em produção): regra dos R$ 10.000 (banco/assinatura só acima),
> atalho FEE/Cerimonial e R10 (faixa R$ 1.000) já implementados. O que segue é o
> incremento do prompt colado pelo Marcelo.

---

## Etapa 0 — Prompt de extração enriquecido  *(baixo risco, sem dado novo da RP)*

**Objetivo:** capturar os campos que as regras novas vão precisar, sem mudar veredito.

- `src/lib/contracts/llm.ts` → trocar `buildPrompt` pela versão híbrida (NFS-e =
  tomador; `data_contrato`; `pagamentoX_obs` pra % ; reforço anti-alucinação;
  LLM não dá status).
- `src/lib/contracts/types.ts` → `ContractExtraction` ganha `data_contrato` e
  `pagamentoX_obs`. `ExtractedContract` ganha `data_contrato`.
- **Migration:** colunas em `contract_validation_items`: `data_contrato date`,
  (parcelas/obs já cabem em `extracted_pagamentos`/`raw_extraction`).
- `process-batch.ts` → gravar `data_contrato` na fase de extração.
- **Sem mudança de comportamento de aprovação.** Só passa a ter mais dado salvo.

**Risco:** baixo. Validável com `npm run build` + reprocessar um lote pequeno.

---

## Etapa 1 — Comparações determinísticas afinadas  *(baixo risco)*

**Objetivo:** alinhar as comparações ao texto novo, sem depender de dado da RP.

- `VALUE_TOLERANCE`: 0,01 → **0,02** ([validate.ts](../../../src/lib/contracts/validate.ts)).
- NFS-e tomador: já resolvido na Etapa 0 (extração entrega o nome certo) — validar.
- Parcela em %: o código passa a aceitar `pagamentoX_valor` calculado pelo LLM
  (já vem pronto) e cruza com `valor` da RP.

**Risco:** baixo. Mexe só em constante/comparação. Cobrir com testes de mesa.

---

## Etapa 2 — Status "Aprovada com ressalva" + vencimento  *(médio — mexe em enum)*

**Objetivo:** introduzir o estado intermediário "ressalva" e a checagem de prazo.

- **Migration:** adicionar valor ao enum/constraint de status. Mapeamento sugerido:
  - "Aprovada com ressalva" → novo `aprovada_ressalva`.
  - "Não aplicável" (FEE/Cerimonial) → manter `analise_especialista` (já é o
    comportamento atual do atalho) **ou** criar `nao_aplicavel` — decidir.
- `types.ts` `ValidationStatus` += novo(s) valor(es).
- `validate.ts` → quando tudo confere mas falta banco (contrato ≥10k) **ou**
  vencimento > data prevista → `aprovada_ressalva` em vez de `aprovada`.
- **Depende de dado novo da RP:** `data_pagamento_prevista` (ver Etapa 4 plumbing).
  A parte "falta banco ≥10k" não depende de dado novo e pode vir antes.
- UI/contadores (`process-batch` fase 3, telas de lote) → contabilizar o novo status.

**Risco:** médio. Enum em produção + telas que contam status. Testar contadores.

---

## Etapa 3 — Plumbing dos dados da RP  *(médio — upload + DB + pipeline)*

**Objetivo:** trazer pro fluxo os campos da RP que as regras 4/5 exigem.

Campos novos na RP (vêm da planilha de upload):
`data_evento`, `modulo` (1–5), `valor_total_contrato`, `historico_rps_pagas`,
`data_pagamento_prevista`.

- `parse-xlsx.ts` → novos aliases de cabeçalho + parse (datas/números).
- `RequisitionRow` / `RequisitionInput` (types.ts) → novos campos.
- **Migration:** colunas correspondentes em `contract_validation_items`.
- `batches/route.ts` → incluir no `itemsToInsert`.
- `process-batch.ts` → repassar pro `analisarRequisicao`.

**Risco:** médio. Sem esses campos, Etapas 4/5 não rodam. Planilha antiga continua
funcionando (campos ausentes = regra não dispara).

---

## Etapa 4 — Cronograma por módulo  *(lógica nova, isolada)*

**Objetivo:** alerta (nunca reprova) quando a contratação cai fora da janela do módulo.

- Só roda se vierem `modulo` **e** `data_evento` (Etapa 3) **e** `data_contrato` (Etapa 0).
- Antecedência = `data_evento − data_contrato`. Janelas:
  - M1 Fotografia: até 3 meses **após** o fechamento.
  - M2 Local: 18–6 meses antes.
  - M3 Atração/Buffet: 12–6 meses antes.
  - M4 Complementos: 6–1 mês antes.
  - M5 Segurança/Staff: 3 meses–7 dias antes.
- Fora da janela → **alerta**, mantém o status dos demais critérios.
- Precisa de um campo `alertas text[]` (ou reusar `status_motivos` com prefixo).

**Risco:** baixo-médio. Lógica de data isolada; não muda veredito.

---

## Etapa 5 — BV (saldo do contrato)  *(lógica nova — DESENHO ATUALIZADO 2026-06-02)*

**Objetivo:** impedir que RPs acumuladas estourem o valor do contrato.

**Decisão do Marcelo (2026-06-02):** o total já pago **não** é uma coluna manual da
RP. Em vez disso: o Marcelo sobe uma **planilha-banco com TODAS as RPs já pagas**. O
sistema procura, nessa base, registros com **mesmo fundo + mesmo fornecedor** e
confere se é **o mesmo contrato**; se for, calcula:

  `saldo = valor_total_contrato − Σ(RPs já pagas do mesmo contrato)`

e a RP atual só passa se couber no saldo.

Implicações (a resolver no início da Etapa 5):
- **Nova base de dados de RPs pagas** (tabela + upload próprio): precisa de fundo,
  fornecedor, identificador do contrato e valor pago por linha.
- **Campo `fundo` na RP** (hoje NÃO capturado — nem na Etapa 3). Precisa de mais um
  campo na planilha de validação + coluna.
- **Como identificar "o mesmo contrato"?** número do contrato? ou a combinação
  fundo+fornecedor+valor_total? (decidir — é a chave do matching).
- A coluna manual `historico_rps_pagas` (criada na Etapa 3) pode virar um override
  opcional, ou ser descartada em favor do cálculo automático.
- Relação com `verificar_saldo` (heurístico por parcela): tendo a base de pagos, o
  BV exato manda; `verificar_saldo` vira fallback quando não há base.

**Risco:** alto. É praticamente um subprojeto (nova base + matching). Validar a
qualidade do match (fundo+fornecedor+contrato) antes de ligar o "reprova".

---

## Decisões em aberto (resolver antes de cada etapa)
1. "Não aplicável" vira status próprio ou continua mapeado em `analise_especialista`?
2. `historico_rps_pagas` — de onde vem? (planilha manual vs cálculo do próprio sistema
   somando RPs do mesmo contrato). Impacta a confiabilidade da Etapa 5.
3. `verificar_saldo` (parcial, heurístico) convive com o BV (exato) ou é substituído?
4. Tolerância 0,02 vale pra todos os tipos ou só alguns?

## Ordem recomendada
0 → 1 → 2 (parte "falta banco") → 3 → 2 (parte "vencimento") → 4 → 5.
As etapas 0/1 já entregam valor (extração melhor + tolerância) sem risco de enum/plumbing.
