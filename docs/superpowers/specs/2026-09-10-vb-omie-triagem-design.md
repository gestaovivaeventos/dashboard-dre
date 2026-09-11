# VB — Triagem dos pagamentos da Omie (ABD Holding) — Design

**Data:** 2026-09-10 · **Módulo:** VB (Viva Bank) · **Depende de:** `2026-09-09-vb-viva-bank-design.md` e do "Novo lançamento" multi-linha (`vb_entries.group_id`).

## 1. Problema e decisão

Os resgates, juros e dividendos que a ABD Holding paga aos credores do VB são lançados na Omie e depois digitados de novo no VB. O gestor quer ver, dentro do VB, **todos os pagamentos da ABD Holding a partir de 10/09/2026**, com a categoria do plano de contas, e decidir um a um: **descartar** (não é do VB) ou **vincular** a um ou mais credores como débito ou crédito. O passado não entra: o extrato importado da planilha já contém os resgates de agosto e setembro (conferido: Sotrate 01/09, Mylliano 20/08, Renato 05/08).

Decisões fechadas com o dono do projeto:

- **Só pagamentos** (`financial_entries.type = 'despesa'`). Recebimentos ficam fora (quase tudo é repasse entre empresas); a inclusão futura é uma constante.
- **Fonte é o sync do DRE, não uma integração nova.** A ABD Holding já sincroniza com a Omie todo dia (cron `sync-all`, janela de 3 dias) e os movimentos já estão em `financial_entries`, com fornecedor, descrição, categoria e data de pagamento.
- **Frequência**: o sync diário cobre o normal; a tela tem o botão **"Buscar na Omie"** para atualizar agora (15 a 30 s). Nada de sincronizar ao carregar a página: a Omie é lenta e falha (HTTP 500 hoje mesmo), e a tela não pode depender dela para abrir.
- **Vincular reaproveita o "Novo lançamento"** multi-linha: o movimento abre o diálogo já preenchido e o gestor pode dividir entre vários credores (dividendo anual).
- **Nada muda no extrato do credor**: sem marca "veio da Omie", pelo mesmo motivo da planilha. A rastreabilidade fica na aba Vinculados.

## 2. O que já existe e é reaproveitado

| Peça | Onde | Como o VB usa |
|---|---|---|
| Movimentos da Omie | `financial_entries` (upsert por `(company_id, omie_id)`, `omie_id` determinístico) | Leitura direta, filtrada por empresa, tipo e data. A identidade estável por `omie_id` é o que permite guardar a decisão por movimento. |
| Limpeza de obsoletos | `cleanup_obsolete_entries` no fim de cada sync | Um pagamento apagado na Omie **some** de `financial_entries` (dentro da janela sincronizada). Por isso a decisão guarda um **retrato** do movimento (seção 4). |
| Nomes do plano de contas | `omie_categories (company_id, code, description)` | Join por código para exibir "Pagamento de Empréstimos" em vez de `2.05.03`. |
| Sync manual | `runCompanySyncAsSystem(companyId, "rolling")` (`src/lib/omie/sync.ts`) — o mesmo modo do cron | Botão "Buscar na Omie". |
| Última atualização | `sync_log (company_id, status, started_at, finished_at)` | "Omie atualizada às 16:42" e trava de concorrência. |
| Lançamento multi-linha | `src/components/vb/new-entry-dialog.tsx`, `src/lib/vb/new-entries.ts` (`buildEntryRows`), `vb_entries.group_id` | Vincular = mesmas linhas, mesmo `group_id`, gravadas junto com a decisão. |
| Acesso | `requireVbGestor()` (`src/lib/vb/auth.ts`), gate de `/vb/*` em `canAccessPathByProfile` | Tela e ações só para `gestor`. |

Empresa e recorte ficam em constantes (`src/lib/vb/omie/config.ts`), no mesmo espírito de `restricted-companies.ts` (empresa fixada por id no código, com o nome ao lado):

```ts
export const VB_OMIE_COMPANY_ID = "85ce50b8-571a-49d2-b279-9a8d08cbe4ae"; // ABD Holding
export const VB_OMIE_COMPANY_NAME = "ABD Holding";
/** Inclusivo. Antes disso o extrato importado já cobre. */
export const VB_OMIE_START_DATE = "2026-09-10";
/** Tipos de movimento que entram na triagem. Recebimentos: acrescentar "receita". */
export const VB_OMIE_TYPES = ["despesa"] as const;
```

## 3. Regras de negócio

