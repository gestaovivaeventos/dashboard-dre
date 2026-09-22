# Orçamento — ciclo construção → validação → retorno (desenho)

Data: 2026-09-22. Esta spec é o contrato da implementação.

**Status por fase**:
- **A (acesso por papel) — IMPLEMENTADA** em 22/09/2026. Migration de RLS
  `20260922120000` **aplicada**.
- **B (trilha + ciclo + versão + trava) — IMPLEMENTADA** em 23/09/2026 (lint,
  207 testes e build verdes). Migration `20260923120000_orcamento_ciclo_trilha_versao.sql`
  escrita; **aplicar antes de o ciclo funcionar** (o código degrada sozinho até lá).
  Uma parte foi deliberadamente adiada — ver "Desvio da fase B" abaixo.
- **C (validação) — IMPLEMENTADA** em 23/09/2026 (lint, 220 testes e build
  verdes), com o filtro de item cancelado ligado junto, como combinado.
- D, E, F: não começadas.

### O que a fase C descobriu, e que muda a spec

**O item do planejamento NÃO é linha de tabela.** A Prévia lê o planejamento do
jsonb `orcamento_planejamento_socios.proposta`, não de
`orcamento_planejamento_socios_itens` (essa tabela guarda a BASE da entrevista).
Consequências:

1. **Cancelar um item do planejamento é marcar `cancelado: true` dentro do
   jsonb** (`marcarItemProposta`, pura e testada), identificando o item por
   índice + descrição — a descrição é conferida para o cancelamento não cair no
   item errado se a proposta mudou desde que a tela carregou.
2. O filtro que vale é `itemPropostaAtivo`, aplicado na Prévia. O `itemAtivo()`
   (coluna `cancelado_em`) ficou para o PESSOAL, onde o item é linha de tabela.
3. **`orcamento_planejamento_socios_itens.cancelado_em`, criada na migration da
   fase B, não é usada** — foi criada na premissa errada. É nullable e inofensiva;
   fica como espaço para um cancelamento de item da base, se algum dia fizer
   sentido. Não a use esperando efeito no orçamento.
4. **`sanitizeItensProposta` precisou preservar a marca**: ele reconstrói o item
   campo a campo, então tudo o que não for copiado é descartado em silêncio — uma
   edição da proposta "descancelaria" o que a diretoria cortou, sem erro. A
   preservação está lá com comentário; **ao acrescentar campo ao item da
   proposta, copie-o no sanitizador**.
5. **A trava do planejamento mora na categoria × setor** (`diretoria_travado` na
   linha de `orcamento_planejamento_socios`), não no item: o item não tem linha
   própria, e é a proposta inteira que o construtor reescreve.

## 1. Contexto

O módulo Orçamento (`/orcamento`, empresa × ano a partir de 2027) já tem as
quatro telas de montagem — **Despesas com pessoal**, **Média com correção de
índices**, **Valor fixo com correção de índices** e **Planejamento dos
gestores** — mais a **Prévia**, que monta a DRE da empresa com os valores
orçados.

O que falta é o **processo**. Hoje o orçamento é um monte de valores que alguém
digita e ninguém aprova. O ciclo real do grupo tem três etapas:

1. **Construção** — cada gestor (gerente) monta o orçamento dos seus setores;
   o administrador (Lucas) monta média e valor fixo de todas as empresas.
2. **Validação** — a diretoria revisa tudo e pode cancelar, reduzir, aumentar,
   alterar valores e mover itens de categoria.
3. **Retorno** — os construtores veem o que a diretoria fez, entendem por quê,
   ajustam o que ficou pendente e têm a visão completa do que mudou.

### 1.1 O que já existe e condiciona o desenho

| Fato do código | Consequência |
|---|---|
| **Admin-only de ponta a ponta**: `getOrcamentoAdmin()` em `src/lib/orcamento/auth.ts`, RLS `is_admin()` em toda tabela `orcamento_*`, menu com `dreRoles: ["admin"]`, gate em `src/lib/auth/access.ts` (`pathname.startsWith("/orcamento")` ⇒ `false` para não-admin) | Nenhum gerente ou diretor entra hoje. **Acesso por papel é pré-requisito de tudo** (é a "Fase 3" que ficou pendente da departamentalização) |
| **A Prévia é calculada ao vivo** (`getPreviaOrcamento`), sem tabela nem "publicar" | Validar sem congelar é validar areia. Precisa de snapshot |
| `orcamento_setores.ctrl_sector_id` → `ctrl_sectors` ← `user_sectors` | A ponte gerente → setor **já existe**; nenhum cadastro novo |
| Chave comum dos métodos: `(company_id, year, category_code, setor_id)`; `orcamento_categoria_setores` diz quais setores orçam cada categoria | É a unidade de agrupamento das telas de validação e retorno |
| `PreviaFonte` / `PreviaFonteItem` já carregam abertura por item + `href` da tela de origem | Matéria-prima do snapshot e dos links do retorno |
| Selo heurístico em `src/lib/orcamento/status.ts` (Não iniciado / Em andamento / Concluído) | **Substituído** pelo estado do ciclo — não deixar duas fontes de verdade |
| Só o pessoal vai para Budget & Forecast (`enviarPreviaParaOrcamento`, `source='pessoal'`) | Média, valor fixo e planejamento nunca viram `budget_entries`. A publicação (fase E) fecha isso |
| O módulo lê/grava com service role depois do guard da action; RLS é `is_admin()` | Abrir para gerentes exige rever as duas camadas |

