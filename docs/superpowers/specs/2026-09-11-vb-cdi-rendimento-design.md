# VB — Rendimento automático por CDI — Design

**Data:** 2026-09-11 · **Módulo:** VB (Viva Bank) · **Depende de:** `2026-09-09-vb-viva-bank-design.md` (modelo de lançamentos) e do lançamento multi-linha (`vb_entries.group_id`).

## 1. Problema e decisão

O saldo de cada credor rende 100% do CDI enquanto fica parado. Hoje isso é feito fora do sistema e parou: o último rendimento lançado varia de 27/10/2025 (Renato) a 09/07/2026 (Maria Ap). O dono quer que o sistema calcule sozinho, com o CDI real de cada dia, e que exista um botão para fechar o rendimento quando ele quiser.

Decisões fechadas com o dono:

- **Sem retroativo.** O passado fica como está; o CDI passa a render a partir de agora. Marco zero: `VB_CDI_START_DATE = "2026-09-10"`, a última data com CDI publicado quando o regime entrou — o primeiro dia que rende é 11/09/2026.
- **Fonte:** série 12 do SGS do Banco Central (CDI diário, % ao dia). Guardada em tabela própria.
- **Só saldo positivo rende.** Saldo negativo não rende e não é cobrado.
- **Credor encerrado (`active = false`) fica de fora.**
- **Lançamento retroativo não reabre período fechado**: o sistema avisa em vez de recalcular o passado, senão o extrato mudaria embaixo de um saldo já conferido.
- **Um lançamento de rendimento por período de saldo parado**, como o histórico já faz — não um consolidado por rodada.

## 2. O que já existe e é reaproveitado

| Peça | Onde | Como é usada |
|---|---|---|
| Chamada ao SGS do Banco Central | `src/app/api/home/indicators/route.ts` (séries 432 e 433) | Mesmo padrão de URL e parsing; o VB ganha o seu próprio módulo, sem acoplar à tela de indicadores. |
| Modelo de rendimento | `vb_entries` com `kind='rendimento'`, `period_start`, `period_end`, `days`, `rate`, `rate_basis` | `rate_basis='cdi'` já existe no CHECK da tabela, reservado exatamente para isto. Nada muda no schema de lançamentos. |
| Ordem e saldo do extrato | `src/lib/vb/ledger.ts` (`sortLedger`, `currentBalance`) | O motor de rendimento monta a linha do tempo com as mesmas regras de ordenação. |
| Acesso | `requireVbGestor()`, gate de `/vb` | Prévia e gravação só para gestor. |
| Dinheiro em centavos | `src/lib/vb/money.ts` (`roundCents`, `toCents`, `sumCents`) | Todo arredondamento do rendimento passa por aqui. |
| Cron autenticado | `vercel.json` + `Authorization: Bearer <CRON_SECRET>` | A busca diária do CDI entra como mais um cron. |

## 3. A API do Banco Central

`https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=DD/MM/YYYY&dataFinal=DD/MM/YYYY`

- Resposta: `[{"data":"10/09/2026","valor":"0.051660"}]`. `valor` é **percentual ao dia** (0,05166% a.d.), string com ponto decimal.
- **Só existem dias úteis.** Fim de semana e feriado bancário simplesmente não vêm — não é preciso calendário de feriados no código, a própria série é o calendário.
- **Intervalo sem dados devolve HTTP 404** com corpo `{"erro":{...}}`, não lista vazia. O código trata 404 como "nenhuma taxa nova", nunca como falha.
- A taxa de um dia sai no dia seguinte. A última disponível é sempre D-1 ou anterior.

## 4. Regras de negócio

