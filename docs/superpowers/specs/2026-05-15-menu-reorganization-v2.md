# Reorganização do Menu — v2 (Domínio de Negócio)

**Data:** 2026-05-15
**Status:** Proposta — substitui [`2026-05-13-menu-reorganization-design.md`](./2026-05-13-menu-reorganization-design.md)
**Autor:** Marcelo + Claude

## Por que uma v2

A v1 introduziu o conceito de **módulo** (DRE vs Controladoria) como controle global no header, com switcher dedicado e uma sidebar diferente por módulo. Em uso, três problemas:

1. **Conceito arquitetural vazando pra UI.** Usuário pensa em tarefa ("aprovar requisição"), não em módulo ("ir pro módulo Controladoria"). O switcher força um nível de decisão mental que não existe na cabeça de quem usa.
2. **Dois controles globais no header** (módulo + segmento) — pra chegar em "Fluxo de Caixa de Franquias" são 3 escolhas espalhadas pelo chrome.
3. **Trocar de módulo é caro.** Quem usa DRE e Ctrl no mesmo dia paga 2 cliques de dropdown a cada troca. Sidebar muda — perde-se referência visual.

A v2 elimina o conceito de "módulo" da UI. Internamente o código pode continuar separando rotas (`/ctrl/*`, `/s/<slug>/*`), mas a navegação passa a ser organizada por **domínio de negócio**, que é o modelo mental real.

## Princípios

- **Tarefa, não módulo.** A sidebar agrupa páginas por domínio (Financeiro, Compras, Plataforma) — não por módulo técnico.
- **Um controle global, contextual.** Só o seletor de **segmento** vive no header, e só aparece quando a página atual depende de segmento.
- **Esconder o que não se aplica.** Sem papel num domínio → grupo inteiro some. Sem permissão em um item → item some.
- **Sem visões alternativas.** Uma sidebar só, sempre a mesma estrutura. Quem tem mais acesso vê mais.
- **YAGNI mantido.** Sem favoritos, drag-drop, sub-níveis, command palette, tour.

## Arquitetura da navegação

### Header

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Logo Viva]                  [Segmento: Franquias ▾]  [🔔] [🌓] [Avatar] │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Logo** à esquerda (link para `/home` do segmento ativo).
- **Seletor de segmento** ao centro/direita. **Só aparece quando a página atual depende de segmento.** Em `/usuarios`, `/admin`, `/admin/inteligencia`, `/conexoes`, `/ctrl/*` o chip não é renderizado.
  - <6 segmentos: dropdown simples.
  - ≥6 segmentos: dropdown com busca no topo.
  - 1 segmento: vira label estática.
  - 0 segmentos atribuídos: "Sem segmentos — fale com um admin".
- **🔔 Notificações:** atalho pra `/ctrl/notificacoes` com badge quando houver pendência. Só renderiza se usuário tem `ctrlRoles`.
- **🌓 Tema:** mantém comportamento atual.
- **Avatar ▾:** perfil + sair (atual).

**Removido da v1:** switcher de módulo. Não existe mais.

### Sidebar

Uma sidebar única, agrupada por **domínio**. Cada grupo tem uma label discreta uppercase (`text-ink-muted`, tracking ampliado, `text-xs`). Grupos sem itens visíveis somem inteiros.

```
FINANCEIRO                       ← se dreRole presente
  📊 Dashboard                   /s/<slug>/dashboard
  💰 Fluxo de Caixa              /s/<slug>/fluxo-de-caixa
  🎯 Budget e Forecast           /s/<slug>/budget-forecast
  📈 KPIs                        /s/<slug>/kpis
  🗺 Mapeamento                  /s/<slug>/mapeamento       [admin]
  ⚙ Configurações                /s/<slug>/configuracoes    [admin]

COMPRAS                          ← se ctrlRoles não vazio
  📄 Requisições                 /ctrl/requisicoes
  ✅ Aprovações                  /ctrl/aprovacoes           [gerente+]
  🧾 Contas a Pagar              /ctrl/contas-a-pagar       [gerente+]
  💵 Orçamento                   /ctrl/orcamento            [gerente+]
  📊 Relatórios                  /ctrl/relatorios           [gerente+]
  🚚 Fornecedores                /ctrl/admin/fornecedores   [csc/aprov_forn]
  📅 Eventos                     /ctrl/admin/eventos        [csc/admin]

PLATAFORMA                       ← se tiver algum item visível
  🔌 Conexões                    /conexoes                  [admin, gestor_hero]
  👥 Usuários                    /usuarios                  [admin]
  🧠 Inteligência                /admin/inteligencia        [admin]
  🛠 Painel Administrador        /admin                     [admin]
```