## 2. Objetivo e escopo

**Objetivo**: transformar o módulo num ciclo com dono, trava e trilha — cada
número tem um responsável, um momento em que foi congelado, e um registro de
quem o mudou e por quê.

**Entra**

1. Acesso por papel (construtor / validador / admin), com escopo por empresa e
   setor.
2. Ciclo por empresa × ano, com estados e trava de edição por fase.
3. Entrega por setor.
4. Versão congelada (snapshot) a cada envio para validação **e na conclusão** —
   as duas pontas do comparativo futuro (§10.F).
5. Trilha de alterações em toda escrita do módulo.
6. Trava da diretoria por item, com liberação explícita.
7. Telas de validação (diretor) e de retorno (construtor).
8. Publicação da Prévia inteira no Budget & Forecast.

**Fica de fora** (nesta rodada)

- Orçamento de **receita** (nenhum método orça receita hoje; a Prévia já avisa).
- Métodos VE (`viagens_ve`, `marketing_ve`, `endomarketing_ve`), sem tela.
- Clonagem de ciclo entre anos.
- Aprovação em mais de um nível de diretoria (um único degrau de validação).
- **A tela de comparativo construção × aprovado** — etapa futura descrita em
  §10.F. Fica de fora do escopo, mas **não** do modelo de dados: o que ela vai
  ler tem de ser congelado desde a fase B.

## 3. Decisões-chave

Todas tomadas com o Lucas em 21–22/09/2026. As alternativas listadas foram
**rejeitadas** — não repropor.

1. **O diretor decide item a item e edita direto os dados.** Não existe camada
   de "decisão" paralela ao dado: o diretor entra no item e muda. O que garante
   o processo é a **trilha**, não um formulário de decisão.
   *Rejeitado*: decisão como registro separado (overlay sobre o valor do
   construtor); validação só no nível categoria × setor.
2. **Cancelar é marca, não exclusão.** O item fica visível, riscado, com motivo
   e autor. Apagar faria o construtor perder o que escreveu e transformaria a
   trilha no único lugar onde o item existiu.
3. **Trava da diretoria.** Item alterado pelo diretor fica travado para o
   construtor. Só nasce destravado se o diretor marcar **"Permitir que o gestor
   ajuste"**. O construtor **não desfaz** alteração da diretoria — ele **pede
   liberação**, e o diretor libera.
4. **O diretor não edita média nem valor fixo.** São do Lucas. O diretor troca,
   no máximo, o **índice aplicado**. Qualquer outra mudança vira solicitação.
5. **"Mudança de categoria" = mover um item para outra categoria** (o Trello sai
   de Software e vai para Marketing). Não é trocar o *método* da categoria, que
   segue admin-only em Configuração.
6. **Entrega por setor; validação por empresa.** Cada gerente entrega o seu
   setor; o admin fecha a empresa para validação. A entrega é **sinal, não
   gate** (§6.2) — o envio é sempre o clique do admin. O diretor valida a
   empresa inteira, com o total à vista.
7. **Escopos**: diretor por `user_company_access` (mesmo escopo do Financeiro);
   gerente por `user_sectors → ctrl_sectors → orcamento_setores.ctrl_sector_id`,
   dentro das empresas de `user_company_access`.
8. **Snapshot no envio**, porque o diretor edita ao vivo: sem congelar, o
   "proposto" desaparece no instante da primeira alteração.
9. **Congelar também o aprovado, no *Concluir*.** Uma etapa futura (§10.F) vai
   comparar *o que os construtores montaram* × *o orçamento aprovado final*, e
   snapshot não se faz retroativamente: o dado ao vivo guarda só o estado
   corrente. As duas pontas do comparativo — versão `construcao` e versão
   `final` — têm de ser gravadas **agora**, na fase B, ou a comparação não
   existirá para o ciclo de 2027.
10. **Os construtores são os gerentes e o Lucas (admin).** Construção = a
    montagem nas quatro telas; o admin monta média e valor fixo de todas as
    empresas, além de operar o ciclo. Acumular os dois papéis é normal, não
    exceção: alteração do admin em `em_construcao` é construção como qualquer
    outra, e a trilha distingue pelo `autor_papel`.

## 4. Papéis e acesso

### 4.1 Concessão

Linha em `user_module_roles` (`module='orcamento'`), o mesmo caminho de Caixa,
Contratos e VB — nada de coluna nova em `users` (coluna nova exige migration, e
enquanto ela não roda o `select` explícito de `getSessionContext` quebra inteiro
com 42703 e derruba o app). A sessão expõe como `profile.can_orcamento`.

