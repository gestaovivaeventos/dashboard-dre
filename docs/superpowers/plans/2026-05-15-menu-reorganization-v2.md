# Plano de Implementação — Menu v2 (Domínio de Negócio)

**Data:** 2026-05-15
**Spec:** [`2026-05-15-menu-reorganization-v2.md`](../specs/2026-05-15-menu-reorganization-v2.md)
**Branch:** `feat/menu-reorganization` (continua a mesma; este plano é incremental sobre o que já foi commitado da v1)
**Estado base:** Commits `cb74fc0` → `28be2c0` da v1 já mergiados nesta branch. A v2 desfaz parcialmente a v1 (remove módulos da UI) e reorganiza a sidebar.

## Princípios deste plano

- **Commits atômicos.** Cada fase compila (`npm run build`) e renderiza sem quebrar a app no estado anterior, até o último que limpa código morto.
- **Mantenha a app navegável a cada commit.** Não há "big bang" no meio — sempre dá pra abrir no browser e clicar.
- **Deletar primeiro, depois reorganizar é arriscado.** A ordem aqui faz o reverso: primeiro a nova estrutura coexiste com a antiga (feature-flag-free, mas via troca de componentes), depois remove o morto.
- **Sem migrações de DB.**

## Mapa de estado atual vs alvo

| Conceito | Hoje (v1) | Alvo (v2) | Ação |
|---|---|---|---|
| Cookie `active_module` | Setado pelo `/api/context`, lido por `resolveLayoutContext`, usado em `ModuleSwitcher` | Não existe | **Remover** após fase 4 |
| Cookie `active_segment_slug` | Igual ao alvo | Mantém | Manter |
| `ModuleSwitcher` componente | Renderizado no header em desktop+mobile drawer | Não existe | **Deletar** |
| `SegmentSelector` no header | Renderiza se `module.usesSegments` | Renderiza se rota atual usa segmento (`/s/...`) | **Trocar condicional** |
| `NavLinks` | Renderiza listas conforme `activeModule` | Renderiza 3 grupos por domínio, sempre | **Reescrever** |
| `navigation.ts` | `DRE_*` + `CTRL_*` (por módulo) | `NAV_GROUPS` por domínio | **Reestruturar** |
| `modules.ts` | `MODULES`, `resolveLayoutContext` (módulo+segmento) | Só resolver de segmento | **Simplificar** |
| `/api/context` | Aceita `module` e `segmentSlug` | Só `segmentSlug` | **Reduzir contrato** |
| `(app)/layout.tsx` e `(ctrl)/ctrl/layout.tsx` | Passam `activeModule`, `availableModules` para `AppShell` | Passam só `segments`, `activeSegmentSlug` | **Limpar props** |

## Sequência de commits

### Fase 1 — Nova estrutura de dados de navegação (não-quebradora)

**Objetivo:** introduzir `NAV_GROUPS` ao lado das listas antigas. `NavLinks` ainda usa as antigas. Build verde, comportamento idêntico.