#### Regras de visibilidade

- **Item:** aparece se o usuário tem ao menos um papel listado.
- **Grupo:** aparece se ao menos um item dele aparece. Sem itens → sem header de grupo, sem espaço vazio.
- **Sidebar inteira:** se nenhum grupo tem itens (degenerado), exibe mensagem "Sem acesso a nenhuma área — fale com um admin".

#### Estado ativo

- Item da rota atual destaca com `bg-viva-500 text-white` (mantém padrão).
- **Um único best-match** (prefix mais longo) — comportamento já implementado no commit `28be2c0` preservado.
- `aria-current="page"` no item ativo.

### URLs e rotas

Nada muda em termos de URL vs v1:

- Páginas financeiras dependentes de segmento: `/s/<slug>/<sub>`.
- Páginas de compras: `/ctrl/<sub>` e `/ctrl/admin/<sub>`.
- Páginas de plataforma globais: `/admin`, `/admin/inteligencia`, `/usuarios`, `/conexoes`.
- Rotas globais duplicadas `/mapeamento` e `/configuracoes` continuam **removidas** (commit `dff2d5e`).

**Comportamento ao trocar segmento (header):**
- Rota `/s/<old>/<sub>` → redireciona para `/s/<new>/<sub>`. Página preservada.
- Rota global ou `/ctrl/*` → atualiza cookie silencioso, não redireciona.

## Cookies e contexto

A v1 introduziu dois cookies: `active_module` e `active_segment_slug`. Na v2:

- **`active_module` é eliminado.** Sem módulo na UI, sem cookie.
- **`active_segment_slug` é mantido.** Mesma semântica: persistência da escolha do usuário entre sessões.

Helpers em [`src/lib/context/active-context.ts`](../../../src/lib/context/active-context.ts) simplificam — só `readActiveSegmentSlug` / `writeActiveSegmentSlug`. O resolver `resolveLayoutContext` em [`src/lib/context/modules.ts`](../../../src/lib/context/modules.ts) é reduzido a `resolveActiveSegment`.

A API `POST /api/context` aceita apenas `{ segment: string }` agora. Validação contra a lista de segmentos do usuário (já existente) preservada.

## Responsivo

### Desktop (≥768px)

- Sidebar fixa à esquerda. Modo expandido (default) ou colapsado (icon-only).
- Modo colapsado: labels de grupo somem, tooltips no hover mostram nome do item, divisores entre grupos preservados.
- Header completo.

### Mobile (<768px)

- Sidebar vira **drawer** acionado por hambúrguer no header.
- Header mobile: `[hamburger] [logo] [segmento ▾ se aplicável] [avatar]`.
- Drawer abre com a sidebar normal — sem ter que empilhar seletor no topo (já que só tem um, e ele vive no header).

## Acessibilidade

- Seletor de segmento: `<button>` com `aria-haspopup="listbox"`; dropdown aberto foca no campo de busca (se ≥6) ou primeiro item.
- Labels de grupo: `role="presentation"` (decorativo); itens da sidebar são `<a>` em `<nav>`.
- `aria-current="page"` no item ativo.
- Contraste de labels de grupo e divisores conferido contra WCAG AA, claro e escuro.

## Comparação direta v1 vs v2

