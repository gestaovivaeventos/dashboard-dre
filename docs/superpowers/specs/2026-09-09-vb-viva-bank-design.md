# Módulo VB (Viva Bank) — desenho

Data: 2026-09-09. Status: aprovado em conversa, aguardando revisão da spec.

## 1. Contexto

Durante a construção do salão Terrazzo, o grupo tomou empréstimos de sócios e
pessoas próximas. O controle desses créditos vive numa planilha Excel chamada
**VB** ("Viva Bank"): `docs/VB TERRAZZO V2.xlsx`. Cada credor tem uma aba com o
razão dele — aportes, resgates, pagamentos feitos por conta do credor, PLR
creditada, e linhas de RENDIMENTO (juros) por período, com o saldo acumulado.

O juro mudou de método ao longo do tempo:

| Época | Método na planilha | Como a taxa aparece |
|---|---|---|
| 2016 → set/2023 | `FV(taxa_diária, dias, 0, -saldo) - saldo`, com `taxa_diária = (1+taxa_mensal)^(1/30,6) - 1` | taxa mensal (1%, 0,75%, 0,6%, 0,38%, 0,5%…) |
| 2022 → 2023 (alguns credores) | valor digitado ou `=<saldo_alvo> - H<n>` para bater com extrato externo | sem taxa |
| set/2023 → hoje | `saldo × taxa_do_período` | CDI acumulado entre as datas (ex.: 3,35% no 1º tri/2026); hoje 100% do CDI |

A planilha tem 9 abas de credor (6 ativas: Pedro P, Vitor, Maria Ap, Sotrate,
Mylliano (Sr Jorge), Renato; 3 ocultas e zeradas: Fabio, Mirai, Renan), uma aba
"Mylliano" vazia (duplicata) e abas fora do VB (Resumo, dividendos 2024,
Propostas socios 2025/2026, Imoveis). Saldo total em 09/2026: R$ 2.368.211,67;
o Mylliano está negativo (R$ -258.593,57 — ele deve ao VB).

Conferido em 09/09/2026: para os 9 credores, a soma das linhas arredondadas a
centavos fecha com o saldo final da planilha com diferença máxima de R$ 0,04.

## 2. Objetivo e escopo

**Objetivo desta fase**: trazer todo o histórico da planilha para dentro do
Control Hub, com revisão e aprovação explícita antes de virar oficial, numa
interface que mostre os lançamentos de forma clara. O módulo fica visível só
para o Marcelo.

**Entra nesta fase**

1. Módulo `vb` com acesso concedido por usuário (sem override de admin).
2. Tabelas `vb_creditors`, `vb_entries`, `vb_import_batches` + RLS.
3. Importação do `.xlsx` com revisão e aprovação.
4. Telas: Visão geral, Extrato do credor, Importação (lista + revisão), Novo
   lançamento manual.
5. Script de verificação que reconcilia a planilha real.

**Fica para depois** (o modelo já prevê, mas não é construído agora)

- Sócio acessando o próprio extrato (papel `credor`) e o botão do módulo em
  Usuários > "Módulos visíveis".
- Juros automáticos com o CDI do Banco Central fechando cada período.
- Importação de lançamentos da Omie.
- Editar/excluir lançamentos já aprovados.

## 3. Decisões-chave

1. **Histórico congelado.** Cada linha da planilha vira um lançamento com o
   valor que está lá. O sistema não recalcula juros do passado — os saldos são
   fatos acordados com cada credor (a planilha tem "plugs" que forçaram o
   saldo a bater com extratos externos). A validação só confere se a soma
   fecha com o saldo da planilha.
2. **Admin não passa por cima.** Diferente dos outros módulos, `profile ===
   'admin'` não dá acesso ao VB. Só a concessão explícita em
   `user_module_roles` (module `vb`). Mesma filosofia das empresas restritas
   (`restricted-companies.ts`).
3. **Revisão dentro da própria tabela.** Os lançamentos importados entram em
   `vb_entries` com `status = 'pendente'` e um `import_batch_id`. Não existe
   área de rascunho separada: a tela de revisão é a tela do extrato com
   marcações. Aprovar muda o status; descartar apaga as linhas pendentes.