1. **Candidato** = linha de `financial_entries` com `company_id = ABD`, `type` em `VB_OMIE_TYPES` e `payment_date >= VB_OMIE_START_DATE`. Só candidatos aparecem e só candidatos aceitam decisão.
2. **Estados de um movimento**: *pendente* (não tem linha em `vb_omie_triage`), *vinculado*, *descartado*. **Uma decisão por movimento**: chave única `(company_id, omie_id)`.
3. **Descartar** grava a decisão com o retrato do movimento. É reversível: **Restaurar** apaga a decisão e o movimento volta a pendente. Sem diálogo de confirmação (é reversível e frequente).
4. **Vincular** abre o diálogo de lançamento preenchido com: data = data do pagamento; descrição = descrição da Omie (cortada em 300 caracteres); uma linha com credor sugerido (ou o primeiro ativo), tipo sugerido (ou saída) e o valor do pagamento. O gestor edita tudo, inclusive acrescentar linhas. Ao gravar: os lançamentos entram como `aprovado` (como qualquer lançamento manual) com um `group_id`, e a decisão `vinculado` guarda esse `group_id` e o retrato. O total das linhas **não precisa** bater com o valor da Omie (pode ser parcial, pode ter arredondamento); o rodapé do diálogo mostra "Omie: R$ X" e avisa em âmbar quando o total difere. Nunca bloqueia.
5. **Desvincular** (na aba Vinculados, com confirmação): apaga os lançamentos do `group_id` e depois a decisão. O movimento volta a pendente se ainda existir na Omie. É a única forma de apagar lançamento aprovado nesta fase, e só alcança lançamentos nascidos de um vínculo.
6. **Sugestões** (só sugestão, nunca decisão automática):
   - **Tipo** pela categoria: `2.05.03` Pagamento de Empréstimos → saída; `2.05.01` Juros sobre Empréstimos → saída; `2.10.98` Pagamento de Dividendo (Anual) → entrada. Outras: saída (é um pagamento).
   - **Credor** pela memória: o credor da primeira linha do último vínculo com o mesmo `supplier_customer`. Sem memória, por nome: cada token do nome do credor (sem acento, sem caixa) tem de ser prefixo de um token **distinto** do fornecedor, na ordem ("Maria Ap" casa "MARIA APARECIDA GOMES ALMEIDA"; "Sotrate" casa "FERNANDO SOTRATE FERREIRA"; "Pedro P" casa "PEDRO PAULO" mas não "PEDRO HENRIQUE", porque o "P" não pode reaproveitar o token PEDRO). Só credores ativos; se mais de um casar, sem sugestão.
7. **Movimento que mudou depois da decisão**: se sumiu da Omie, a aba Vinculados mostra "não consta mais na Omie"; se o valor mudou, mostra "valor na Omie agora é R$ X". Os lançamentos do VB não mudam sozinhos — o gestor desvincula e refaz se quiser.
8. **Extrato do credor não muda.** O lançamento vinculado é um lançamento aprovado comum.
9. **Acesso**: só `gestor`. `credor` não vê o item de menu e `/vb/omie` redireciona para `/vb`.

## 4. Modelo de dados

Migration `supabase/migrations/20260910130000_vb_omie_triage.sql` (DDL apresentado ao dono antes de rodar, como manda a regra do projeto):

```sql
CREATE TABLE IF NOT EXISTS public.vb_omie_triage (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id         UUID NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  omie_id            TEXT NOT NULL,
  -- Conveniência para o join; o sync pode apagar o movimento, a decisão fica.
  financial_entry_id UUID NULL REFERENCES public.financial_entries(id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('vinculado', 'descartado')),
  -- Vinculado: grupo dos lançamentos criados (vb_entries.group_id).
  group_id           UUID NULL,
  -- Retrato do movimento no momento da decisão.
  payment_date       DATE NOT NULL,
  supplier_customer  TEXT NULL,
  description        TEXT NULL,
  category_code      TEXT NULL,
  category_name      TEXT NULL,
  value              NUMERIC(14,2) NOT NULL,
  decided_by         UUID NULL REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT vb_omie_triage_one_decision UNIQUE (company_id, omie_id),
  CONSTRAINT vb_omie_triage_linked_has_group CHECK (status <> 'vinculado' OR group_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS vb_omie_triage_group_idx ON public.vb_omie_triage (group_id) WHERE group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vb_omie_triage_supplier_idx ON public.vb_omie_triage (company_id, supplier_customer, decided_at DESC);

DROP TRIGGER IF EXISTS vb_omie_triage_touch_updated_at ON public.vb_omie_triage;
CREATE TRIGGER vb_omie_triage_touch_updated_at BEFORE UPDATE ON public.vb_omie_triage
  FOR EACH ROW EXECUTE FUNCTION public.vb_touch_updated_at();

ALTER TABLE public.vb_omie_triage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vb_omie_triage_select ON public.vb_omie_triage;
CREATE POLICY vb_omie_triage_select ON public.vb_omie_triage
  FOR SELECT TO authenticated USING (public.vb_role() = 'gestor');
-- Sem policy de escrita: só o service role grava (actions depois de requireVbGestor()).
```