**Admin herda** (modelo Caixa/Contratos, não o do VB): `profile === 'admin'` já
tem tudo. `validador_contrato` segue ilha e não alcança.

Fonte de verdade: `src/lib/auth/orcamento.ts` (`ORCAMENTO_MODULE`,
`hasOrcamentoGrant`, `setOrcamentoGrant`, `fetchOrcamentoGrantUserIds`).

### 4.2 Papel dentro do módulo

Derivado do `users.profile`, não de um cadastro novo:

| `users.profile` | Papel no Orçamento | Alcance |
|---|---|---|
| `admin` | **admin** | Tudo, todas as empresas; transições do ciclo; média e valor fixo |
| `diretor` | **validador** | Empresas de `user_company_access`; valida item a item |
| `gerente` (Gerente Sócio) | **construtor amplo** | Vê a empresa inteira, edita os seus setores |
| `gerente_setor` (Gerente) | **construtor** | Só os seus setores |
| demais | — | Sem acesso, mesmo com a concessão |

A distinção `gerente` × `gerente_setor` é a mesma que já vale em
`/ctrl/orcamento` — reaproveitada de propósito, para não criar um terceiro
vocabulário de papéis.

**Escape hatch não construído na fase A**: a coluna `role` da linha de
`user_module_roles` aceita `construtor` | `validador` e, quando preenchida,
**sobrepõe** o perfil. É a saída para quem precise de papel no Orçamento
diferente do que tem no Compras. A fase A grava sempre `role='auto'`.

### 4.3 Guard das actions

`getOrcamentoUser()` substitui `getOrcamentoAdmin()` em **todas** as actions de
`src/lib/orcamento/actions/`, devolvendo:

```ts
interface OrcamentoUser {
  userId: string;
  papel: "admin" | "validador" | "construtor" | "construtor_amplo";
  companyIds: string[] | "todas";   // user_company_access; "todas" para admin
  setorIds: string[] | "todos";     // via ctrl_sector_id; "todos" p/ admin e validador
}
```

Toda action de escrita passa ainda por `assertPodeEscrever(user, ciclo, alvo)`,
que compõe **três** verificações: papel × fase do ciclo (§5), escopo
(empresa/setor) e trava do item (§7).

### 4.4 Rotas e RLS

- `src/lib/auth/access.ts`: o bloco que hoje nega `/orcamento` para todo
  não-admin passa a liberar quem tem a concessão **e** perfil elegível. O gate
  de `/orcamento/**/config/**` e `/orcamento/configuracoes-gerais` continua
  admin-only.
- `src/components/app/navigation.ts` / `nav-links.tsx`: o grupo `ORÇAMENTO`
  deixa de ser `dreRoles: ["admin"]` e passa a depender da flag do módulo.