4. **Saldo é calculado, nunca gravado.** O saldo corrente é a soma dos
   `amount` em ordem de `(entry_date, sort_order, created_at)`. O `SALDO` da
   planilha é guardado em `sheet_balance` só para a revisão comparar linha a
   linha. Só lançamentos `aprovado` entram em saldo e totais.
5. **Valores em centavos** (`numeric(14,2)`), com sinal: entrada positiva,
   saída negativa, rendimento com o sinal que a planilha trouxe (há
   rendimentos negativos que foram ajustes). Diferença de arredondamento até
   R$ 1,00 por credor é informativa; acima disso é divergência.
6. **Data do lançamento = coluna B.** Na planilha a coluna B é a data lançada
   (fim do período nos rendimentos; data do evento nos movimentos). A coluna A
   costuma ser fórmula (`=B(anterior)+1`) e é a origem dos 01/01/1900. A só
   alimenta `period_start` dos rendimentos.

## 4. Acesso e navegação

### 4.1 Concessão

- Linha em `user_module_roles`: `module = 'vb'`, `role ∈ {'gestor','credor'}`.
  Papel `gestor` opera tudo; `credor` (fase 2) lê apenas o próprio extrato.
- `src/lib/auth/vb.ts` (espelha `contratos.ts`): `VB_MODULE`, `VbRole`,
  `VB_PATH = '/vb'`, `VB_NAV_KEYS`, `resolveVbRole(rows)` (lê as linhas de
  `user_module_roles`; se houver as duas, `gestor` prevalece), `setVbGrant(...)`
  e `fetchVbGrants(...)` para a fase 2.
- `getSessionContext`: `modules.vb = { role } | null` e `profile.vb_role:
  VbRole | null`. Sem override de admin. Nenhuma coluna nova em `users` (o
  `select` explícito da sessão quebra inteiro se uma coluna não existir — ver
  `contratos.ts`).
- Middleware (`src/lib/supabase/middleware.ts`) e root page (`src/app/page.tsx`)
  já selecionam `user_module_roles(module)`; passam a derivar `canVb` daí.
- Seed: a migration insere a concessão `gestor` para `marcelo@quokka.net.br`
  via `INSERT ... SELECT id FROM public.users WHERE email = ...` (sem UUID
  fixo no arquivo).

### 4.2 Rotas (`access.ts`)

- `canAccessPathByProfile` ganha o parâmetro `canVb: boolean = false`.
- Gate `if (pathname === '/vb' || pathname.startsWith('/vb/')) return canVb;`
  posicionado logo após o gate de `/contratos` — antes do bloco
  franqueado/CSC (cuja whitelist negaria a rota) e antes de `if (profile ===
  'admin') return true` (senão admin passaria por cima).
- `defaultLandingFor` ganha `canVb` para quem só tem o VB cair em `/home` e
  não em `/pendente`.
- Dentro do módulo, o que é só-gestor (importação, novo lançamento, edição de
  pendentes) é checado na página e no server action com `requireVbGestor()`
  (`src/lib/vb/auth.ts`, espelha `ctrl/auth.ts`). O middleware fica grosso
  (qualquer papel entra em `/vb/*`).

### 4.3 Módulo e menu

- `ActiveModule` e `VALID_MODULES` (`active-context.ts`) ganham `'vb'`.
- `MODULES.vb = { id: 'vb', label: 'VB', usesSegments: false, defaultPath:
  '/vb' }`; `MODULE_ORDER` recebe `'vb'` por último;
  `resolveAvailableModules`/`resolveLayoutContext` ganham `canVb`.
- `navigation.ts`: `NavGroupId` ganha `'vb'`; `NavItem` ganha `vbAccess?:
  boolean` e `vbGestorOnly?: boolean`; grupo `{ id: 'vb', label: 'VB' }` entre
  CONTRATOS e PLATAFORMA com os itens **Visão geral** (`/vb`) e **Importação**
  (`/vb/importar`, `vbGestorOnly`).
- `nav-links.tsx`: `isItemVisible` trata `item.vbAccess` antes das whitelists
  de franqueado/CSC (como `contratosAccess`): visível se `vbRole` não for
  nulo, e para `vbGestorOnly` se `vbRole === 'gestor'`.
