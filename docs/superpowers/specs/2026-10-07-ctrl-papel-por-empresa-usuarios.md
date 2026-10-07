# Papel do Compras POR EMPRESA + redesenho da tela de Usuários

**Status:** **IMPLEMENTADO no working tree e validado** (tsc + 846 testes + lint + build, todos verdes) — **migration NÃO aplicada, sem commit/deploy.** Autor: Lucas + Claude. Data: 07/10/2026. Continuação de [2026-10-06-ctrl-multiempresa-design.md](2026-10-06-ctrl-multiempresa-design.md).

> **ORDEM OBRIGATÓRIA: aplicar a migration ANTES de deployar o código.** `getCtrlOrgContext`, o `GET /api/users` e a página de Usuários passaram a ler `ctrl_user_orgs.role`. Sem a coluna, o `select` falha (42703) e degrada (ex.: admin volta a cair na Feat vazia por default). Com a coluna e todos os `role` NULL, é diff-zero. Arquivos: migration `supabase/migrations/20261007150000_ctrl_user_orgs_role.sql`; código em `src/lib/ctrl/roles.ts` (+ teste), `session.ts`, `ctrl/orgs.ts`, `ctrl/auth.ts`, `(ctrl)/ctrl/layout.tsx`, `users-admin-manager.tsx`, as 3 rotas `api/users/*` e `usuarios/page.tsx`.

## 0. Restrição inegociável (o pedido)

> "Preciso de uma que não gere erros e muito menos mudanças nas permissões que temos agora, nem mesmo nas exceções ou regras particulares (como régis e marcela, ou o fato de a admin carol não ver o módulo de Departamento Pessoal)."

Este desenho é **aditivo e diff-zero**: com ele aplicado e ninguém mexendo em nada, **todo usuário mantém exatamente as permissões de hoje**, byte a byte — nas telas, nas rotas, nas ações, nas notificações e em todas as regras nominais. A prova está em §7, e §11 confronta cada exceção citada uma a uma.

## 1. Problema

Hoje o **papel do Compras é GLOBAL**: vem do `users.profile` (um só por usuário), convertido em `CtrlRole[]` por `deriveCtrlRoles(...)` em `src/lib/auth/session.ts:218`. Com o Compras multiempresa (Viva, Feat, …), o mesmo usuário pode precisar de papéis diferentes por empresa — o exemplo do dono: **"na Viva é Contas a Pagar, na Feat é Solicitante"**. Não há como expressar isso: o perfil é um só.

Além disso, a tela "Editar Usuário" ficou "muito embolada" ao olhar todos os módulos de uma vez (perfil + 6 módulos + unidades + setores + empresas do Compras + setores do orçamento, tudo numa coluna só).

**Objetivo:** permitir papel do Compras **por empresa**, e desembolar a tela — **sem** mudar nenhuma permissão atual.

## 2. A descoberta que torna isso seguro: existe UM único ponto de costura

Mapeamos todos os leitores do papel do Compras (inventário completo no fim, §13). O resultado:

- `deriveCtrlRoles(...)` enche **dois** campos: `modules.ctrl.roles` (sessão) e `profile.ctrl_roles` (compat legado).
- O **único ponto** por onde esses papéis entram no módulo Compras é **`src/lib/ctrl/auth.ts:47`** — `ctrlRoles: ctx.modules.ctrl.roles` dentro de `getCtrlUser()`.
- **Tudo** que decide permissão DENTRO do Compras — todos os `getCtrlUser()` / `requireCtrlRole()` / `requireCtrlRoleOrFullView()` / `hasCtrlRole()` e as leituras diretas de `ctx.ctrlRoles` (visibilidade em `getRequests`, metadados de auditoria) — flui desse campo. **São ~120 call sites, e todos herdam a mudança de graça se ela for feita nesse ponto.**
- `hasCtrlAccess()` (em `session.ts`) **não tem nenhum chamador** — é helper morto, não precisa de nada.

E o achado que torna o recorte REAL (não cosmético): **toda página sensível do Compras re-valida por `getCtrlUser()` com `redirect()`**, não só esconde botão. Verificado:

| página | linha | trava |
|---|---|---|
| `contas-a-pagar/page.tsx` | 242 | `if (!canOperate) redirect(...)`, `canOperate = hasCtrlRole(ctx,"contas_a_pagar","admin") \|\| fullView` |
| `aprovacoes/page.tsx` | 14 | `redirect` salvo `hasCtrlRole(ctx,"gerente","diretor","csc","contas_a_pagar","admin")` |
| `orcamento/page.tsx` | 180 | `redirect` salvo `hasCtrlRole(ctx,"gerente","diretor","csc","admin")` |