1. **Intervalo meio aberto.** O rendimento de um período `(start, end]` usa as taxas das datas `d` com `start < d <= end`. Assim o dia em que um período fecha é o mesmo em que o próximo abre e a taxa dele conta uma vez só. `days = end − start`, a mesma convenção do histórico importado.
2. **Ponto de partida de um credor** = `period_end` do último rendimento dele com `rate_basis='cdi'`; sem nenhum, `VB_CDI_START_DATE`.
3. **Fim do cálculo** = a maior data em `vb_cdi_rates`. Nunca o dia de hoje.
4. **Segmentos de saldo parado.** Entre o ponto de partida e o fim, cada data que tem lançamento aprovado fecha um segmento e abre o próximo. O saldo de um segmento é a soma de todos os lançamentos aprovados com `entry_date <= início do segmento`.
5. **Fator do segmento** = produto de `(1 + taxa/100)` das datas do intervalo meio aberto. **Rendimento** = `saldo × (fator − 1)`, arredondado em centavos. Segmento com saldo ≤ 0, ou fator 1 (nenhum dia útil dentro), não vira lançamento.
6. **O rendimento entra no extrato em `period_end`**, com `kind='rendimento'`, `rate = fator − 1`, `rate_basis='cdi'`, `status='aprovado'`, `description = "Rendimento CDI"`. Como ele é um lançamento, o segmento seguinte rende sobre ele: juros sobre juros sai de graça.
7. **O motor é independente de ordem.** Ele reconstrói os segmentos a partir da linha do tempo de lançamentos, então lançar um movimento sem antes fechar o rendimento não corrompe nada: o cálculo seguinte quebra o período naquela data do mesmo jeito. É isso que permite que o fechamento automático no lançamento manual seja conveniência, e não requisito de correção.
8. **Idempotência.** Rodar duas vezes no mesmo dia não duplica: a segunda execução parte do `period_end` que a primeira gravou e não encontra dia novo.
9. **Retroativo.** Um lançamento com `entry_date` anterior ao ponto de partida do credor não dispara recálculo. A ação devolve um aviso (`retroativo`) que a tela mostra, e o rendimento já lançado fica como está.

## 5. Modelo de dados

Migration `supabase/migrations/20260911140000_vb_cdi_rates.sql`:

```sql
-- CDI diário do Banco Central (série 12 do SGS), um registro por dia útil.
-- Guardado em vez de consultado na hora para o cálculo ser reproduzível e
-- auditável, e para o dia em que o BCB estiver fora do ar não travar nada.
CREATE TABLE IF NOT EXISTS public.vb_cdi_rates (
  rate_date  DATE PRIMARY KEY,
  -- Percentual ao dia, como o BCB publica: 0.051660 = 0,05166% a.d.
  rate       NUMERIC(12,8) NOT NULL CHECK (rate >= 0),
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.vb_cdi_rates ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vb_cdi_rates_select ON public.vb_cdi_rates;
CREATE POLICY vb_cdi_rates_select ON public.vb_cdi_rates
  FOR SELECT TO authenticated USING (public.vb_role() IS NOT NULL);
-- Sem policy de escrita: só o service role grava.

COMMENT ON TABLE public.vb_cdi_rates IS
  'CDI diário (série 12 do SGS/BCB) usado para o rendimento automático do VB.';
```

Nenhuma mudança em `vb_entries`: `rate_basis='cdi'` já é aceito pelo CHECK existente.

## 6. Módulos

### `src/lib/vb/cdi/config.ts`
```ts
export const VB_CDI_SGS_SERIES = 12;
/** Marco zero: nenhum dia anterior a este rende. */
export const VB_CDI_START_DATE = "2026-09-10";
export const VB_CDI_DESCRIPTION = "Rendimento CDI";
```

### `src/lib/vb/cdi/bcb.ts` — fronteira com o Banco Central
`fetchCdiRange(from: string, to: string): Promise<Array<{ rate_date: string; rate: number }>>` — converte `DD/MM/YYYY` para ISO e `valor` para número; **404 devolve `[]`**; erro de rede ou corpo inesperado lança.