- **Fiação do módulo**: os ~13 pontos já catalogados no CLAUDE.md ("Criar um
  módulo novo: os pontos de fiação"). A armadilha conhecida vale aqui —
  esquecer a flag num dos objetos montados campo a campo **compila limpo** e o
  item some do menu para todo mundo. Conferir `app-shell.tsx` **e**
  `nav-links.tsx`, e **abrir a tela**.
- **RLS**: as policies `is_admin()` de todas as tabelas `orcamento_*` passam a
  aceitar também o predicado `orcamento_pode_ler(company_id, setor_id)`
  (`SECURITY DEFINER`, liberado a `authenticated` por ser predicado de policy —
  mesmo enquadramento de `user_has_company_access()`). A escrita continua
  fazendo o guard na action; a RLS é a segunda linha de defesa. Toda função
  nova `SECURITY DEFINER` que **não** seja predicado de policy termina com
  `REVOKE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role`.

## 5. Máquina de estados

```
            ┌──────────────────────────────────────────────┐
            │                                              │
  em_construcao ──[admin: Enviar para validação]──▶ em_validacao
            ▲                                              │
            │                                [diretor: Concluir validação]
            │                                              ▼
            └──[admin: Reenviar (nova versão)]──────── em_ajuste
                                                           │
                                             [admin: Concluir]
                                                           ▼
                                                      concluido
                                                           │
                                            [admin: Publicar]
                                                           ▼
                                                      publicado
```

Quem edita o quê, por fase:

| Estado | Construtor | Validador (diretor) | Admin |
|---|---|---|---|
| `em_construcao` | edita os seus setores; **Entregar setor** | leitura | tudo; **Enviar para validação** (pode forçar com setor não entregue) |
| `em_validacao` | **somente leitura** | edita item a item, cancela, move, solicita, libera | tudo |
| `em_ajuste` | edita o que **não** está travado; responde solicitações; pede liberação | leitura; **libera** item travado | tudo; **Reenviar** ou **Concluir** (congela a versão `final`) |
| `concluido` | leitura | leitura | leitura; **Publicar** |
| `publicado` | leitura | leitura | leitura (reabrir = ação explícita, logada) |

**Reenviar** cria a versão *n+1* e volta o ciclo para `em_validacao`. A trava
dos itens **não** cai na virada de rodada: só sai pela mão do diretor.

Versões congeladas em cada transição (§6.3):

| Transição | Versão gravada |
|---|---|
| Enviar para validação (1ª vez) | `tipo='construcao'`, `numero=1` — **o que os construtores montaram** |
| Reenviar (rodada *n*) | `tipo='validacao'`, `numero=n` |
| Concluir | `tipo='final'` — **o orçamento aprovado** |
| Publicar | nenhuma (usa a `final`; publicar duas vezes não muda o registro) |

**Reabrir um ciclo `concluido`/`publicado`** é ação explícita do admin, logada, e
**não apaga** a versão `final`: ela ganha o `numero` seguinte quando for
concluído de novo. O histórico é aditivo.

## 6. Modelo de dados

### 6.1 `orcamento_ciclos`

Um por empresa × ano.

| Coluna | Tipo | Nota |
|---|---|---|
| `id` | uuid PK | |
| `company_id` | uuid FK companies | |
| `year` | int | UNIQUE `(company_id, year)` |
| `estado` | text | CHECK `em_construcao\|em_validacao\|em_ajuste\|concluido\|publicado` |
| `rodada` | int NOT NULL DEFAULT 0 | incrementa a cada envio |
| `enviado_em/_por` | timestamptz / uuid | último envio para validação |
| `validado_em/_por` | | conclusão da validação |
| `ajuste_concluido_em/_por` | | |
| `publicado_em/_por` | | |

Ciclo inexistente ⇒ `em_construcao` (não é preciso criar linha para toda
empresa; o `getCiclo` devolve o default).

### 6.2 `orcamento_setor_entregas`

Entrega por setor, **por rodada** — tabela própria em vez de colunas em
`orcamento_setores`, para a 2ª rodada não herdar as entregas da 1ª.

`(ciclo_id, rodada, setor_id)` PK · `entregue_em` · `entregue_por` ·
`desfeita_em` (o gerente pode retomar enquanto o ciclo não saiu).

> **A entrega é sinal, não gate.** Ela diz *"terminei o meu setor"* — é o que o
> admin olha para saber se pode fechar a empresa. **Não** implementar "só envia
> com 100% dos setores entregues": o admin também é construtor (média e valor
> fixo são dele) e essas duas telas **atravessam todos os setores**, sem que
> nenhum gerente as entregue. Um gate duro travaria o envio para sempre em
> qualquer empresa que tenha categoria por média ou valor fixo — ou seja, em
> todas. O envio é o clique do admin, com o aviso de quantos setores ainda não
> entregaram.

### 6.3 `orcamento_versoes`

O snapshot congelado. **É a única memória do orçamento em cada momento do
ciclo** — o dado ao vivo guarda só o estado final, e nenhuma versão pode ser
reconstruída depois. Por isso o que se congela e quando não é detalhe de
implementação: define o que a etapa futura de comparativo (§10.F) vai conseguir
responder.

| Coluna | Nota |
|---|---|
| `id`, `ciclo_id` | |
| `numero` | = rodada |
| `tipo` | **`construcao`** (envio inicial: o que os construtores montaram) \| **`validacao`** (reenvio após rodada) \| **`final`** (orçamento aprovado, congelado em *Concluir*) |
| `criada_em/_por`, `motivo` | |
| `total_ano numeric` | total da empresa, para leitura rápida e conferência |
| `payload jsonb` | fidelidade total (§abaixo) |
| `payload_schema int` | versão do formato do payload; leitor futuro precisa saber o que está lendo |

UNIQUE `(ciclo_id, numero, tipo)`. Uma versão **nunca** é sobrescrita.

O `payload` é o resultado do motor da Prévia **com abertura por setor**: linhas
da DRE × 12 meses, e por baixo as origens (método, categoria, setor) e os itens
com `id`, `rotulo`, meses e total. Guardar o `id` do item é o que permite o
antes × depois item a item; guardar o `rotulo` é o que faz o diff sobreviver a
renomeação e a item apagado.

> **Nota de implementação.** Hoje `PreviaFonte` não carrega o setor
> (`getPreviaOrcamento` recebe um `setorId` e filtra). Para o snapshot é preciso
> **ou** chamar a Prévia uma vez por setor, **ou** — preferível — acrescentar
> `setorId`/`setorNome` ao acumulador de origens. A segunda opção também serve
> à coluna por setor na própria Prévia.

### 6.4 `orcamento_versao_linhas` — o snapshot em forma tabular

As mesmas linhas do `payload`, achatadas em tabela. Existe por causa do
comparativo (§10.F): filtrar e somar várias empresas × anos × setores dentro de
`jsonb` é caro e desagradável; em tabela é um `GROUP BY`.

