# Compras (CTRL) exposto por API para o hubfeat — desenho

**Status:** desenho para revisão — nada implementado. Data: 08/10/2026.

## 1. Objetivo

Usuários da **Feat Produções** usam, de dentro do **hubfeat** (`~/Sistemas/saloes-eventos`), o fluxo de requisição de pagamento → aprovação → contas a pagar do Control Hub, sem abrir o Control Hub. O hubfeat desenha a própria tela; o Control Hub é o motor (regras, alçada, Omie).

**Fronteira (decisão do dono, 08/10/2026):** despesa da Feat **sem evento** vai pelo Control Hub; despesa **vinculada a evento** continua no fluxo próprio do hubfeat (`feat_supplier_payment`). A API recusa `event_id`.

**Escopo do hubfeat (decisão do dono, 08/10/2026): só SOLICITAR e ACOMPANHAR.** Aprovação e Contas a Pagar continuam nas telas do Control Hub. Na API ficam só cadastros, anexos, criar requisição, listar as próprias, detalhe e as RESPOSTAS do solicitante (complemento e info de pagamento — sem elas a requisição trava esperando alguém que não abre o Control Hub). Os endpoints de aprovar/reprovar/enviar à Omie da §4 e os webhooks da §5 ficam fora da v1: o hubfeat consulta o status ao abrir a tela.

**Fase 2 implementada (08/10/2026):** `POST /anexos` (devolve URL de upload assinada — o arquivo vai direto ao storage, sem passar pelo limite de 4,5 MB da Vercel), `POST/GET /requisicoes`, `GET /requisicoes/:id`, `POST /requisicoes/:id/responder`. Regras que a tela garante pelas opções e a action não confere ficam em `src/lib/ext-api/requisicoes.ts` (puro e testado): setor vinculado ao usuário, anexo só no formato exato do próprio usuário, sem evento, sem rateio. Toda rota de requisição confere POSSE (empresa da chave + criada por quem age) antes de chamar a action — `answerComplement`/`answerPaymentInfo` não conferem quem responde. Testado contra produção com a requisição nº 757 (R$ 1,00, Fernando).

**Fase 1 implementada (08/10/2026):** `src/lib/ctrl/injected-identity.ts` (identidade injetada + `ctrlReadClient`), `src/lib/ext-api/` (chave → empresa, resolução de quem age, wrapper das rotas; partes puras em `ext-api.test.ts`), `src/lib/auth/derive-roles.ts` (derivação de papel tirada de `session.ts`) e as rotas `GET /api/ext/v1/ctrl/{me,setores,tipos-despesa,fornecedores}`.

## 2. Princípios

1. **A regra mora num lugar só.** A API chama as MESMAS actions do Compras (`requests.ts`, `suppliers.ts` …). Nada de reimplementar validação na rota — senão a API aceita o que a tela recusa.
2. **A org é do servidor, nunca do cliente.** A chave de API está amarrada à org `feat-producoes`; nenhum parâmetro escolhe empresa. A chave não alcança a Viva nem por engano.
3. **Toda ação tem dono humano.** Aprovação, alçada e roteamento dependem de QUEM age. Cada chamada informa o usuário; a API recusa usuário sem concessão na Feat.
4. **Falha alta.** Erro volta com status HTTP e mensagem em português; webhook que não entregou fica registrado e é retentado — nada se perde calado.

## 3. Autenticação

### 3.1 Máquina
- Header `Authorization: Bearer <HUBFEAT_API_KEY>`, comparado em tempo constante (mesmo molde de `src/lib/auth/cron.ts`).
- Mapa `chave → org` no servidor (`EXT_API_CLIENTS`: `{ hubfeat: { keyEnv: "HUBFEAT_API_KEY", orgSlug: "feat-producoes" } }`). Permite um 2º cliente no futuro sem mudar a rota.
- Rotas sob `/api/ext/v1/ctrl/*`. O middleware já não bloqueia `/api/*`; cada rota se autentica.