Ou seja: mexer **só** em `getCtrlUser:47` faz o papel por empresa valer em três camadas de uma vez — **rota** (via o redirect da página), **ação** (via `requireCtrlRole`) e **visibilidade de dados** (via `getRequests`), e isso em todas as empresas, sem tocar em nenhuma das ~120 chamadas.

## 3. Modelo de dados: uma coluna, anulável, sem backfill

```sql
-- O papel do Compras do usuário NAQUELA empresa. NULL = usa o perfil global
-- (comportamento de hoje, idêntico). Preenchido = sobrepõe só nesta empresa.
alter table public.ctrl_user_orgs
  add column role text;

alter table public.ctrl_user_orgs
  add constraint ctrl_user_orgs_role_chk
  check (role is null or role in
    ('solicitante','gerente','gerente_setor','diretor','contas_a_pagar'));
```

- **Anulável, sem DEFAULT, sem backfill.** As 37 linhas existentes ficam com `role = NULL` → cada usuário segue com o papel do perfil global em todas as empresas → **idêntico a hoje**.
- O CHECK fecha o vocabulário (pega erro de digitação numa coluna `text` que entra numa decisão de permissão), seguindo a convenção do módulo. **`admin` NÃO entra no CHECK de propósito** — admin é global, nunca um papel por empresa (ver §5). `franqueado`/`csc`/`validador_contrato` também não: não são papéis do Compras.
- É o mesmo enquadramento do `company_excluded_projects` e do `orcamento_metodos_ocultos`: **tabela/coluna "vazia" (aqui, NULL) = comportamento de antes**, e o recurso nasce desligado para todos.
- A conferência de produção (07/10/2026, read-only): `ctrl_user_orgs` tem hoje só `(user_id, org_id)`, 37 linhas, todas Viva; **os 34 usuários com Compras já têm concessão (zero sem grant)** — então a resolução do papel por empresa **nunca** fica sem linha para ler.

## 4. RLS: NÃO MUDA

`ctrl_has_org(org_id)` (o predicado RESTRICTIVE das 5 tabelas) só checa **pertencimento** à empresa — não lê `role`. Adicionar a coluna não o altera. O papel por empresa é **refinamento de aplicação**, exatamente como `requireCtrlRole` já é hoje (a RLS dá acesso à linha da empresa; o app decide o que a pessoa pode fazer). A defesa em profundidade continua a mesma: RLS = membro da empresa + `has_ctrl_role`; app = granularidade fina por `getCtrlUser`. **Não mexa em `ctrl_has_org`.**

## 5. Resolução (a única mudança de código no caminho de auth)

Em `getCtrlUser()` (`src/lib/ctrl/auth.ts`), trocar a linha 47 por uma resolução que prefere o override da empresa ativa e, na falta dele, cai no global de hoje:

```ts
// Papel GLOBAL de hoje (deriveCtrlRoles via session) — o default imutável.
const globalRoles = ctx.modules.ctrl.roles;

// Admin é global: continua admin em toda empresa, override é ignorado.
// (nunca gravamos override para admin — ver o CHECK — mas a trava fica no código também.)
let ctrlRoles = globalRoles;
if (ctx.profile.profile !== "admin") {
  const override = orgCtx.activeOrgRole; // ctrl_user_orgs.role da empresa ativa, ou null
  ctrlRoles = override
    ? ctrlRolesFromProfile(override) // MESMO mapeamento do deriveCtrlRoles
    : globalRoles;
}
```