**Mudanças:**
- [`src/components/app/navigation.ts`](../../../src/components/app/navigation.ts):
  - Adicionar (ao lado dos exports existentes):
    ```ts
    export type NavScope = "segment" | "global";
    export interface NavItem {
      key: string;
      title: string;
      icon: LucideIcon;
      scope: NavScope;
      // For segment-scoped items, suffix is appended to /s/<slug>; for global, href is absolute.
      suffix?: string;
      href?: string;
      dreRoles?: readonly DreRole[];
      ctrlRoles?: readonly CtrlRole[];
    }
    export interface NavGroup {
      id: "financeiro" | "compras" | "plataforma";
      label: string;
      items: readonly NavItem[];
    }
    export const NAV_GROUPS: readonly NavGroup[] = [
      // FINANCEIRO — segment-scoped
      {
        id: "financeiro",
        label: "FINANCEIRO",
        items: [
          { key: "fin-dashboard", title: "Dashboard", icon: PieChart, scope: "segment", suffix: "/dashboard", dreRoles: ["admin","gestor_hero","gestor_unidade"] },
          { key: "fin-fluxo",     title: "Fluxo de Caixa", icon: Wallet, scope: "segment", suffix: "/fluxo-de-caixa", dreRoles: ["admin","gestor_hero","gestor_unidade"] },
          { key: "fin-budget",    title: "Budget e Forecast", icon: Target, scope: "segment", suffix: "/budget-forecast", dreRoles: ["admin","gestor_hero","gestor_unidade"] },
          { key: "fin-kpis",      title: "KPIs", icon: BarChart3, scope: "segment", suffix: "/kpis", dreRoles: ["admin","gestor_hero","gestor_unidade"] },
          { key: "fin-map",       title: "Mapeamento", icon: MapPinned, scope: "segment", suffix: "/mapeamento", dreRoles: ["admin"] },
          { key: "fin-config",    title: "Configurações", icon: Cog, scope: "segment", suffix: "/configuracoes", dreRoles: ["admin"] },
        ],
      },
      // COMPRAS — global (no /ctrl)
      {
        id: "compras",
        label: "COMPRAS",
        items: [
          { key: "ct-req",   title: "Requisições", icon: FileText, scope: "global", href: "/ctrl/requisicoes",   ctrlRoles: ["solicitante","gerente","diretor","csc","contas_a_pagar","admin"] },
          { key: "ct-apr",   title: "Aprovações", icon: CheckSquare, scope: "global", href: "/ctrl/aprovacoes",   ctrlRoles: ["gerente","diretor","csc","contas_a_pagar","admin"] },
          { key: "ct-cap",   title: "Contas a Pagar", icon: Receipt, scope: "global", href: "/ctrl/contas-a-pagar", ctrlRoles: ["gerente","diretor","csc","contas_a_pagar","admin"] },
          { key: "ct-orc",   title: "Orçamento", icon: DollarSign, scope: "global", href: "/ctrl/orcamento",     ctrlRoles: ["gerente","diretor","csc","admin"] },
          { key: "ct-rel",   title: "Relatórios", icon: BarChart3, scope: "global", href: "/ctrl/relatorios",    ctrlRoles: ["gerente","diretor","csc","contas_a_pagar","admin"] },
          { key: "ct-forn",  title: "Fornecedores", icon: Truck,    scope: "global", href: "/ctrl/admin/fornecedores", ctrlRoles: ["csc","admin","aprovacao_fornecedor"] },
          { key: "ct-evt",   title: "Eventos", icon: Calendar,      scope: "global", href: "/ctrl/admin/eventos", ctrlRoles: ["csc","admin"] },
        ],
      },
      // PLATAFORMA — global
      {
        id: "plataforma",
        label: "PLATAFORMA",
        items: [
          { key: "pf-conex",   title: "Conexões",    icon: Plug,           scope: "global", href: "/conexoes",            dreRoles: ["admin","gestor_hero"] },
          { key: "pf-users",   title: "Usuários",    icon: Users,          scope: "global", href: "/usuarios",            dreRoles: ["admin"] },
          { key: "pf-intel",   title: "Inteligência", icon: Brain,         scope: "global", href: "/admin/inteligencia",  dreRoles: ["admin"] },
          { key: "pf-painel",  title: "Painel Administrador", icon: LayoutDashboard, scope: "global", href: "/admin",   dreRoles: ["admin"] },
        ],
      },
    ] as const;
    ```
  - **Não remover** `DRE_*` / `CTRL_*` ainda — só nas fases 4–5.

**Validação:**
- `npm run build` — verde. Nenhum consumidor novo.
- `npm run lint`.

**Commit:** `feat(nav): add domain-based NAV_GROUPS structure (parallel to module-based lists)`

### Fase 2 — `NavLinks` v2 renderiza por grupos

**Objetivo:** trocar `NavLinks` para consumir `NAV_GROUPS`. Comportamento visual muda: sidebar passa a mostrar 3 grupos. Header ainda tem `ModuleSwitcher` (vai sair na fase 4) — vai conviver até lá, mas o conteúdo da sidebar não depende mais dele.