### 3.2 Usuário (quem age)
- Header `X-Acting-User: <email>`.
- A API resolve `users` por e-mail (case-insensitive), exige `active`, `can_compras` e linha em `ctrl_user_orgs` para a org Feat. Papel = o mesmo resolvido hoje (`resolveCtrlRolesForOrg`).
- **Confiança:** o hubfeat autentica o próprio usuário e afirma o e-mail. É aceitável porque a chave só vive no servidor do hubfeat (mesmo grupo). Mitigação: trilha de toda chamada (§7).
- **Provisionamento:** usuário Feat precisa existir no Control Hub (`users` nasce do trigger de `auth.users`). Criar via convite do admin; ele não precisa logar no Control Hub nunca. Cadastro do papel e dos setores na tela de Usuários, como hoje.

### 3.3 Injeção da identidade no Compras
`getCtrlUser()` (`src/lib/ctrl/auth.ts`) é o único ponto onde sessão e org entram no módulo. Ele passa a consultar um `AsyncLocalStorage` (`ctrlIdentityStore`):
- **Com identidade injetada:** monta o `CtrlUserContext` a partir do usuário resolvido + org forçada, sem cookie e sem `getSessionContext()`.
- **Sem:** comportamento atual, byte a byte.

A rota da API faz `ctrlIdentityStore.run(identity, () => action(...))`. As actions não mudam de assinatura.

Pontos que leem com o client do USUÁRIO (RLS) não funcionam sem cookie: `getRequests`, `getRequestAttachmentUrl`, `getSectors`, `getExpenseTypes`, `getSuppliers`, `createSector/updateSector`. Helper novo `ctrlDb(userClientFactory)`: com identidade injetada devolve o admin client **e a action precisa ter o filtro por código** (`org_id`, `created_by` para solicitante). Cada um desses pontos é conferido um a um — trocar para admin client sem o filtro abriria a leitura da org inteira para um solicitante.

## 4. Endpoints (v1)

| Método | Rota | Action reaproveitada |
|---|---|---|
| GET | `/me` | — (papéis e setores do usuário na Feat) |
| GET | `/setores`, `/tipos-despesa`, `/fornecedores` | `getSectors`, `getExpenseTypes`, `getSuppliers` |
| POST | `/fornecedores` | `createSupplier` (entra em aprovação de fornecedor, como hoje) |
| POST | `/anexos` | upload multipart → `ctrl-attachments`, path `${userId}/…`; devolve o path |
| POST | `/requisicoes` | `createRequest` / `createRateioRequest` (sem `event_id`) |
| GET | `/requisicoes?status=&escopo=minhas\|aprovar` | `getRequests` |
| GET | `/requisicoes/:id` | **novo** `getRequestById` (com histórico, thread de complemento, URLs assinadas dos anexos) |
| POST | `/requisicoes/:id/aprovar` · `/reprovar` · `/complemento` · `/responder` | `approveRequest`, `rejectRequest`, `requestInfo`, `answerComplement` |
| POST | `/requisicoes/:id/info-pagamento` · `/responder-info-pagamento` | `requestPaymentInfo`, `answerPaymentInfo` |
| POST | `/contas-a-pagar/enviar` | `enqueueSendToPayment` (pagadora = o CNPJ da Feat, resolvido no servidor) |

- **Idempotência:** `POST /requisicoes` e `/fornecedores` exigem `Idempotency-Key`. Retentativa de rede do hubfeat não pode criar duas requisições de pagamento. Tabela `ctrl_api_idempotency` (migration `20261008120000`, aplicada em 08/10/2026). Só a resposta de sucesso é guardada; erro apaga a reserva para o cliente corrigir e reenviar com a mesma chave. Mesma chave com corpo diferente = 422. Sem limpeza automática ainda (volume baixo).
- **Anexo em dois passos** (upload → path → criar) porque o limite de corpo da Vercel é 4,5 MB; o mesmo arquivo grande num POST de requisição estouraria.
- Erros: `{ error: string }` + status (400 validação, 401 chave, 403 usuário sem concessão/papel, 404, 409 idempotência em andamento).