- **`ctrlRolesFromProfile` é o `switch` do `deriveCtrlRoles` extraído para uma função pura** (o `switch` já era a cauda de `deriveCtrlRoles`; a extração preserva byte a byte — os early-returns de "não tem módulo" — `validador`, `franqueado`/`csc`, `!canCompras` — ficam em `deriveCtrlRoles`, que passa a chamar a extraída no fim). Assim `contas_a_pagar` continua virando `["contas_a_pagar","csc","aprovacao_fornecedor"]`, `gerente`/`gerente_setor` → `["gerente"]`, etc. **Divergência impossível porque é a mesma função.**
- **A decisão override ?? global vira uma função pura compartilhada** — `resolveCtrlRolesForOrg(profile, globalRoles, activeOrgRole)` — usada por `getCtrlUser` **e** pelo layout do Compras (§6), para não duplicar a regra nem rodar `getCtrlOrgContext` duas vezes. É testável isoladamente.
- **O papel por empresa nunca é vazio para quem tem Compras:** `ctrlRolesFromProfile(override)` para os 5 valores do CHECK sempre devolve ≥1 role, e com override NULL cai no global (≥1 para quem tem o módulo). Logo a disponibilidade do módulo no switcher (`resolveAvailableModules`, que exige `length > 0`) **nunca** é afetada — nem com narrowing.
- `orgCtx.activeOrgRole`: `getCtrlOrgContext` já lê `ctrl_user_orgs` (hoje `select("org_id")`); passa a ler `select("org_id, role")` e expõe o `role` da empresa ativa. Admin, que vê todas as empresas via RLS, pode não ter linha para a empresa ativa → `activeOrgRole = null` → cai no global (e admin já é ignorado acima de qualquer forma).
- **Nada mais em `getCtrlUser` muda.** O guard de existência (`auth.ts:34`, "o usuário tem Compras?") continua lendo o global `modules.ctrl` — é sobre TER o módulo, não sobre o papel.

### O "teto" é o perfil global, e isso é seguro
A rota (`canAccessPathByProfile` no middleware) continua decidindo por `profile` global + `canCompras` (§13.6) — **não muda**. Então o perfil global é o **teto** do que o usuário alcança: o override por empresa **restringe** dentro desse teto, nunca concede rota acima dele. Para o caso do dono (Viva = Contas a Pagar, Feat = Solicitante), o teto é `contas_a_pagar` (perfil global), e a Feat é estreitada para `solicitante`. Mesmo que o middleware deixe o usuário tocar a rota `/ctrl/contas-a-pagar` com a Feat ativa, a **página redireciona** (§2), porque `getCtrlUser().ctrlRoles` na Feat = solicitante. Teto coarse no middleware, trava fina na página — e a página é que vale.

## 6. O que fica GLOBAL (e por quê) — decisões explícitas

| leitor | fica | por quê |
|---|---|---|
| **Rota / middleware** (`canAccessPathByProfile`) | **global** | é o teto coarse; mudar aqui é mexer na trava de rota de TODO perfil — risco que não precisamos correr, porque a página re-trava por empresa (§2). Diff-zero exige não tocar. |
| **Disponibilidade do módulo** no switcher (`resolveAvailableModules`, layouts cross-módulo) | **global** | o usuário tem de poder ENTRAR no Compras independ127. da empresa ativa; o módulo aparecer no menu é sobre TER Compras (`canCompras`), não sobre o papel. |
| **Menu lateral DENTRO do Compras** (`(ctrl)/ctrl/layout.tsx:30` → AppShell) | **vira por empresa** (recomendado) | hoje passa `modules.ctrl.roles` (global); o layout já resolve a empresa ativa, então passa a alimentar a sidebar do Compras por `getCtrlUser().ctrlRoles`. Sem isso, o item "Contas a Pagar" apareceria no menu da Feat para o solicitante e só redirecionaria ao clicar — feio, não errado. **Com override NULL = idêntico.** |
| **Cockpit `/home`** (`home/page.tsx` → `deriveCtrlCaps`) | **global** | a home é lançadeira cross-empresa, sem conceito de empresa ativa; a capacidade "pode pagar" (na Viva) é verdadeira. A trava por empresa acontece ao abrir a tela. Mudar exigiria a home resolver empresa ativa — superfície e risco sem ganho. |
| **`getCtrlUser().profile`** (distinção gerente × gerente_setor em `/ctrl/orcamento:199`) | **global** | o override expressa `CtrlRole` (solicitante/gerente/diretor/contas_a_pagar); gerente e gerente_setor mapeiam para o MESMO `CtrlRole` (`["gerente"]`), então a distinção só existe em `profile.profile`, que segue global. O recorte por setor do gerente_setor continua como hoje. Se um dia for preciso gerente_setor por empresa, cria-se um `effectiveProfile` — fora de escopo. |
| **Notificações / lembrete diário** (`notifications.ts`, `approval-reminders/recipients.ts`) | **global** (por construção) | consultam `users.profile` direto no banco, já filtrados por setor (id de setor é único por empresa). Não passam por `deriveCtrlRoles`. Day-1 Feat não tem aprovações, então é inerte agora. **Follow-up honesto:** quando a Feat tiver aprovação e alguém tiver papel por empresa com alçada diferente, revisar `recipients.ts` para consultar o override — senão um "gerente global, solicitante na Feat" vinculado a setor da Feat poderia receber lembrete de aprovação que o app depois nega. Não bloqueia este desenho. |