**Mudanças:**
- [`src/components/app/nav-links.tsx`](../../../src/components/app/nav-links.tsx):
  - Remover prop `activeModule` da assinatura.
  - Receber `dreRole: DreRole | null`, `ctrlRoles: CtrlRole[]`, `segments: Segment[]`, `activeSegmentSlug: string | null`, `collapsed`, `onNavigate`.
  - `buildItems` vira `buildGroups({dreRole, ctrlRoles, segments, activeSegmentSlug}) → Array<{group, items: RenderItem[]}>`.
  - Filtragem por item:
    - Se `item.scope === "segment"`: requer `dreRole` casar com `item.dreRoles` E ter `slug` resolvido; `href = /s/<slug><suffix>`.
    - Se `item.scope === "global"` com `dreRoles`: requer `dreRole` casar.
    - Se `item.scope === "global"` com `ctrlRoles`: requer interseção com `ctrlRoles` do usuário.
  - Grupo sem itens → não renderiza header nem divisor.
  - Sidebar com zero grupos visíveis → renderiza `<p>Sem acesso a nenhuma área — fale com um admin</p>`.
  - Active-href logic: preserva o "longest prefix match" único que já existe.
- [`src/components/app/app-shell.tsx`](../../../src/components/app/app-shell.tsx):
  - Atualizar chamada de `<NavLinks>` para a nova assinatura.
  - **Ainda passar** `userRole as dreRole` e `ctrlRoles`. Manter `ModuleSwitcher` no header por enquanto (só vai sumir na fase 4).
  - Ajustar `showSegmentSelector`: passa a ser baseado na rota atual, não no módulo. Adicionar helper local:
    ```ts
    function pathUsesSegment(pathname: string): boolean {
      return pathname.startsWith("/s/");
    }
    ```
    e usar `pathUsesSegment(pathname)` (já temos `usePathname()` disponível via client component).
- **Não** mexer em `layout.tsx` ainda — eles continuam passando `activeModule` e `availableModules`; `AppShell` apenas ignora `activeModule` para a sidebar mas ainda repassa pro `ModuleSwitcher`.

**Validação:**
- Rodar `npm run dev`.
- Login como admin com vários segmentos: sidebar mostra FINANCEIRO + COMPRAS (se tiver ctrlRoles) + PLATAFORMA.
- `gestor_unidade` com 1 segmento: só FINANCEIRO com 4 itens.
- Em `/usuarios` o seletor de segmento deve sumir.
- Em `/ctrl/requisicoes` o seletor de segmento deve sumir.
- `npm run build`.

**Commit:** `feat(nav): render domain groups in sidebar; segment selector becomes route-aware`

### Fase 3 — Critérios de aceite da spec (smoke manual)

**Objetivo:** validar exaustivamente o comportamento antes de remover código morto. Não há commit aqui (ou é um commit de pequenos ajustes).

**Checklist** (do spec, seção "Critérios de aceite"):
- [ ] Admin com 3+ segmentos + ctrlRoles + dreRole: vê 3 grupos, seletor de segmento ativo em rotas `/s/...` e some em `/usuarios`, `/admin`, `/ctrl/...`.
- [ ] `gestor_unidade` 1 segmento sem ctrlRoles: só FINANCEIRO com 4 itens; seletor vira label estática.
- [ ] Usuário só com ctrlRoles: só COMPRAS visível; seletor de segmento nunca aparece (nenhuma rota dele usa segmento).
- [ ] `/s/franquias/kpis` + troca pra "eventos" → vai pra `/s/eventos/kpis`.
- [ ] `/ctrl/requisicoes` → seletor de segmento ausente.
- [ ] Mobile: drawer abre, sidebar navegável. (O drawer da v1 mostra `ModuleSwitcher` no topo — aceitável durante esta fase; some na fase 4.)
- [ ] Tema claro/escuro: labels de grupo legíveis (`text-ink-muted/80`).
- [ ] Modo colapsado desktop: tooltips por item, labels de grupo somem, divisores entre grupos preservados.