- `app-shell.tsx` e os layouts `(app)`, `(ctrl)`, `(case)`, `(viagens)` passam
  `vbRole` adiante (hoje passam `canContratos`; mesma mecânica).
- Route group novo `src/app/(vb)/vb/` com `layout.tsx` igual ao de `(case)`:
  `redirect('/')` quando `!ctx.modules?.vb`; `error.tsx` e `loading.tsx`.

## 5. Modelo de dados

Migration `supabase/migrations/20260909120000_vb_module.sql`.

### 5.1 `vb_creditors`

| coluna | tipo | notas |
|---|---|---|
| id | uuid pk | |
| name | text not null | editável na revisão (ex.: "Mylliano ( Sr Jorge)" → "Mylliano") |
| active | boolean not null default true | abas ocultas entram como `false` |
| user_id | uuid null → users(id) on delete set null | fase 2 (papel `credor`) |
| source_sheet | text null | nome da aba de origem; índice único parcial `lower(source_sheet)` |
| sort_order | int not null default 0 | ordem das abas na planilha |
| notes | text null | |
| created_at / updated_at | timestamptz | |

### 5.2 `vb_import_batches`

| coluna | tipo | notas |
|---|---|---|
| id | uuid pk | |
| file_name | text not null | |
| status | text check in ('pendente','aprovado','descartado') default 'pendente' | |
| summary | jsonb not null default '{}' | relatório do parser: abas ignoradas, vazias, puladas por já importadas, totais por credor |
| created_by | uuid → users(id) | |
| created_at, approved_at, discarded_at | timestamptz | |
| approved_by | uuid → users(id) | |

Linhas de lote nunca são apagadas (histórico de quem importou o quê).

### 5.3 `vb_entries`

| coluna | tipo | notas |
|---|---|---|
| id | uuid pk | |
| creditor_id | uuid not null → vb_creditors(id) on delete cascade | |
| entry_date | date not null | ver decisão 6 |
| kind | text check in ('entrada','saida','rendimento') | |
| amount | numeric(14,2) not null | check: entrada > 0, saida < 0 |
| description | text null | |
| period_start, period_end | date null | só rendimento |
| days | int null | só rendimento; convenção da planilha: `period_end - period_start` |
| rate | numeric(12,8) null | fração (0.0335 = 3,35%) |
| rate_basis | text null check in ('mensal','periodo','ajuste','cdi') | `cdi` reservado para a fase de juros automáticos |
| status | text check in ('pendente','aprovado') default 'aprovado' | |
| import_batch_id | uuid null → vb_import_batches(id) | lançamento manual = null |
| source_row | int null | linha da planilha |
| sheet_balance | numeric(16,4) null | SALDO que a planilha mostrava na linha |
| sort_order | int not null default 0 | `linha × 10 + sub` na importação; manual = 0 |
| flags | text[] not null default '{}' | alertas do parser, persistidos para a revisão |
| created_by | uuid → users(id) | |
| created_at / updated_at | timestamptz | |

Índices: `(creditor_id, entry_date, sort_order)`; parcial em
`import_batch_id`; parcial em `status` onde `status = 'pendente'`.

### 5.4 RLS

- Predicado `public.vb_role()` → `text`: `SELECT role FROM user_module_roles
  WHERE user_id = auth.uid() AND module = 'vb' ORDER BY (role <> 'gestor')
  LIMIT 1`. `LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public`.
  É predicado de policy, então fica executável por `authenticated` (regra da
  auditoria de 03/09/2026: só predicados de policy ficam liberados).
- `vb_creditors` SELECT: `vb_role() = 'gestor' OR (vb_role() = 'credor' AND
  user_id = auth.uid())`.
- `vb_entries` SELECT: credor visível pela regra acima **e** (`status =
  'aprovado'` ou `vb_role() = 'gestor'`).
- `vb_import_batches` SELECT: `vb_role() = 'gestor'`.
- Sem policy de escrita para `authenticated`: toda escrita passa pelos server
  actions com o admin client, depois de `requireVbGestor()`.
- Leituras nas páginas usam o client do usuário (RLS de verdade); escritas
  usam `createAdminClient()`.

O `types.ts` do Supabase neste projeto é escrito à mão (não há `Database`
gerado), então as linhas das tabelas ficam em `src/lib/vb/types.ts`, junto do
módulo; em `src/lib/supabase/types.ts` entram só `VbRole` e os campos de
sessão.