Nenhuma função `SECURITY DEFINER` nova. `vb_entries` não muda: o vínculo é o `group_id` que já existe.

**Pendentes não são gravados**: pendente = candidato sem linha na triagem. Assim um sync novo faz um pagamento aparecer sozinho, e um pagamento apagado na Omie some sozinho, sem rotina de reconciliação.

## 5. Leitura e escrita

Tudo com o **admin client depois de `requireVbGestor()`** (leitura inclusive): as policies de `financial_entries` dependem de vínculo com a empresa, que um gestor do VB não precisa ter.

`src/lib/vb/omie/queries.ts` (server-only):

- `listPendingMovements()` → candidatos sem decisão, com `category_name` de `omie_categories`, ordenados por `payment_date` desc, `created_at` desc. Tipo `VbOmieMovement { id, omie_id, payment_date, supplier_customer, description, category_code, category_name, value, document_number }`.
- `countPendingMovements()` → para o badge do menu e a faixa da Visão geral.
- `listTriage(status)` → decisões com: retrato; `live` (o movimento atual, se ainda existir, para os avisos da regra 7); para vinculados, os lançamentos do grupo (`creditor_name, kind, amount`, ordem `sort_order`); nome de quem decidiu.
- `suggestionMemory()` → `Map<supplier_customer, creditor_id>` a partir dos vínculos (credor da linha `sort_order = 0`), o mais recente por fornecedor.
- `getOmieSyncStatus()` → último `sync_log` da ABD: `{ finishedAt, status, running }` (`running` = status `running` iniciado há menos de 5 min).

`src/lib/vb/actions/omie.ts` (server actions, `requireVbGestor()` em todas, `VbActionResult`):

- `discardOmieMovement(omieId)`: relê o candidato (tem de existir e ser candidato); insere `descartado` com retrato. Violação da chave única → "Este movimento já foi decidido."
- `restoreOmieMovement(omieId)`: apaga a decisão `descartado`.
- `linkOmieMovement(input)` com `input = NewEntriesInput & { omie_id }`: relê o candidato; `newEntriesSchema` + `buildEntryRows` com um `group_id` novo; **insere os lançamentos** (um INSERT); **insere a decisão** `vinculado` (retrato + `group_id`). Se a decisão falhar, **apaga os lançamentos do grupo** e devolve o erro (chave única → "já foi decidido"). Duas escritas com compensação em vez de função SQL: volume baixo, e a chave única impede o duplo vínculo mesmo em corrida.
- `unlinkOmieMovement(omieId)`: lê a decisão `vinculado`; apaga `vb_entries` do `group_id` (tolera zero linhas, para reexecução); apaga a decisão.
- `syncOmieNow()`: se `getOmieSyncStatus().running`, "Sincronização em andamento."; senão `runCompanySyncAsSystem(VB_OMIE_COMPANY_ID, "rolling")` e devolve `{ ok, recordsImported }`. Erro da Omie vira mensagem, nunca quebra a página.

Todas revalidam `/vb` e `/vb/omie`; vincular e desvincular revalidam também as páginas dos credores envolvidos.

## 6. Lógica pura (testável sem banco) — `src/lib/vb/omie/suggest.ts`

- `isCandidateMovement(row, today?)`: empresa, tipo e data (inclusiva).
- `suggestKind(categoryCode)`: mapa da regra 6, default `saida`.
- `suggestCreditor(supplier, creditors, memory)`: memória primeiro, depois casamento por tokens; retorna `creditorId | null`.
- `prefillFromMovement(movement, creditors, memory)` → `{ date, description, lines: [{ creditorId, kind, amount }] }` para o diálogo.

## 7. Telas

### `/vb/omie` — "Omie · ABD Holding" (gestor)

Cabeçalho: título, subtítulo "Pagamentos desde 10/09/2026. Descarte o que não é do VB; vincule o que é." À direita: "Omie atualizada às 16:42" (ou "sincronizando…") e o botão **Buscar na Omie** (spinner enquanto roda; toast "N movimentos importados" ou o erro).