## 7. Prova de diff-zero

Com a coluna criada e **todos os `role` = NULL** (estado imediatamente após a migration, sem ninguém editar):

1. `getCtrlUser()` para qualquer usuário: `override = null` → `ctrlRoles = globalRoles = deriveCtrlRoles(profile)` = **exatamente o valor de hoje**. Logo todos os ~120 consumidores do §13.3 (páginas, ações, visibilidade, auditoria) recebem o mesmo de sempre.
2. Rota/middleware: não tocados → idênticos.
3. Switcher de módulo, home, notificações: lidos do global → idênticos.
4. Sidebar do Compras: `getCtrlUser().ctrlRoles` = global (override NULL) → idêntico.
5. RLS: `ctrl_has_org` não lê `role` → idêntico.

**Verificação executável** (três travas, porque `getCtrlUser` não roda fora de uma sessão autenticada — então a prova é feita pelas peças puras, não por um script que "loga" como cada um):
1. **Unit test** travando que `ctrlRolesFromProfile(p)` é igual ao mapeamento de hoje para TODOS os perfis (admin, contas_a_pagar, diretor, gerente, gerente_setor, solicitante, e os que devolvem `[]`). É isto que garante que a extração não mudou o `switch`.
2. **Unit test** de `resolveCtrlRolesForOrg`: `activeOrgRole = null` → devolve `globalRoles` idêntico; profile admin → devolve `globalRoles` mesmo com override setado.
3. **Check read-only em produção** (como as conferências anteriores, método pelos efeitos): depois da migration, `select count(*) from ctrl_user_orgs where role is not null` **= 0**. Enquanto for 0, o ramo do override nunca é tomado e o sistema é, por construção, idêntico ao de hoje.

Rodar as três ANTES de considerar o passo de código pronto. A prova analítica (override NULL ⇒ `resolveCtrlRolesForOrg` devolve `globalRoles` = `deriveCtrlRoles` de hoje) cobre os ~120 consumidores do §13.3 sem precisar exercê-los um a um.

**Conferência manual adicional (grep):** confirmar que nenhuma decisão de permissão do Compras lê o espelho legado `profile.ctrl_roles` direto (em vez de `getCtrlUser().ctrlRoles`) — se houvesse, veria o global e não o override. O inventário (§13) não achou leitor vivo; a busca fecha a janela.

## 8. Redesenho da tela "Editar Usuário"

Dois níveis; o dono pode pegar só o primeiro (mínimo risco) e deixar o segundo para depois.

### 8.1 Nível 1 — papel por empresa (a funcionalidade nova, risco mínimo)
Hoje a seção **"Empresas do Compras"** é um `PillMultiSelect` de empresas (grava `ctrl_user_orgs (user_id, org_id)`). Vira uma **lista de cartões, um por empresa concedida**, cada cartão com:
- o nome da empresa + um switch de concessão (marcar/desmarcar a empresa = o que o pill fazia);
- um **dropdown "Papel nesta empresa"**, cujo padrão é **"Usar o perfil (`<label do perfil global>`)"** — e esse padrão grava `role = NULL`. As demais opções são os 5 papéis do CHECK, rotuladas como na tela de perfil ("Gerente Sócio", "Gerente", "Solicitante", "Diretor", "Contas a Pagar");
- (opcional, agrupamento) os **setores daquela empresa** logo abaixo, reaproveitando o filtro que já existe (`sectorOptions` já recorta por `org_id` ∈ empresas marcadas).

**Regra de ouro da tela:** se o admin não tocar o dropdown, ele fica em "Usar o perfil" → grava NULL → nada muda. Reabrir e salvar um usuário existente sem mexer = reescreve as linhas `ctrl_user_orgs` com `role = NULL`, que é **idêntico** às linhas de hoje (que nem têm a coluna).

### 8.2 Nível 2 — desembolar (visual, mesmos dados, opcional)
Agrupar o formulário em **seções recolhíveis por assunto**, fechadas por padrão, para matar o "embolado":
- **Identidade** (nome, e-mail, cargo, telefone) + **Perfil**.
- **Financeiro** (toggle + Unidades) — recolhe quando não tem Financeiro.
- **Compras** (toggle + os cartões de empresa×papel×setores do Nível 1) — recolhe quando não tem Compras.
- **Orçamento** (toggle + setores do orçamento por unidade).
- **Outros módulos** (Case, Validação de Contratos, Caixa) como uma gradezinha de toggles.
- **Callouts por perfil** no rodapé, como hoje.