## 6. Parser da planilha

`src/lib/vb/import/parse-vb-workbook.ts` — função pura, sem banco:
`parseVbWorkbook(buffer): ParsedWorkbook`. Usa `xlsx` (já no projeto) com
`cellDates: false` e leitura de fórmulas (`cell.f`). Datas: serial Excel →
data civil (dias desde 1899-12-30), sem fuso; serial ≤ 1000 (isto é, os
01/01/1900) é inválido.

### 6.1 Reconhecimento de abas

- Aba de credor: linha 4 com cabeçalhos `DATA | DATA | DIAS | DESCRIÇÃO |
  ENTRADA | SAÍDA | RENDIMENTO | SALDO` (comparação sem acento e sem caixa).
  Nome do credor = `A1` (fallback: nome da aba).
- Aba com cabeçalho e nenhuma linha real → `vazia` (a "Mylliano" duplicada).
- Demais abas → `ignorada` (Resumo, dividendos, Propostas, Imoveis).
- Aba oculta (`workbook.Workbook.Sheets[i].Hidden`) → credor `active = false`.

### 6.2 Linhas

Linha real: `D` preenchida, ou `E`/`F` ≠ 0, ou `|G| ≥ 0,005`. As demais são o
preenchimento vazio da planilha (`A = anterior + 1`, `C = -1`, `H = anterior`).

Uma linha da planilha produz até dois lançamentos:

| condição | lançamento | sub |
|---|---|---|
| `|G| ≥ 0,005` | rendimento, `amount = round2(G)` | 0 |
| `E > 0` | entrada, `amount = round2(E)` | 1 |
| `F > 0` | saída, `amount = -round2(F)` | 1 |

`sort_order = linha × 10 + sub`. Linhas com movimento **e** rendimento na
mesma linha existem (ex.: Renato r16, Vitor r30): o rendimento vem antes do
movimento e o `sheet_balance` fica no último lançamento da linha. `E` e `F`
na mesma linha: os dois lançamentos são gerados e a linha recebe flag
`entrada_e_saida` (aviso). `D` preenchida sem nenhum valor: pulada e contada
no resumo como `linha_sem_valor`.

Descrição = `D` (trim). Rendimento sem descrição → "Rendimento". Movimento sem
descrição → "(sem descrição)" + flag `sem_descricao`.

### 6.3 Datas e período

- `entry_date`: `B` se válida; senão `A` se válida; senão flag bloqueante
  `data_invalida` (o lançamento entra mesmo assim, com a data do lançamento
  anterior, para o usuário corrigir na revisão).
- Rendimento: `period_end = entry_date`; `period_start = A` se válida e `A ≤
  B`, senão `B do lançamento anterior + 1` com flag `periodo_inferido` (sem
  lançamento anterior: `period_start = period_end`, mesma flag);
  `days = period_end - period_start`; se `C` numérica e diferente → flag
  `dias_divergentes` (aviso).
- `rate = I` quando numérica (fração).
- `rate_basis` pela fórmula de `G`: contém `FV(` → `mensal`; produto de duas
  células (`H*I`, `I*H`) → `periodo`; qualquer outra coisa (número digitado,
  `=<n>-H<m>`) → `ajuste`.

### 6.4 Flags

Bloqueantes (impedem aprovar): `data_invalida`, `valor_invalido` (`#REF!`,
texto onde devia ser número).

Avisos: `fora_de_ordem` (`entry_date` menor que a do lançamento anterior na
ordem da planilha), `conferir` (descrição contém "CONFERIR"), `sem_descricao`,
`periodo_inferido`, `dias_divergentes`, `entrada_e_saida`, `rendimento_zero`
(rendimento arredondado a 0,00 — o lançamento é pulado e contado).

### 6.5 Resultado por credor

`{ sheetName, name, hidden, entries[], sheetFinalBalance, computedFinalBalance,
diff, blockingCount, warningCount, skippedRows }`. `computedFinalBalance` é a
soma dos `amount` em ordem de planilha.

## 7. Fluxo de importação

Server actions em `src/lib/vb/actions/import.ts`, todos com
`requireVbGestor()`:

1. **`importVbWorkbook(formData)`**: recusa se já existe lote `pendente`
   ("descarte o lote pendente antes de importar outro"). Parseia; para cada
   aba de credor: se já existe `vb_creditors` com o mesmo `source_sheet` **e**
   ela tem algum lançamento `aprovado`, a aba é pulada (`ja_importado` no
   resumo — evita duplicar histórico); senão cria/reaproveita o credor e insere
   os lançamentos com `status = 'pendente'` e `import_batch_id`. Grava o lote
   com o resumo. Redireciona para `/vb/importar/[batchId]`.
2. **`updatePendingEntry(id, { entry_date, description, amount, kind,
   period_start, period_end, rate })`** e **`deletePendingEntry(id)`**: só em
   lançamentos `pendente`. Ao editar, as flags `data_invalida`/`valor_invalido`
   da linha são removidas; as demais permanecem como registro.
3. **`updateCreditor(id, { name, active })`**: renomear e marcar encerrado.
4. **`approveImportBatch(batchId)`**: recusa se restar flag bloqueante em
   qualquer lançamento do lote; caso contrário `UPDATE vb_entries SET status =
   'aprovado'` para o lote e `vb_import_batches.status = 'aprovado'`, numa
   transação (função SQL `vb_approve_import_batch(batch_id)` `SECURITY
   DEFINER`, com `REVOKE ... FROM PUBLIC, anon, authenticated; GRANT ... TO
   service_role`, chamada pelo admin client).
5. **`discardImportBatch(batchId)`**: apaga os lançamentos pendentes do lote,
   apaga credores criados pelo lote que ficaram sem lançamento, marca o lote
   `descartado`.

Divergência de saldo (`|diff| > 1,00`) **não** bloqueia a aprovação — é
mostrada em destaque para o gestor decidir (a solução é corrigir a linha ou
aceitar conscientemente).

## 8. Telas

Todas em `src/app/(vb)/vb/`, componentes em `src/components/vb/`. Formatação
monetária com `formatBRL` (`src/lib/orcamento/format.ts`); datas em
`dd/MM/yyyy`. Visual segue o vocabulário do app (Card, Table, Badge, Dialog
do `components/ui`).

### 8.1 Visão geral — `/vb`

- Cards: saldo total dos credores ativos; nº de credores ativos; rendimentos
  do ano corrente; rendimentos do ano anterior.
- Tabela de credores: nome, saldo atual, último lançamento, rendimento no ano,
  badge "encerrado" para inativos (listados por último). Linha leva ao extrato.
- Bloco "Custo de juros por semestre": soma de rendimentos por credor ×
  semestre (1º = jan–jun, 2º = jul–dez) do ano corrente e do anterior (o que
  a aba Resumo faz à mão hoje).
- Gestor com lote pendente vê um aviso com link para a revisão. Lançamentos
  pendentes não entram em nenhum saldo ou total desta tela.

### 8.2 Extrato — `/vb/credores/[id]`

- Cabeçalho: nome, badge encerrado, saldo atual, totais de entradas, saídas e
  rendimentos.
- Tabela agrupada por ano (subtotal por ano: entradas, saídas, rendimentos,
  saldo no fim do ano): Data · Descrição · Entrada · Saída · Rendimento ·
  Saldo. Na linha de rendimento, abaixo da descrição, a explicação: "01/01 a
  31/03/2026 · 89 dias · 3,35% no período" / "… · 0,75% a.m." / "ajuste
  manual".
- Lançamentos pendentes não aparecem no extrato nem nos saldos: enquanto
  houver lote pendente com linhas deste credor, o gestor vê um aviso com link
  para a revisão do lote. A revisão (8.3) é o único lugar que mostra
  pendentes.
- Botão "Novo lançamento" (gestor) abre o formulário de 8.4.

### 8.3 Importação — `/vb/importar` e `/vb/importar/[batchId]`

- Lista: upload do `.xlsx` (input de arquivo + botão) e histórico de lotes
  (arquivo, data, quem, status, resumo).