Abas com contagem, via `?aba=pendentes|vinculados|descartados` (padrão pendentes). Uma tabela por aba, no padrão de extrato do módulo (13 px, linhas curtas, mais recente em cima):

- **Pendentes**: Data · Fornecedor · Descrição · Categoria · Valor (vermelho, é saída de caixa) · Sugestão (chip "Renato · saída" ou "—") · ações **Vincular** / **Descartar**. Filtros: chips de categoria (as presentes na lista) e busca em fornecedor/descrição. Vazio: "Nenhum pagamento aguardando. O sync diário traz os novos; 'Buscar na Omie' traz agora."
- **Vinculados**: Data · Fornecedor · Descrição · Valor Omie · Lançado (uma linha por lançamento do grupo: credor · tipo · valor) · Por/quando · **Desvincular** (confirmação: "Apaga N lançamento(s) do VB e devolve o movimento para pendentes."). Avisos da regra 7 em âmbar na própria linha.
- **Descartados**: Data · Fornecedor · Descrição · Categoria · Valor · Por/quando · **Restaurar**.

Vincular abre o diálogo de lançamento (seção 8) preenchido; ao gravar, toast "Vinculado a Renato" (ou "a 3 credores"), a linha some dos pendentes.

### Menu e Visão geral

- Grupo VB ganha o item **"Omie"** (`VB_NAV_KEY_OMIE = "vb-omie"`, `href /vb/omie`, ícone `Inbox`, `vbAccess: true, vbGestorOnly: true`) com **badge** = pendentes. O `RenderItem` do menu já tem `badge?: number` que ninguém preenche: `AppShell`/`NavLinks` ganham `navBadges?: Record<string, number>` e `buildGroups` copia `navBadges[item.key]` quando > 0. O layout `(vb)` calcula o número (admin client) e passa.
- **Visão geral**: quando há pendentes, faixa âmbar (igual à do lote pendente) "N pagamentos da Omie aguardam triagem" com link **Triar**.

## 8. Componentes

- `src/components/vb/new-entry-dialog.tsx` é dividido: `VbEntryDialog` (controlado: `open`, `onOpenChange`, `initial`, `omie?: { omieId, value }`, `onSaved`) concentra o formulário; `VbNewEntryDialog` vira só o botão + estado, chamando o primeiro. Com `omie` presente o diálogo chama `linkOmieMovement` em vez de `createVbEntries`, mostra "Omie: R$ X" no rodapé e o aviso âmbar quando o total das linhas difere.
- `src/components/vb/omie-triage.tsx` (client): abas, filtros, as três tabelas, ações com `useTransition` e toasts, diálogo de confirmação do desvincular, e o `VbEntryDialog`. Recebe do server component os dados prontos (movimentos, decisões, credores, memória, status do sync).
- `src/app/(vb)/vb/omie/page.tsx` (server, `force-dynamic`): gate de gestor, carrega tudo em `Promise.all`, renderiza cabeçalho + `omie-triage`.

## 9. Fora de escopo (decidido)

- Recebimentos (`receita`) — uma constante.
- Títulos a pagar ainda não baixados (previsão).
- Outras empresas da Omie.
- Marca de origem Omie no extrato do credor.
- Editar lançamento aprovado (só desvincular e refazer).
- Sync ao carregar a página.

## 10. Verificação

- **Unitários** (node test runner, sem banco): `suggest.test.ts` — memória vence nome; "Maria Ap" → MARIA APARECIDA; "Pedro P" casa "PEDRO PAULO" e não casa "PEDRO HENRIQUE" (tokens distintos, na ordem); dois credores casando → null; credor inativo ignorado; `suggestKind` dos três códigos e default; `isCandidateMovement` com data inclusiva, tipo e empresa; `prefillFromMovement` corta descrição em 300 e traz o valor como string BR. Teste de render (react-dom/server) da tabela de pendentes: ordem mais recente primeiro, chip de sugestão, sem a palavra "planilha".
- **Manual (dono do projeto, produção)**: abrir `/vb/omie` → pendentes mostram o "APORTE EMPRESA" de 10/09 (Aumento de capital em controlada) → Descartar → aparece em Descartados → Restaurar. "Buscar na Omie" → toast. Vincular um pagamento real → conferir no extrato do credor e na aba Vinculados → Desvincular → some do extrato e volta a pendente.
- `npm run lint`, `npm test`, `npx tsc --noEmit`. Sem `npm run build` com o dev server de pé.
- `CLAUDE.md`: seção do VB ganha o parágrafo "Triagem da Omie" (fonte, recorte, estados, compensação do vínculo, admin client na leitura).