## 5. Webhooks para o hubfeat

- **Gatilho no banco**, não nas actions: trigger em `ctrl_requests` (mudança de `status`, `omie_launch_status`, pago) grava em `ctrl_webhook_outbox` quando a org da linha tem cliente externo. Motivo: `agendado`/pago acontecem no cron (`omie-launch-queue`, `reconcile-payments`), onde não há notificação nenhuma — gancho nas actions perderia justamente o "foi pago".
- Cron `/api/cron/ext-webhooks` (a cada minuto) entrega: `POST` para `HUBFEAT_WEBHOOK_URL` (`/api/webhooks/controlhub` no hubfeat — o middleware de lá já libera `/api/webhooks/*`).
- Assinatura `X-ControlHub-Signature: t=<ts>,v1=<hmac-sha256(secret, ts + "." + body)>`; o hubfeat recusa timestamp com mais de 5 min.
- Corpo **magro**: `{ event, request_id, status, occurred_at }`. O hubfeat busca o detalhe em `GET /requisicoes/:id` — assim o webhook nunca carrega dado desatualizado.
- Retentativa com backoff (1, 5, 30 min, 2 h, 12 h); depois disso fica `falhou` e alerta o `ADMIN_EMAIL`.

## 6. hubfeat

- Item novo no hub "HUB EVENTOS FEAT" (`src/components/Sidebar.tsx`): **Despesas da empresa**, com poder novo `despesa_empresa.ver/solicitar/aprovar` (catálogo em `src/lib/auth/permissions.ts` + migration de preset).
- `src/lib/feat/controlhub/client.ts`: cliente da API (server-only; chave em `CONTROLHUB_API_KEY`, `X-Acting-User` = e-mail do usuário logado).
- Telas: minhas despesas, nova despesa (setor, tipo, fornecedor, valor, vencimento, forma de pagamento, anexos), fila de aprovação, detalhe com histórico.
- Receptor `src/app/api/webhooks/controlhub/route.ts`: valida assinatura e invalida cache/notifica. **Nada é gravado como fonte de verdade no hubfeat** — o estado é do Control Hub.

## 7. Trilha

`ctrl_api_calls (client, acting_user_id, method, path, status, request_id, created_at)` — toda chamada, sucesso ou não. O `ctrl_history` continua registrando a ação com o usuário real, como se fosse pela tela.

## 8. Riscos a conferir antes de ligar

1. **Omie compartilhada.** O hubfeat sincroniza contas a pagar da Omie da Feat (`src/lib/feat/omie/payment-sync.ts`, `payment-matcher.ts`). Um título lançado pelo Control Hub pode ser casado por engano com um `feat_supplier_payment`. Conferir o critério do matcher e, se preciso, marcar os títulos do Control Hub (ex.: prefixo no `codigo_lancamento_integracao`) para o hubfeat ignorar.
2. **Fornecedor em dois cadastros** (`feat_supplier` no hubfeat × `ctrl_suppliers` da org Feat). Para despesa sem evento vale o do Control Hub; a tela do hubfeat lista pela API, não do próprio banco.
3. **Org Feat vazia**: setores, tipos de despesa e usuários precisam ser cadastrados antes do primeiro uso.
4. **Estado das migrations multiempresa** no banco remoto (os specs de 06 e 07/10 estão com cabeçalho desatualizado): conferir antes.

## 9. Fases

1. Identidade injetada + chave + `GET /me` e cadastros (prova o encanamento sem escrever nada).
2. Anexos + criar requisição + `getRequestById` + idempotência.
3. Aprovação e complemento.
4. Outbox de webhooks + cron + receptor no hubfeat.
5. Contas a pagar (enviar à Omie, info de pagamento) — depois de resolver o risco 8.1.
6. Telas no hubfeat.