- Revisão do lote: cabeçalho com status e botões **Aprovar importação** /
  **Descartar** (ambos com diálogo de confirmação; Aprovar desabilitado com
  contagem de bloqueios enquanto houver flag bloqueante). Abas de credor
  (uma por credor do lote; abas simples feitas com botões — não há componente
  Tabs no projeto e não vale adicionar um por isso). Em cada aba: nome
  editável, toggle ativo, resumo
  (linhas, entradas, saídas, rendimentos, saldo planilha × saldo sistema,
  diferença com badge: verde ≤ R$ 1,00, vermelho acima), lista de alertas
  com contagem por tipo, tabela linha a linha: Linha · Data · Descrição ·
  Entrada · Saída · Rendimento (com período/taxa) · Saldo planilha · Saldo
  sistema · alertas · ações (editar em diálogo, excluir). O "saldo sistema"
  da revisão é acumulado **em ordem de planilha** (`sort_order`), para bater
  com a coluna SALDO; o extrato usa ordem de data.
- Abas ignoradas/vazias/puladas aparecem numa nota no rodapé do lote.

### 8.4 Novo lançamento — diálogo no extrato (gestor)

Campos: credor (pré-selecionado), data, tipo (entrada / saída / rendimento),
valor (sempre positivo no formulário; o sinal vem do tipo; rendimento aceita
negativo com aviso), descrição; para rendimento: período início/fim, taxa em
% e método (`periodo` padrão, `ajuste`). Cria direto como `aprovado`.
Validação com `zod` no server action `createVbEntry`.

## 9. Erros

- Server actions devolvem `{ error: string }` em português; as telas mostram
  via toast.
- Parser nunca lança por conteúdo de célula: converte em flag. Só lança se o
  arquivo não for um `.xlsx` legível ("Arquivo inválido") ou se nenhuma aba de
  credor for reconhecida.
- Upload limitado a 5 MB (a planilha tem 580 KB).

## 10. Verificação

1. `scripts/vb-parse-check.ts` (`npx tsx`): parseia `docs/VB TERRAZZO
   V2.xlsx` e imprime, por credor: linhas, lançamentos, saldo planilha, saldo
   calculado, diferença, flags por tipo. Esperado: 9 credores (3 ocultos), 1
   aba vazia, 4 ignoradas, `|diff| ≤ 0,05` em todos, zero flags bloqueantes
   além das datas 01/01/1900 conhecidas.
2. `npm run lint` e `npm run build`.
3. Migration aplicada via MCP do Supabase (projeto do dashboard-dre); tipos
   regenerados; `get_advisors` sem alerta novo de `SECURITY DEFINER`.
4. No browser (dev): login como Marcelo → grupo VB no menu → upload →
   revisão (corrigir uma data inválida, renomear Mylliano) → aprovar →
   Visão geral com saldo total R$ 2.368.211,67 (±0,10) → extrato de um
   credor → novo lançamento manual. Login como outro admin → VB não aparece e
   `/vb` redireciona.

## 11. Arquivos

Novos: `supabase/migrations/20260909120000_vb_module.sql`,
`src/lib/auth/vb.ts`, `src/lib/vb/{types,auth,money,ledger,format,queries}.ts`,
`src/lib/vb/import/{excel-date,parse-vb-workbook,to-rows}.ts`,
`src/lib/vb/actions/{import,entries,creditors}.ts`,
`src/app/api/vb/import/route.ts`, `src/app/(vb)/error.tsx`,
`src/app/(vb)/vb/{layout,loading,page}.tsx`,
`src/app/(vb)/vb/credores/[id]/page.tsx`, `src/app/(vb)/vb/importar/page.tsx`,
`src/app/(vb)/vb/importar/[batchId]/page.tsx`, `src/components/vb/*`,
`scripts/vb-parse-check.ts`, testes `*.test.ts` ao lado dos módulos puros
(rodados por `npm test`, `node --test` + `tsx`).

Alterados: `src/lib/auth/session.ts`, `src/lib/auth/access.ts`,
`src/lib/supabase/middleware.ts`, `src/app/page.tsx`,
`src/lib/context/{active-context,modules}.ts`,
`src/components/app/{navigation,nav-links,app-shell}.tsx`, layouts de
`(app)`, `(ctrl)`, `(case)`, `(viagens)`, `src/lib/supabase/types.ts`
(`VbRole` + campos de sessão), `package.json` (script `test`), `CLAUDE.md`
(seção do módulo VB).
