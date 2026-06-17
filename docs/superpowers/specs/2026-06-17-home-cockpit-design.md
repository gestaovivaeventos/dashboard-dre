# Home Cockpit — Design

**Data:** 2026-06-17
**Status:** aprovado para planejamento

## Problema

A `/home` atual mostra conteúdo genérico (indicadores econômicos, notícias, números do
sistema) e **ninguém é direcionado a ela ao logar** — `defaultLandingFor` manda cada
perfil direto para `/dashboard`, `/ctrl/requisicoes`, `/contratos` ou `/pendente`. O
resultado é uma página que "não faz sentido": não é landing de ninguém e não traz nada
acionável.

## Objetivo

Transformar a `/home` na **landing pós-login de todos os usuários**, como um **cockpit
role-aware**: cada usuário vê um conjunto de widgets montado conforme suas capacidades
(papéis CTRL + acesso aos módulos), priorizando ação ("o que precisa da minha atenção
agora") sem perder o panorama financeiro para quem é gestão.

## Decisões tomadas

- **Landing real (não página secundária):** `defaultLandingFor` passa a apontar para
  `/home` para todos os perfis (exceto `validador_contrato`, que continua em
  `/contratos` por ser uma ilha; e `pendente`, que continua em `/pendente`).
- **Personalização por perfil (role-aware):** widgets aparecem/somem por capacidade.
  Um usuário com vários papéis vê mais blocos.
- **Layout C (híbrido):** saudação → faixa de atenção → grade de widgets principais →
  rodapé financeiro (demovido, só gestão/financeiro).

## Layout

```
┌───────────────────────────────────────────────┐
│ Bom dia, {nome} · {data}                        │  1. Saudação
├───────────────────────────────────────────────┤
│ ⚡ Precisa da sua atenção: {itens quentes}       │  2. Faixa de atenção
├───────────────────────────────────────────────┤
│ ┌──────────────┐ ┌──────────────┐               │  3. Grade de widgets
│ │ Widget A     │ │ Widget B     │   (2 colunas)  │     principais
│ └──────────────┘ └──────────────┘               │
│ ┌──────────────┐ ┌──────────────┐               │
│ │ Widget C     │ │ Widget D     │               │
│ └──────────────┘ └──────────────┘               │
├───────────────────────────────────────────────┤
│ Visão financeira (gestão): KPIs · Caixa ·        │  4. Rodapé financeiro
│ Indicadores · Notícias                           │     (só financeiro/gestão)
└───────────────────────────────────────────────┘
```

## Faixa de atenção (topo)

Resumo agregado das pendências do usuário, montado a partir dos mesmos dados dos
widgets. Cada item é um link para o destino. Só aparecem itens com contagem > 0.
Exemplos de itens (conforme capacidade):

- `{n} aprovações aguardando você` → `/ctrl/aprovacoes`
- `{n} requisições com info pedida` → `/ctrl/requisicoes`
- `{n} falhas no envio ao Omie` → `/ctrl/contas-a-pagar`
- `{n} requisições rejeitadas` → `/ctrl/requisicoes`

Quando não há nada quente: mensagem neutra ("Tudo em dia.").

## Catálogo de widgets

Cada widget é um componente isolado, renderizado apenas quando a capacidade existe.

| Widget | Gating (capacidade) | Conteúdo | Fonte de dados | Ação |
|---|---|---|---|---|
| **Aprovações** | papel `gerente` ou `diretor` | Top 5 requisições aguardando **a etapa que o usuário pode aprovar** + contagem total | `ctrl_requests` status `pendente`/`pendente_diretor`, filtrado pela etapa acionável | Aprovar inline ou ir para `/ctrl/aprovacoes` |
| **Fila de pagamento** | papel `contas_a_pagar` ou `csc` | A enviar; vencendo hoje/semana; nº de falhas Omie | `ctrl_requests` status `aprovado`/`agendado` (+ `omie_launch_status = erro`) | Ir para `/ctrl/contas-a-pagar` |
| **Minhas requisições** | papel `solicitante` (ou qualquer um que crie requisições) | Status das próprias (pendente / info pedida / aprovada / rejeitada) | `ctrl_requests` `created_by = user` | "Nova requisição" + responder info pendente |
| **Orçamento do setor** | papel `gerente` ou `diretor` | Consumido vs disponível no ano, dos setores do usuário | budgets do setor + requisições aprovadas | Ir para `/ctrl/orcamento` |
| **KPIs do grupo** | acesso financeiro/gestão/admin | Receita, despesa, resultado do mês + variação vs mês anterior | `dre_monthly_aggregates` | Ir para `/dashboard` |
| **Caixa** | acesso financeiro/gestão/admin | Saldo / entradas-saídas do mês | `cash_flow_monthly_aggregates` | Ir para `/fluxo-de-caixa` |
| **Mini-DRE da unidade** | perfil `franqueado` | Resultado do mês da unidade do franqueado | aggregates no escopo do franqueado | Ir para `/dashboard` |
| **Indicadores + Notícias** | acesso financeiro/gestão | Dólar/Selic/etc + manchetes econômicas (conteúdo atual) | APIs existentes `/api/home/indicators`, `/api/home/news` | Links externos |

Observações:
- O widget de **estatísticas do sistema** ("Controll Hub em Números") atual é removido da
  posição de destaque — não é acionável para o dia a dia. Pode ser reaproveitado em
  `/admin` no futuro (fora do escopo).
- "Minhas requisições" aparece para qualquer usuário capaz de criar requisição
  (`solicitante`, `gerente`, `diretor`, `csc`, `admin`), pois todos podem ter requisições
  próprias.

## Arquitetura

- **Composição no server:** `src/app/(app)/home/page.tsx` (já `force-dynamic`) lê
  `getCurrentSessionContext()`, determina o conjunto de widgets, e dispara **em paralelo**
  (`Promise.all`) apenas as queries dos widgets visíveis. Passa os dados já resolvidos
  para `HomeView` (client) que apenas renderiza.
- **Componentes isolados:** um componente por widget em `src/components/app/home/`
  (ex: `widget-aprovacoes.tsx`, `widget-fila-pagamento.tsx`, etc.) + um
  `attention-strip.tsx`. `HomeView` compõe a partir das props.
- **Performance:** leituras CTRL são `count`/top-5 (leves); números financeiros usam os
  `*_monthly_aggregates` (não varrem `financial_entries`). Indicadores/notícias seguem
  client-side via os `/api/home/*` atuais para não bloquear o primeiro paint.
- **Degradação isolada:** cada query de widget é envolta em `try/catch`; falha de uma
  (ex: tabelas CTRL ausentes, sem aggregates) faz aquele widget sumir/mostrar vazio sem
  derrubar a página — segue o padrão já presente em `home/page.tsx`.
- **Roteamento/gating:** `defaultLandingFor` passa a retornar `/home` para
  `admin`/`franqueado`/financeiro/compras. `/home` já está no whitelist do `franqueado`
  (`FRANQUEADO_BASE_PATHS`); confirmar que os demais perfis também acessam `/home`.

## Fora de escopo (YAGNI)

- Personalização manual (arrastar/fixar widgets, esconder por preferência).
- Widgets configuráveis por usuário.
- Realocar "Controll Hub em Números" para `/admin`.
- Notificações em tempo real (a home recarrega no acesso/refresh).

## Critérios de sucesso

- Ao logar, cada perfil cai numa `/home` cujo conteúdo é relevante ao seu papel.
- Diretor/gerente vê aprovações pendentes e age sem navegar.
- Contas a pagar vê a fila e as falhas Omie de cara.
- Solicitante vê o status das suas requisições e cria uma nova em 1 clique.
- Gestão vê os números do grupo (resultado do mês, caixa) acima da dobra inferior.
- A home não quebra quando um módulo/tabela não está disponível para o usuário.