### `src/lib/vb/cdi/accrual.ts` — o cálculo, puro e testado
- `accumulatedFactor(rates: ReadonlyMap<string, number>, after: string, until: string): number` — produto de `(1 + rate/100)` para `after < d <= until`.
- `planAccrual(input: { entries: LedgerEntryLike[]; rates: ReadonlyMap<string, number>; from: string; until: string }): AccrualSegment[]` — devolve `{ period_start, period_end, days, balance, factor, rate, amount }` por segmento com rendimento.
- Nenhum acesso a banco ou rede.

### `src/lib/vb/cdi/sync.ts`
`syncCdiRates(): Promise<{ inserted: number; lastDate: string | null }>` — busca da maior data gravada (ou `VB_CDI_START_DATE`) até hoje e faz upsert. Chamado pelo cron e pelo botão.

### `src/lib/vb/cdi/queries.ts`
- `loadCdiRates(from: string): Promise<Map<string, number>>`
- `lastCdiDate(): Promise<string | null>`
- `accrualStartFor(creditorId: string): Promise<string>` — último `period_end` com `rate_basis='cdi'`, senão `VB_CDI_START_DATE`.

### `src/lib/vb/actions/cdi.ts` — server actions (`requireVbGestor()`)
- `previewCdiAccrual(): Promise<VbActionResult<{ items: AccrualPreviewItem[]; total: number; lastRateDate: string | null }>>` — sincroniza as taxas, calcula para todo credor ativo e devolve sem gravar.
- `postCdiAccrual(): Promise<VbActionResult<{ created: number; total: number }>>` — **recalcula no servidor** (nunca confia na prévia do cliente) e grava num único INSERT, com `group_id` comum à rodada.
- `accrueBeforeEntry(creditorIds, upTo)` — usado por `createVbEntries`; devolve `{ created, retroativo }` e **nunca derruba o lançamento**: falha vira aviso.

### `src/app/api/cron/vb-cdi/route.ts`
`Authorization: Bearer <CRON_SECRET>`. Só busca e grava taxas — **não lança rendimento**, senão o extrato ganharia uma linha por dia. Entra em `vercel.json` como `0 11 * * 1-5` (08:00 BRT, dia útil).

## 7. Telas

- **Visão geral do VB** ganha o botão **"Calcular rendimento"**, ao lado de "Novo lançamento", e a legenda "CDI até dd/mm".
- O botão abre um diálogo de prévia com uma linha por segmento: credor, período, saldo base, taxa acumulada e valor, com o total no rodapé. Botões "Cancelar" e "Lançar rendimento".
- Nada a lançar mostra "Nenhum rendimento a lançar até dd/mm".
- Depois de gravar: toast com o total e `router.refresh()`.
- No extrato do credor o rendimento aparece como qualquer outro, em azul, com o período na descrição — sem marca de automático.

## 8. Fora de escopo

- Retroativo anterior ao marco zero.
- Cobrança de CDI sobre saldo negativo.
- Taxa diferente de 100% do CDI por credor.
- Lançamento automático diário pelo cron.
- Recalcular rendimento já lançado.

## 9. Verificação

- **Unitários** (`accrual.test.ts`, sem banco): fator acumulado respeita o intervalo meio aberto; dia sem taxa é ignorado; segmento quebra na data de cada lançamento; saldo negativo e saldo zero não geram lançamento; juros sobre juros entre dois segmentos; idempotência (rodar a partir do `period_end` gerado não produz nada); arredondamento em centavos.
- **`bcb.test.ts`**: parsing de `DD/MM/YYYY` e de `valor`; 404 vira lista vazia.
- **Conferência com a realidade**: script `npx tsx scripts/vb-cdi-check.ts` que aplica o motor sobre um período já fechado do histórico e compara com a taxa que a planilha usou, mostrando a diferença. Não toca o banco.
- **Manual, em produção**: abrir a prévia, conferir um credor à mão (saldo × fator), lançar, ver no extrato, e clicar de novo para confirmar que não duplica.
- `npm run lint`, `npm test`, `npx tsc --noEmit`. Sem `npm run build` com o dev server de pé.
- `CLAUDE.md`: a seção do VB ganha o parágrafo "Rendimento por CDI".