É só reorganização de layout sobre **os mesmos campos e as mesmas escritas**. **DP e VB continuam fora da tela** (confirmado: não há `can_dp`/`can_vb`/botão algum no componente — ver §11). O switch "Administrador" (perfil = admin) continua escondendo a seção de módulos, como hoje.

### 8.3 Mudanças exatas de escrita/leitura (o resto NÃO muda)
Só o canal de `ctrl_user_orgs` ganha o `role`; todos os outros writes (`users`, `user_module_roles` contratos/caixa/orçamento, `user_sectors`, `user_company_access`, `orcamento_user_setores`) ficam **idênticos**.

- **`page.tsx` + `GET /api/users`**: ao ler `ctrl_user_orgs`, trazer `role` junto do `org_id`; expor na linha do usuário um mapa `ctrl_org_roles: Record<orgId, role|null>` (ao lado do `ctrl_org_ids` que já existe).
- **`PATCH /api/users/[userId]`** e **`POST /api/users/invite`**: o insert de `ctrl_user_orgs` passa de `{user_id, org_id}` para `{user_id, org_id, role}` (role = o escolhido no cartão, ou `null`). O padrão delete-all-then-insert **não muda**; `can_compras = false` continua limpando tudo. `role` sempre `null` quando o perfil é admin (trava na rota, espelhando o CHECK).
- **Componente** (`users-admin-manager.tsx`): `FormState` ganha `ctrl_org_roles`; o toggle de empresa inicializa o papel em `null` ("Usar o perfil"); `toggleCtrlOrg` ao remover uma empresa já dropa os setores dela (mantém) e passa a dropar também a entrada de papel. Nenhuma regra de cascata existente muda.

## 9. Semântica que o dono precisa saber (sem pegadinha escondida)
- **O perfil global é o teto.** O override por empresa **restringe** dentro do teto. Para dar a alguém um papel MAIOR numa empresa do que em outra, o perfil global tem de ser o maior dos dois, e as empresas "menores" recebem override para baixo. No caso do dono (Contas a Pagar na Viva, Solicitante na Feat) isso já é o natural: perfil = `contas_a_pagar`, Feat = `solicitante`.
- **Mudar o perfil global de um usuário existente muda o teto dele** — então, ao usar o recurso, o admin estreita por empresa em vez de mexer no perfil, sempre que possível. A tela deixa o papel por empresa à vista exatamente para isso.
- **Reabrir/salvar não altera nada** se os dropdowns ficarem em "Usar o perfil".

## 10. Ordem de implantação (reversível, cada passo verificável)
1. **Migration** (`<timestamp>_ctrl_user_orgs_role.sql`): `add column role text` + CHECK. Inerte (ninguém lê ainda). Reversível (`drop column`). **O dono aplica.**
2. **Código (working tree, sem commit — [[feedback_no_auto_commit]])**: extrair `ctrlRolesFromProfile` de `deriveCtrlRoles`; `getCtrlOrgContext` lê `role`; `getCtrlUser:47` resolve override ?? global; `(ctrl)/ctrl/layout.tsx` alimenta a sidebar do Compras por `getCtrlUser().ctrlRoles`. Validar `npm run lint && npm run build && npm test`.
3. **Verificação diff-zero** (§7): script read-only comparando `ctrlRoles` de hoje × resolvido com overrides NULL, exigindo igualdade para os 62 usuários. Só então seguir.
4. **Tela** (Nível 1, depois opcionalmente Nível 2): cartões empresa×papel; rotas gravam `role`. Validar de novo.
5. Deploy. Overrides seguem NULL até o admin decidir, conscientemente, dar papel por empresa à Feat.

Até o admin tocar num dropdown, o sistema é **indistinguível** do atual.

