# Reorganização do Menu — Design

**Data:** 2026-05-13
**Status:** Spec aprovado pelo usuário; aguardando plano de implementação
**Autor:** Marcelo + Claude (sessão de brainstorming)

## Problema

O menu lateral atual sofre de duas dores principais:

1. **Lógica invertida.** Hoje o usuário escolhe um *segmento* primeiro (acordeão) e depois a *página*. O fluxo mental natural é o oposto: escolher *o que* fazer (Dashboard, KPIs, Fluxo de Caixa…) e depois aplicar ao segmento.
2. **Mistura de níveis.** Itens de uso diário (Dashboard, KPIs, Fluxo de Caixa, Budget) competem visualmente com itens administrativos (Mapeamento, Configurações, Usuários, Painel Admin, Inteligência) no mesmo nível.

Para um admin com vários segmentos + papéis no Controladoria, o menu chega a 20+ itens visíveis simultaneamente quando segmentos estão expandidos — densidade alta demais.

Existe também a expectativa de que um **terceiro módulo** será adicionado em breve, o que torna a escalabilidade da navegação um requisito real, não hipotético.

## Princípios de design

- **Contexto global, menu enxuto.** Decisões persistentes (módulo, segmento) vivem no header. A sidebar mostra apenas as páginas do módulo ativo.
- **Separação por frequência de uso.** Itens administrativos ficam visualmente abaixo dos itens diários, num bloco distinto.
- **Esconder o que não se aplica.** Se o usuário só tem acesso a um módulo, o switcher some. Se só tem um segmento, o seletor vira label estática. Sem "menus mortos".
- **YAGNI.** Sem favoritos, drag-and-drop, sub-níveis, tour de onboarding ou command palette nesta entrega.

## Arquitetura da navegação