`versao_id` · `setor_id` · `category_code` · `metodo` · `dre_account_id` ·
`mes` (1–12) · `valor numeric` — PK `(versao_id, setor_id, category_code, metodo, dre_account_id, mes)`,
índices por `versao_id` e por `(setor_id, category_code)`.

Nasce do mesmo cálculo do `payload`, na mesma transação. **Custa pouco agora e é
irrecuperável depois**: sem ela, o comparativo teria de reprocessar `jsonb` de
histórico ou não existir.

O nível de item **não** entra aqui (fica só no `payload`): o comparativo trabalha
em categoria × setor, e o item é assunto do retorno, que lê a versão inteira.

### 6.5 Por que `budget_entries` não serve como registro do aprovado

A publicação (fase E) grava o orçamento final em `budget_uploads_raw` →
`budget_entries`, e é de lá que o Budget & Forecast compara orçado × realizado.
Mas `budget_entries` é **por conta da DRE e mês**, sem setor, sem categoria, sem
item — e é **reconstruído** a cada reprocessamento. Não dá para usá-lo como
memória do aprovado nem como um dos lados do comparativo. Daí a versão `final`.

### 6.6 `orcamento_alteracoes` — a trilha

Uma linha por escrita no módulo, **em qualquer fase**. Registrar sempre (não só
na validação) custa nada e é o que faz "ver tudo o que foi feito" ser completo;
a tela de retorno filtra por `fase='validacao'`.

| Coluna | Nota |
|---|---|
| `id`, `created_at` | |
| `ciclo_id`, `versao_id` | versão vigente quando a alteração ocorreu |
| `company_id`, `year`, `category_code`, `setor_id` | denormalizados: agrupar e filtrar sem join |
| `metodo` | `pessoal` \| `media` \| `valor_fixo` \| `planejamento_socios` |
| `alvo_tipo` | `colaborador` \| `planejamento_item` \| `valor_fixo_contrato` \| `media_linha` \| `categoria_setor` |
| `alvo_id` | uuid do item (nulo quando o alvo é a categoria × setor) |
| `alvo_rotulo` | nome do item **no momento** — sobrevive à renomeação e ao item apagado |
| `acao` | `criou` \| `alterou` \| `cancelou` \| `reativou` \| `moveu_categoria` \| `moveu_setor` \| `solicitou` \| `liberou` \| `contestou` \| `marcou_ciente` \| `atendeu` |
| `antes`, `depois` | jsonb; só os campos que mudaram |
| `motivo` | texto do autor (obrigatório para o diretor em `cancelou`/`alterou`/`solicitou`, e para o construtor em `contestou`) |
| `permite_alteracao` | bool; só em ação de diretor — espelha o checkbox (§7) |
| `autor_id`, `autor_papel` | |
| `resolucao` | `pendente` \| `atendida` \| `contestada` \| `liberada`; só em `solicitou`/`contestou` |
| `resolvido_em/_por` | |

`acao` é **texto livre com CHECK** — se aparecer verbo novo, é migration de
CHECK, não coluna nova.

### 6.7 Colunas novas nas tabelas de item

**Trava** (as quatro, porque o diretor também troca o índice de média e valor
fixo): `diretoria_travado boolean NOT NULL DEFAULT false`,
`diretoria_alterado_em timestamptz`, `diretoria_alterado_por uuid`.

- `orcamento_pessoal_colaboradores`
- `orcamento_planejamento_socios_itens`
- `orcamento_valor_fixo_categorias` (cada linha é um contrato — a UNIQUE caiu na
  migration `20260820120000`)
- `orcamento_media_categorias` (a linha categoria × setor é o item)

**Cancelamento** (só onde o diretor pode cancelar — §8):
`cancelado_em timestamptz`, `cancelado_por uuid`, `cancelado_motivo text` em
`orcamento_pessoal_colaboradores` e `orcamento_planejamento_socios_itens`.

> **Armadilha.** Item cancelado tem de sumir de **todos** os motores:
> `pessoal-calc.ts`, `serieItem`/`categoriaSerie` em `planejamento-calc.ts`,
> `projetarValorFixoSerie`, `previa-orcamento.ts`, `previa-budget.ts` e as
> contagens de status. Fazer **um** helper (`itemAtivo()` / filtro único na
> leitura) e usá-lo em todos — filtro repetido em seis lugares é garantia de
> esquecer um, e o sintoma é um orçamento que fecha maior sem ninguém ver.

## 7. A trava da diretoria

Regra: **toda alteração do diretor num item trava aquele item para o
construtor**, salvo se ele marcar "Permitir que o gestor ajuste".

- O checkbox fica no mesmo diálogo do motivo, e o seu valor vai para
  `permite_alteracao` na trilha e para `diretoria_travado` no item.
- Construtor tocando em item travado recebe
  *"Item alterado pela diretoria — peça liberação"*, com o botão **Pedir
  liberação** (abre comentário → entrada `contestou` na trilha,
  `resolucao='pendente'`).