## 11. As exceções citadas — uma a uma, por que NÃO mudam
- **Régis** (`APPROVER_SECTOR_RESTRICTIONS`, `routing.ts`): regra por **e-mail**, lida por `approverSectorRestrictionFor` nas telas/ações de aprovação. Não passa por `getCtrlUser().ctrlRoles` nem por `profile`. **Intocada.**
- **Marcelo / "marcela"** (`DIRECTOR_HIGHLIGHT_SECTORS`, `routing.ts`): regra por **e-mail**, destaque na tela de Aprovações + etapa de diretor do lembrete. Keyed por e-mail. **Intocada.** (Cobertura de férias do Vitor — `APPROVAL_COVERAGE` — está vazia hoje; também por e-mail, também intocada.)
- **Carol (admin) não ver o DP**: o DP é módulo próprio (`user_module_roles module='dp'`), **admin não herda** (gate em `access.ts`/`session.ts`), e a tela de Usuários **não gerencia DP** — não há `can_dp`, botão ou escrita de DP no componente nem nas 3 rotas (confirmado por busca). Este desenho mexe só em `ctrl_user_orgs.role` e no layout do Compras — **nada toca o DP**. Carol segue sem ver o DP. O redesenho (Nível 2) **mantém o DP fora da tela**, de propósito (o sigilo do módulo exige que ele nem apareça aqui).
- **Todos os papéis atuais** (os 34 do Compras: 12 solicitante, 13 gerente, 3 admin, 3 diretor, 2 contas_a_pagar, 1 gerente_setor): overrides NULL → `getCtrlUser` resolve ao perfil global → **idêntico**, provado em §7.

## 12. Fora de escopo / pré-existente (não mexer)
- **Discrepância `can_contratos`**: o `GET /api/users` deriva `grant || validador || contracts_only`; o `page.tsx` deriva `grant || validador` (sem `contracts_only`). É **pré-existente**; não tem relação com este desenho e **não será tocada** (mexer poderia mudar o que a tela mostra para quem tem o flag legado). Registrado só para não "corrigir" por engano.
- **gerente × gerente_setor por empresa**: fica global (§6). Fora de escopo.
- **Lembrete um e-mail por empresa + empresa na chave de `ctrl_approval_email_log`**: é follow-up da multiempresa, independente deste desenho.

## 13. Inventário dos leitores do papel do Compras (a base do §2)

**13.1 Sessão (ficam GLOBAIS):** `session.ts:244` (`profile.ctrl_roles`, produtor compat) e `:251` (`modules.ctrl.roles`, produtor); `auth.ts:34` (guard "tem módulo?"); todos os layouts que leem `modules.ctrl?.roles` para o switcher e nav cross-módulo (`(app)/layout.tsx`, `(case)`, `(vb)`, `(dp)`, `(caixa)`, `(viagens)`); `resolveAvailableModules` (`context/modules.ts`); `home/page.tsx:20`.

**13.2 `hasCtrlAccess`:** definido em `session.ts:38`, **zero chamadores** — morto.

**13.3 Compras-por-empresa (herdam a mudança via `getCtrlUser:47`):** 15 `getCtrlUser()` em páginas `/ctrl/*` + 2 rotas `api/ctrl/budget*` + `events.ts`; ~60 `requireCtrlRole(...)` (`requests.ts`, `suppliers.ts`, `sectors.ts`, `omie-mapping.ts`, `budget-editor.ts`, `budget-items.ts`, `cadastros.ts`, `notifications.ts`, `expense-types.ts`, `request-admin.ts`, `payment-status.ts`, `attachment-ocr.ts`, `api/ctrl/requests/[id]/pdf`); 7 `requireCtrlRoleOrFullView(...)` (`requests.ts`, `contapagar-launch.ts`); dezenas de `hasCtrlRole(ctx,...)` (todas as páginas `/ctrl` + `api/ctrl/budget*` + ações); leituras diretas de `ctx.ctrlRoles` para visibilidade (`getRequests`: `hasGlobalVisibility`/`hasSectorVisibility`/`isSectorResponsible`) e auditoria (`approver_roles`/`edited_by_roles`), no `requests.ts`, `request-admin.ts`, `api/ctrl/requests/[id]/pdf`, `manual/page.tsx:20`, e os props para `contas-a-pagar-table.tsx`/`aprovacoes-client.tsx`.

**13.4 `profile.profile` para decisão Compras:** `auth.ts:46` (carrega global no contexto); `orcamento/page.tsx:199` (`gerente_setor` → recorte por setor) — **fica global**; `layout.tsx:99` (variante de texto do tour) — cosmético.

**13.5 `deriveCtrlRoles`:** def `session.ts:298`, chamada única `:218`; resultado alimenta §13.1 e (via `getCtrlUser`) §13.3; `deriveCtrlCaps` em `home/ctrl-widgets.ts:55` (home, global).

**13.6 `canAccessPathByProfile`:** gate de `/ctrl*` por `canCompras` + `profile` global (nunca `CtrlRole`); chamado pelo middleware (`middleware.ts:152`). **Não muda.** O legado `canAccessPath`/`CTRL_RULES` keyia por `CtrlRole` mas está morto no modelo novo.