**Possíveis ajustes finos** (cabem nesta fase em commits curtos):
- Divisor entre grupos: hoje a v1 tem `<div className="my-3 border-t border-border" />` antes do bloco admin. Para v2, colocar o divisor **antes** de cada grupo a partir do segundo (não antes do primeiro).
- Espaçamento entre grupos: `space-y-1` no `<nav>` pode precisar virar `space-y-1` no grupo e `mt-4` entre grupos.

**Commit (se houver ajustes):** `style(nav): polish group dividers, spacing, and active-state contrast`

### Fase 4 — Remover `ModuleSwitcher` e contrato de módulo do header

**Objetivo:** apagar o switcher de módulo da UI e cortar a dependência de `activeModule`/`availableModules` em `AppShell`.

**Mudanças:**
- [`src/components/app/app-shell.tsx`](../../../src/components/app/app-shell.tsx):
  - Remover import de `ModuleSwitcher` e `ModuleDefinition`.
  - Remover props `activeModule` e `availableModules`.
  - Remover bloco `{/* Desktop selectors */}` que renderiza `ModuleSwitcher`.
  - Mobile drawer: remover `ModuleSwitcher`; deixar só `SegmentSelector` no topo do drawer (já condicionado a `pathUsesSegment`).
  - Em mobile, se `pathUsesSegment` é false, o bloco `mb-4 space-y-2` que envolve o `SegmentSelector` some inteiro — ajustar para não deixar margem órfã.
- [`src/components/app/module-switcher.tsx`](../../../src/components/app/module-switcher.tsx): **deletar arquivo**.
- [`src/app/(app)/layout.tsx`](../../../src/app/(app)/layout.tsx) e [`src/app/(ctrl)/ctrl/layout.tsx`](../../../src/app/(ctrl)/ctrl/layout.tsx):
  - Parar de destructurar `availableModules`, `activeModule` do `resolveLayoutContext`.
  - Não passar essas props para `AppShell`.
- [`src/lib/context/modules.ts`](../../../src/lib/context/modules.ts):
  - Renomear `resolveLayoutContext` → `resolveActiveSegmentContext` e mudar assinatura para retornar só `{ activeSegmentSlug }`.
  - Remover `MODULES`, `MODULE_ORDER`, `ModuleDefinition`, `resolveAvailableModules`, `resolveActiveModule`, `ResolvedLayoutContext`.
  - Considerar mover/renomear o arquivo para `src/lib/context/segments.ts` (deixar mais honesto). Atualizar imports.
- [`src/lib/context/active-context.ts`](../../../src/lib/context/active-context.ts):
  - Remover `ACTIVE_MODULE_COOKIE`, `ActiveModule`, `VALID_MODULES`, `readActiveModule`.
  - Manter só `ACTIVE_SEGMENT_COOKIE`, `readActiveSegmentSlug`, `CONTEXT_COOKIE_OPTIONS`.
- [`src/app/api/context/route.ts`](../../../src/app/api/context/route.ts):
  - Aceitar só `{ segmentSlug }`. Retornar 400 se vier campo `module`.
  - Atualizar interface `ContextUpdateBody`.
- [`src/components/app/nav-links.tsx`](../../../src/components/app/nav-links.tsx):
  - Remover qualquer import residual de `ActiveModule` (se ficou da fase 2).

**Limpeza de imports e tipos órfãos:**
- Verificar com `Grep "ActiveModule|ACTIVE_MODULE|ModuleDefinition|availableModules|activeModule"` que sobrou só nos commits anteriores (zero ocorrências após esta fase).

**Validação:**
- `npm run build` — verde. TypeScript vai gritar em qualquer referência órfã, é o teste de cobertura.
- `npm run lint`.
- Re-rodar smoke da fase 3 — header sem `ModuleSwitcher`; tudo funciona igual.

**Commit:** `refactor(nav): remove module switcher and active_module cookie; sidebar is the single navigation surface`

### Fase 5 — Limpar `navigation.ts`