### Header

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [Logo]  [Módulo ▾]  [Segmento ▾]                    [🔔] [🌓] [Avatar ▾] │
│         DRE         Franquias Viva                                        │
└──────────────────────────────────────────────────────────────────────────┘
```

Da esquerda para a direita, do mais geral ao mais específico: **logo → módulo → segmento**.

#### Switcher de Módulo

- **Visual:** dropdown compacto à esquerda do seletor de segmento.
- **Comportamento:** troca o conjunto de páginas exibido na sidebar; persiste em cookie `active_module`; volta no módulo onde o usuário parou na próxima visita.
- **Visibilidade:** mostra apenas os módulos onde o usuário tem papel (`dreRole` define DRE, `ctrlRoles` definem Controladoria). Usuário com papel em um único módulo: o switcher some e vira um label estático com o nome do módulo ativo.
- **Escalabilidade:** o padrão dropdown acomoda 3+ módulos sem mudanças visuais (diferente de pill/abas, que consomem espaço linear).

#### Seletor de Segmento

- **Visibilidade:** aparece **apenas quando o módulo ativo é DRE Financeiro**. Controladoria e módulos futuros sem dimensão "segmento" não exibem este controle. Se o usuário tem apenas 1 segmento, o seletor vira label estática com o nome desse segmento (sem dropdown).
- **Tipo:**
  - <6 segmentos disponíveis: dropdown simples.
  - ≥6 segmentos: dropdown com campo de busca no topo (filtra por nome conforme o usuário digita).
- **Default na primeira visita:** primeiro segmento por `display_order`.
- **Persistência:** cookie `active_segment_slug` (cookie, não localStorage — funciona com Server Components do Next).
- **Comportamento ao trocar:**
  - Rota atual no formato `/s/<old-slug>/<page>` → redireciona para `/s/<new-slug>/<page>`. Página atual preservada.
  - Rota global (ex: `/admin`, `/usuarios`): troca o contexto silenciosamente (atualiza cookie) sem redirecionar.
- **Estado vazio:** se o usuário não tem nenhum segmento atribuído, exibe mensagem "Sem segmentos disponíveis — fale com um admin" no lugar do controle.

#### Outros elementos do header

- **🔔 Notificações:** atalho para `/ctrl/notificacoes` com badge de contador quando houver pendências.
- **🌓 Tema:** toggle claro/escuro (já implementado, mantém comportamento atual).
- **Avatar ▾:** menu com perfil e sair (mantém comportamento atual).

### Sidebar

A sidebar divide-se em dois blocos verticais separados por um divisor sutil e uma label discreta "ADMINISTRAÇÃO" (uppercase, cor `text-ink-muted`, tracking ampliado).

#### Módulo DRE Financeiro

**Uso diário** (topo):

1. Dashboard — `📊` — todos os papéis DRE
2. Fluxo de Caixa — `💰` — todos os papéis DRE
3. Budget e Forecast — `🎯` — todos os papéis DRE
4. KPIs — `📈` — todos os papéis DRE

**Administração** (rodapé, após divisor):

5. Mapeamento — `🗺` — admin
6. Configurações — `⚙` — admin
7. Conexões — `🔌` — admin, gestor_hero
8. Usuários — `👥` — admin
9. Inteligência — `🧠` — admin
10. Painel Admin — `🛠` — admin

#### Módulo Controladoria

**Uso diário** (topo):

1. Requisições — `📄`
2. Aprovações — `✅`
3. Contas a Pagar — `🧾`
4. Orçamento — `💵`
5. Relatórios — `📊`
6. Notificações — `🔔`

**Administração** (rodapé, após divisor):

7. Fornecedores — `🚚` — csc, admin, aprovacao_fornecedor
8. Eventos — `📅` — csc, admin

#### Comportamento da sidebar

- **Filtro por papel:** itens que o usuário não tem acesso simplesmente não aparecem. Se um usuário não tem nenhum item de administração (`gestor_unidade` no DRE, por exemplo), o divisor e a label "Administração" também não aparecem (sem espaço vazio).
- **Estado ativo:** item da rota atual destaca com a cor primária (`viva-500`), mantendo o padrão existente.
- **Acordeão por segmento eliminado.** Não há mais expansão/colapso de segmentos na sidebar — segmento é contexto do header.

### URLs e rotas

- Páginas por-segmento continuam usando `/s/<slug>/<sub>`. O `<slug>` vem do segmento ativo do header.
- **Remover as rotas globais duplicadas** `/mapeamento` e `/configuracoes` (versões em `DRE_RULES` de [`src/lib/auth/access.ts`](../../../src/lib/auth/access.ts)). Manter apenas as variantes por-segmento (`/s/<slug>/mapeamento`, `/s/<slug>/configuracoes`). Hoje as duas formas coexistem e causam ambiguidade.
- Rotas cross-segment continuam globais sem prefixo `/s/`:
  - `/admin` (Painel Administrador)
  - `/admin/inteligencia` (Inteligência)
  - `/usuarios`
  - `/conexoes`

## Responsivo

### Desktop (≥768px)

- Sidebar fixa à esquerda em modo expandido (padrão) ou modo colapsado (ícone-only).
- Modo colapsado:
  - Mantém os dois blocos com divisor entre eles.
  - Label "Administração" some.
  - Tooltips no hover exibem o nome do item.
- Header completo com módulo + segmento visíveis.

### Mobile (<768px)

- Sidebar vira **drawer** acionado por botão hamburger no header.
- Header mobile compacto: `[hamburger] [logo] [...] [avatar]`.
- Seletores de **módulo** e **segmento** descem para o topo do drawer (não cabem no header estreito) — drawer abre com os dois seletores empilhados no topo, depois a sidebar normal abaixo.

## Acessibilidade

- Switcher de módulo e seletor de segmento são `<button>` com `aria-haspopup="listbox"`; dropdown aberto recebe foco no campo de busca (quando presente) ou no primeiro item.
- Estado ativo na sidebar usa `aria-current="page"`.
- Teclado: `Tab` percorre header → sidebar → conteúdo; `Esc` fecha dropdowns; setas navegam itens do dropdown.
- Contraste do divisor e da label "Administração" verificados contra WCAG AA tanto em tema claro quanto escuro.

## Fora de escopo (YAGNI)

Os itens abaixo foram discutidos e adiados explicitamente:

- Favoritos de páginas por usuário.
- Reordenação drag-and-drop da sidebar.
- Sub-páginas aninhadas (nada hoje justifica outro nível).
- Tour/onboarding do novo menu.
- Command palette (`Cmd/Ctrl+K`) — fica como TODO opcional, não entra agora.
- Breadcrumb visual separado — módulo no header + página destacada + segmento no header já cobrem "onde estou".

## Arquivos afetados (mapa inicial)

A lista definitiva sai no plano de implementação; mapa de partida:

- [`src/components/app/navigation.ts`](../../../src/components/app/navigation.ts) — reagrupar itens em `daily` vs `admin`; remover dependência do acordeão de segmentos.
- [`src/components/app/nav-links.tsx`](../../../src/components/app/nav-links.tsx) — eliminar lógica de expansão por segmento; renderizar dois blocos (daily + admin) com divisor; comportar modo colapsado.
- [`src/components/app/app-shell.tsx`](../../../src/components/app/app-shell.tsx) — adicionar switcher de módulo e seletor de segmento no header; gerenciar estado responsivo do drawer mobile.
- [`src/app/(app)/layout.tsx`](../../../src/app/(app)/layout.tsx) — ler cookies `active_module` e `active_segment_slug`; passar para o `AppShell`.
- [`src/lib/auth/access.ts`](../../../src/lib/auth/access.ts) — remover entradas `/mapeamento` e `/configuracoes` de `DRE_RULES` (manter só as variantes em `SEGMENT_SUB_RULES`).
- Novos componentes: `ModuleSwitcher`, `SegmentSelector` (em `src/components/app/`).
- Novo helper: leitura/escrita de cookies de contexto (`active_module`, `active_segment_slug`).

## Critérios de aceite (smoke)

- [ ] Admin com 3+ segmentos: vê switcher de módulo, seletor de segmento (dropdown), e sidebar com dois blocos separados.
- [ ] Admin com 1 segmento: seletor de segmento vira label estática; restante igual.
- [ ] `gestor_unidade` com 1 segmento: sidebar mostra só 4 itens (sem divisor, sem label "Administração"), seletor de segmento estático, sem switcher de módulo (assumindo só DRE).
- [ ] Usuário com papel em DRE + Ctrl: switcher de módulo aparece; troca preserva contexto (volta no módulo onde parou).
- [ ] Trocar segmento em `/s/franquias/kpis` leva a `/s/eventos/kpis` (mesma página, novo segmento).
- [ ] Trocar segmento em `/admin` não redireciona (atualiza cookie silencioso).
- [ ] Mobile (<768px): drawer abre com seletores no topo; sidebar abaixo; tudo navegável.
- [ ] Rotas globais `/mapeamento` e `/configuracoes` retornam 404 ou redirecionam para variantes por-segmento (decidir no plano).
- [ ] Tema claro/escuro: divisor e label "Administração" legíveis em ambos.

## Próximo passo

Plano de implementação detalhado via skill `superpowers:writing-plans`.