- **Liberar** é ação do diretor (entrada `liberou`, resolve a contestação e
  vira a flag). É o único caminho: a trava não expira nem cai na virada de
  rodada.
- **Solicitação** (`solicitou` — o diretor pede sem mexer: *"reduza 10%, você
  escolhe onde"*) **não trava nada**, porque pressupõe que o construtor vá
  editar.
- Item que o diretor não tocou continua do construtor em qualquer fase de
  ajuste.

## 8. O que cada papel faz, por método

| Método | Unidade (item) | Diretor altera | Diretor cancela | Diretor move de categoria | Diretor troca índice | Diretor solicita |
|---|---|---|---|---|---|---|
| Despesas com pessoal | colaborador | salário, cargo, movimentações, benefícios | **sim** | — (mover de **setor**, que já existe) | — | sim |
| Planejamento dos gestores | item | valor, periodicidade, meses | **sim** | **sim** | — | sim |
| Média com correção | linha categoria × setor | **não** | **não** | — | **sim** (`indice_key`) | sim |
| Valor fixo com correção | contrato (linha) | **não** | **não** | — | **sim** (`indice_key` + `mes_reajuste`) | sim |

Em média e valor fixo o gate é **por campo**, não por action: `setMediaIndice`
aceita diretor; `setMediaValor`, `calcularMedia` e `recalcularTodasMedias` não.
`saveValorFixoContrato` aceita do diretor **apenas** `indice_key` e
`mes_reajuste` — o resto do payload é rejeitado, não ignorado em silêncio.

> **Armadilha do "mover de categoria".** O destino precisa (a) ter o método
> `planejamento_socios` em `orcamento_categoria_metodo` e (b) listar o setor do
> item em `orcamento_categoria_setores`. Sem (a) o item vira um valor que nenhuma
> tela mostra; sem (b) ele pousa num setor que não o lista. A action valida os
> dois e, no caso (b), atribui a categoria ao setor junto — mesmo tratamento que
> `moverLinhaDeSetor` já dá.

## 9. Telas

### 9.1 Painel e hub (existentes, revistos)

`/orcamento` e `/orcamento/empresa/[id]/[ano]`: o selo de `status.ts` dá lugar
ao **estado do ciclo** + progresso de entrega (`3 de 5 setores entregues`), com
os botões de transição conforme o papel. Para o gerente, o painel lista só as
empresas onde ele tem setor.

### 9.2 Workspace do construtor (existente, com trava)

As quatro abas ganham uma **faixa de estado** no topo (*"Em validação — somente
leitura"*, *"Retorno da diretoria — 4 itens travados, 2 solicitações
pendentes"*). Item travado aparece com cadeado; item cancelado, riscado, com o
motivo no hover. Config e Configurações gerais continuam admin-only.

### 9.3 Validação — `/orcamento/empresa/[id]/[ano]/validacao` (diretor)

Lista **setor → categoria → item**, com total da empresa sempre à vista.
Por linha: proposto (do snapshot), realizado do ano-base como referência, e as
ações do §8 inline (**Alterar** · **Cancelar** · **Mover categoria** ·
**Solicitar**). Um diálogo único para motivo + "Permitir que o gestor ajuste".
Filtros por setor, por categoria e por "só o que eu já mexi". Rodapé com
**Concluir validação** (avisa quantos itens ficaram travados e quantas
solicitações ficaram abertas).

A Prévia ganha as colunas **proposto × validado × Δ** enquanto houver versão.

### 9.4 Retorno — `/orcamento/empresa/[id]/[ano]/retorno` (construtor)

A trilha da fase de validação dos **seus** setores, agrupada por setor →
categoria, com antes × depois (versão × ao vivo) e link para a tela de origem
(reaproveitar `PreviaFonte.href`). Por entrada: **Ciente** (alterações),
**Atendida**/**Contestar** (solicitações), **Pedir liberação** (travados).
Cabeçalho com o placar: *"Seu orçamento saiu de R$ X para R$ Y (−Z%)"*.

### 9.5 Linha do tempo — aba na tela de retorno

Trilha completa do ciclo (todas as rodadas, todos os setores que o usuário
alcança), filtrável por autor, método e ação. É a resposta a "o que aconteceu
com o orçamento deste ano".

## 10. Fases de implementação

Cada fase é utilizável sozinha.

### A. Acesso por papel

Sem isso não há construção por gerente; entrega valor antes de qualquer
validação.

- `src/lib/auth/orcamento.ts` (concessão) + `session.ts` + `supabase/types.ts`
  (`can_orcamento` em `UnifiedProfile` e `ModuleAccess`).
- `getOrcamentoUser()` em `src/lib/orcamento/auth.ts`; troca em **todas** as
  actions (`cargos`, `categoria-metodo`, `categoria-setores`, `config`,
  `encargos`, `indices`, `media`, `mover-setor`, `pessoal`,
  `planejamento-socios`, `previa-budget`, `previa-orcamento`, `setores`,
  `status`, `valor-fixo`) com escopo por empresa e setor.
- Fiação do módulo (os ~13 pontos) + `access.ts` + `middleware.ts` + root page.
- "Módulos visíveis" na tela de Usuários + as 3 rotas de `api/users/*`.
- Policies RLS com `orcamento_pode_ler(company_id, setor_id)`.
- Aviso na tela de Setores para setor **sem** `ctrl_sector_id` (gerente não
  enxerga setor sem a ponte).

### B. Trilha + ciclo + versão + trava

A espinha dorsal. Sem tela de diretor ainda.

- Migration: `orcamento_ciclos`, `orcamento_setor_entregas`,
  `orcamento_versoes`, `orcamento_versao_linhas`, `orcamento_alteracoes`,
  colunas de trava e de cancelamento.
- `src/lib/orcamento/ciclo.ts` (puro: estados, transições permitidas por papel)
  + `actions/ciclo.ts` (Entregar setor, Enviar para validação, Concluir,
  Reenviar, Publicar).
- `registrarAlteracao()` chamado por toda action de escrita.
- `assertPodeEscrever()` (papel × fase × escopo × trava) em toda action de
  escrita.
- `itemAtivo()` aplicado nos seis motores.
- Snapshot: extensão do acumulador da Prévia com setor + `montarVersao()`, que
  grava `orcamento_versoes` **e** `orcamento_versao_linhas` na mesma transação.
  Os três momentos (`construcao`, `validacao`, `final`) já na fase B — a versão
  `final` é gravada pelo *Concluir* mesmo antes de existir tela de comparativo,
  porque congelar depois é impossível.
- Painel e hub passam a mostrar o estado do ciclo (aposenta `status.ts`).

### C. Validação

- Permissão do diretor nas telas de método durante `em_validacao`, com o
  diálogo motivo + "Permitir que o gestor ajuste".
- Gate por campo em média e valor fixo.
- Tela `/validacao` (§9.3) + **Concluir validação**.
- Prévia com proposto × validado × Δ.
- E-mail aos diretores da empresa no envio (Resend, remetente padrão do
  projeto; falha de e-mail não derruba a transição).

### D. Retorno

- Tela `/retorno` (§9.4) + linha do tempo (§9.5).
- Ciente / Atendida / Contestar / Pedir liberação + **Liberar** do lado do
  diretor.
- **Reenviar** marcando o que mudou desde a última versão.
- Faixa de estado e cadeados nas quatro telas de método.

### E. Publicação e avisos

- **Publicar**: a Prévia **inteira** (os quatro métodos, valores finais) vai
  para `budget_uploads_raw` com `source='orcamento'` →
  `reprocessBudgetEntriesForCompany`. Convive com `source='pessoal'` e
  `source='planilha'` (o upload de planilha só apaga o próprio `source`).
  Rótulo sem conta em "Linhas do Orçamento" volta em `naoMapeados`, como hoje.
- E-mails de validação concluída e de retorno concluído.
- Contadores no menu (itens travados, solicitações pendentes).

### F. Comparativo construção × aprovado (prevista, **não** construída agora)

Pedida pelo Lucas em 22/09/2026 como etapa futura. Não entra nesta rodada, mas
está aqui porque **determina o que a fase B tem de congelar** — e nada disso é
recuperável depois.

O que a tela vai responder: *"o que os construtores montaram × o que a diretoria
aprovou"*, por empresa, por setor, por categoria e por linha da DRE, com o Δ em
reais e em % e o total do grupo.

O que a fase B precisa entregar para que ela seja só tela:

1. Versão `tipo='construcao'` gravada no **primeiro** envio (a ponta esquerda).
2. Versão `tipo='final'` gravada no **Concluir** (a ponta direita).
3. `orcamento_versao_linhas` para somar por setor/categoria/conta sem abrir
   `jsonb` — é o que permite consolidar várias empresas numa consulta.
4. `alvo_rotulo` no `payload` e na trilha, para o diff não perder item renomeado
   ou apagado entre as rodadas.
5. Trilha com `motivo`, que é o que transforma um Δ em explicação: sem ele a tela
   mostra *"−R$ 180 mil"* e ninguém lembra por quê.

Decisões que ficam para quando a tela for construída (não decidir agora):
escopo (uma empresa × ano ou consolidado do grupo), se compara com o
**realizado** também (aí é a tela de Comparativos Anuais que já existe, não esta),
e se as rodadas intermediárias aparecem ou só as duas pontas.

**A ponta "construção" é o envio para validação — decidido, não em aberto**
(Lucas, 22/09/2026). "Construção" = a montagem do orçamento, e **os construtores
são os gerentes e o próprio Lucas**: as quatro telas de montagem, pelas mãos de
quem as preenche. Logo um ajuste do admin depois de um gerente entregar o setor
**é construção**, não interferência — não há o que separar. Fica descartado o
snapshot por setor no *Entregar setor* (tipo `entrega`), que só existiria para
essa distinção. Quem quiser saber quem mexeu em quê durante a construção lê a
trilha, que guarda autor e papel de cada alteração.

## 11. Estado do banco (conferido em 22/09/2026)

Sondado contra produção com script de schema (`select` por tabela/coluna,
classificando 42P01/42703 — a mesma técnica do `isSchemaMissing` do app):

1. **Todas as migrations do módulo estão APLICADAS**, inclusive as que notas
   antigas marcavam como pendentes (`20260730140000`, `20260731120000/130000/
   140000/150000/160000`, `20260904120000`, `20260904130000`) e os três RPCs
   (`orcamento_status_por_empresa`, `orcamento_media_realizado`,
   `orcamento_planejamento_realizado_itens` na assinatura de 4 args). A fase B
   não está bloqueada por schema.
2. **A migration de RLS da fase A (`20260922120000`) NÃO está aplicada.** Ela é
   a segunda linha de defesa da LEITURA: o módulo lê e grava com service role
   depois do guard da action, então a fase A funciona sem ela. Aplicar quando
   houver MCP do Supabase, `SUPABASE_ACCESS_TOKEN` ou CLI linkada.
3. **A ponte com o Compras está VAZIA**: os 6 setores ativos (VE Franqueadora e
   a empresa de teste) estão todos sem `ctrl_sector_id`. Enquanto isso, um
   gerente entra no módulo e não vê despesa nenhuma — de propósito (falha para
   o lado de esconder). O aviso na tela de Setores foi construído na fase A
   justamente para isso; **preencher o vínculo é pré-requisito operacional**
   para liberar o primeiro gerente.
4. **Setores "Não atribuído"**: entram no ciclo, mas nenhum construtor grava
   neles (`podeEscreverNoSetor` recusa linha sem dono) — dívida visível de
   propósito.

## 12. Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Filtro de item cancelado esquecido num motor ⇒ orçamento fecha maior, sem erro | Helper único + teste que soma a Prévia com e sem item cancelado |
| Duas fontes de status (selo heurístico × ciclo) | `status.ts` sai na fase B, não convive |
| Gerente sem `ctrl_sector_id` vê tela vazia e acha que é bug | Aviso na tela de Setores (fase A) + checagem antes de abrir o ciclo |
| Flag `can_orcamento` esquecida num dos objetos montados campo a campo ⇒ menu some para todos, build limpo | Conferir `app-shell.tsx` **e** `nav-links.tsx` e **abrir a tela** |
| Snapshot sem abertura por setor ⇒ retorno não consegue mostrar antes × depois por gerente | Extensão do acumulador da Prévia é parte da fase B, não opcional |
| **Versão não congelada na fase B é perdida para sempre** — o comparativo da §10.F simplesmente não existirá para o ciclo de 2027, e nenhum código futuro conserta | As três versões (`construcao`, `validacao`, `final`) + `orcamento_versao_linhas` entram na fase B, mesmo sem tela que as leia ainda. Conferir com um script que, ao concluir um ciclo de teste, as duas pontas existem e somam o esperado |
| Publicar/reabrir sobrescrevendo a versão `final` ⇒ perde-se o aprovado original | `orcamento_versoes` é aditiva, UNIQUE `(ciclo_id, numero, tipo)`, sem UPDATE de `payload` em lugar nenhum |
| Diretor edita e ninguém percebe que travou o item | O cadeado e o contador na faixa da tela do construtor são da fase D; até lá, a validação fica com o admin |

## 13. Arquivos

**Novos**: `src/lib/auth/orcamento.ts` · `src/lib/orcamento/ciclo.ts` (puro) ·
`src/lib/orcamento/trilha.ts` (puro: rótulos e agrupamento) ·
`src/lib/orcamento/actions/ciclo.ts` · `src/lib/orcamento/actions/trilha.ts` ·
`src/lib/orcamento/actions/validacao.ts` ·
`src/app/(app)/orcamento/empresa/[companyId]/[ano]/validacao/page.tsx` ·
`.../retorno/page.tsx` · `src/components/orcamento/validacao-view.tsx` ·
`retorno-view.tsx` · `linha-do-tempo.tsx` · `ciclo-faixa.tsx` ·
`item-travado-badge.tsx` · migrations do §6.

**Tocados**: as 15 actions de `src/lib/orcamento/actions/` ·
`src/lib/orcamento/auth.ts` · `status.ts` (removido do fluxo) ·
`previa-orcamento.ts` (setor nas origens) · `previa-budget.ts` (publicação
completa) · `pessoal-calc.ts`, `planejamento-calc.ts`, `valor-fixo-calc.ts`
(item cancelado) · `access.ts` · `session.ts` · `supabase/types.ts` ·
`supabase/middleware.ts` · `navigation.ts` · `nav-links.tsx` · `app-shell.tsx` ·
os layouts de módulo · `users-admin-manager.tsx` · `api/users/*` ·
`usuarios/page.tsx` · root `page.tsx` · as quatro telas de método.