**Objetivo:** remover as listas antigas (`DRE_SEGMENT_DAILY_ITEMS`, `DRE_SEGMENT_ADMIN_ITEMS`, `DRE_GLOBAL_ADMIN_ITEMS`, `CTRL_DAILY_ITEMS`, `CTRL_ADMIN_ITEMS`).

**Mudanças:**
- [`src/components/app/navigation.ts`](../../../src/components/app/navigation.ts): deletar os 5 exports `DRE_*` / `CTRL_*`. Manter só `NAV_GROUPS` (e tipos).
- Grep por consumidores: `Grep "DRE_SEGMENT_DAILY_ITEMS|DRE_SEGMENT_ADMIN_ITEMS|DRE_GLOBAL_ADMIN_ITEMS|CTRL_DAILY_ITEMS|CTRL_ADMIN_ITEMS"` deve retornar zero fora do próprio arquivo (que vai ser deletado).

**Validação:**
- `npm run build` — última checagem de TypeScript.
- Smoke rápido no browser.

**Commit:** `refactor(nav): drop legacy module-based item lists; NAV_GROUPS is canonical`

### Fase 6 — Atualizar `CLAUDE.md`

**Objetivo:** documentar a topologia v2 pro próximo Claude que abrir o repo.

**Mudanças:**
- [`CLAUDE.md`](../../../CLAUDE.md): adicionar seção curta "Navigation" descrevendo:
  - Sidebar única agrupada por domínio (`NAV_GROUPS` em `navigation.ts`).
  - `SegmentSelector` no header é contextual — só em rotas `/s/...`.
  - Cookie `active_segment_slug` persiste segmento entre sessões. Não há `active_module`.
  - `(app)` e `(ctrl)/ctrl` compartilham o `AppShell` — mesma sidebar.

**Commit:** `docs(claude): document v2 navigation (domain groups, contextual segment selector)`

## Riscos e mitigações

| Risco | Mitigação |
|---|---|
| Quebrar acesso em algum perfil edge (ex.: usuário só com `aprovacao_fornecedor`) | Smoke da fase 3 cobre `gestor_unidade`, "só ctrl", admin pleno. Adicionar um teste manual extra: usuário só com `aprovacao_fornecedor` vê apenas Fornecedores em COMPRAS. |
| `pathUsesSegment` retornar falso em rota nova `/s/...` que ainda não existe | Usar `pathname.startsWith("/s/")` é robusto a qualquer rota futura segment-scoped. |
| Cookie `active_module` antigo sobrar em browsers de usuários ativos | Não causa bug — código v2 ignora. Pode ser limpo silenciosamente no `/api/context` (set com maxAge=0) se quisermos paranoia; **não é necessário**. |
| TypeScript não pegar uma referência órfã a `activeModule` que vire string mágica em runtime | Grep manual depois da fase 4 cobre o caso. |
| Conflito de merge com `main` durante o processo | Esta branch já tem 11 commits divergentes de `main`. Antes de começar, rebase / merge com `main` para reduzir surpresa no fim. |

## Reversão

Cada fase é um commit. Reverter é `git revert <hash>` da fase específica. As fases 1–3 são puramente aditivas/comportamentais — reverter qualquer uma delas sozinhas é seguro. As fases 4–5 são destrutivas (deletam código); reverter exige reverter na ordem inversa (5 → 4).

## Resumo de comandos

```powershell
# antes de começar
git checkout feat/menu-reorganization
git pull
git merge main           # ou rebase, conforme preferência

# após cada commit
npm run lint
npm run build

# smoke
npm run dev
# abrir http://localhost:3000 e seguir o checklist da fase 3
```

## Critério de "pronto"

- [ ] Todas as 6 fases commitadas em `feat/menu-reorganization`.
- [ ] `npm run build` verde no último commit.
- [ ] Smoke da fase 3 todo passando.
- [ ] `Grep "ActiveModule|ModuleSwitcher|active_module|availableModules"` retorna zero (fora de migrations/históricos).
- [ ] PR aberta apontando pra `main` com link pro spec v2 e este plano.