| Dimensão | v1 (atual implementado) | v2 (proposta) |
|---|---|---|
| Controles globais no header | 2 (módulo + segmento) | 1 (segmento, só quando aplica) |
| Trocar de "módulo" | dropdown 2-click | instantâneo (tudo visível na sidebar) |
| Visões de sidebar | 2 (uma por módulo) | 1 |
| Conceito mental imposto | módulo | domínio de negócio (já natural) |
| Cookies de contexto | `active_module` + `active_segment_slug` | `active_segment_slug` |
| Itens visíveis (admin com tudo) | ~6 por visão | ~14 totais |
| Escalar p/ 3º módulo | novo item no dropdown | novo grupo na sidebar |
| Escopo (segment vs global) | misturado no bloco "Admin" | óbvio pelo grupo onde está |

## Trade-offs honestos

- **Sidebar mais longa.** Admin com acesso a tudo vê ~14 itens vs ~6 na v1. Mitigações: modo colapsado já existe; grupos com label uppercase quebram visualmente; densidade ainda menor que o original pré-v1 (que tinha acordeão por segmento).
- **Migrar de v1 → v2 implica deletar código.** ModuleSwitcher, helpers de `active_module`, parte de `modules.ts`, lógica condicional de sidebar por módulo. Não é refactor leve — é simplificação real.

## Critérios de aceite (smoke)

- [ ] Admin com 3+ segmentos + ctrlRoles + dreRole: vê seletor de segmento no header (quando aplica), sidebar com 3 grupos (FINANCEIRO, COMPRAS, PLATAFORMA).
- [ ] `gestor_unidade` com 1 segmento, sem ctrlRoles: sidebar mostra só grupo FINANCEIRO com 4 itens; seletor de segmento vira label estática; sem 🔔.
- [ ] Usuário com só ctrlRoles (sem dreRole): sidebar mostra só COMPRAS; seletor de segmento não aparece (nenhuma rota dele depende de segmento).
- [ ] Em `/usuarios` (rota global), seletor de segmento some do header.
- [ ] Em `/s/franquias/kpis`, trocar segmento pra "eventos" leva pra `/s/eventos/kpis`.
- [ ] Em `/ctrl/requisicoes`, seletor de segmento não aparece (rota não depende de segmento).
- [ ] Mobile: drawer abre, sidebar navegável; segmento no header (compacto) quando aplica.
- [ ] Tema claro/escuro: labels de grupo legíveis em ambos.
- [ ] Modo colapsado: tooltips funcionam, divisores preservados, labels somem.

## Arquivos afetados (mapa inicial)

- [`src/components/app/navigation.ts`](../../../src/components/app/navigation.ts) — reagrupar itens em `FINANCEIRO`, `COMPRAS`, `PLATAFORMA`. Eliminar `DRE_*` / `CTRL_*` na divisão atual (módulos).
- [`src/components/app/nav-links.tsx`](../../../src/components/app/nav-links.tsx) — renderizar grupos por domínio; remover branching por `activeModule`.
- [`src/components/app/app-shell.tsx`](../../../src/components/app/app-shell.tsx) — remover `ModuleSwitcher` do header; tornar `SegmentSelector` contextual (não renderizar em rotas que não dependem de segmento).
- [`src/components/app/module-switcher.tsx`](../../../src/components/app/module-switcher.tsx) — **deletar**.
- [`src/lib/context/modules.ts`](../../../src/lib/context/modules.ts) — colapsar em `resolveActiveSegment`; remover `MODULES`, `MODULE_ORDER`, `resolveActiveModule`, `resolveAvailableModules`.
- [`src/lib/context/active-context.ts`](../../../src/lib/context/active-context.ts) — remover `readActiveModule` / `writeActiveModule`.
- [`src/app/api/context/route.ts`](../../../src/app/api/context/route.ts) — aceitar só `{ segment }`.
- [`src/app/(app)/layout.tsx`](../../../src/app/(app)/layout.tsx) e [`src/app/(ctrl)/ctrl/layout.tsx`](../../../src/app/(ctrl)/ctrl/layout.tsx) — passar a sidebar única; remover `activeModule` dos props.
- Sem novas migrações de DB.

## Próximo passo

Se aprovado, gerar plano de implementação detalhado via `superpowers:writing-plans`, com ordem de commits e checkpoints.
