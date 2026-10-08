-- API externa do Compras (hubfeat): trava contra requisição duplicada.
--
-- O hubfeat manda um Idempotency-Key em cada criação. Se a rede cair e ele
-- repetir o envio com a mesma chave, a API devolve a resposta da primeira vez
-- em vez de criar uma segunda requisição de pagamento.
-- Ver docs/superpowers/specs/2026-10-08-ctrl-api-hubfeat-design.md.

create table public.ctrl_api_idempotency (
  client       text        not null,               -- id do sistema externo (EXT_API_CLIENTS)
  key          text        not null,               -- Idempotency-Key enviado pelo cliente
  user_id      uuid        not null references public.users(id) on delete cascade,
  request_hash text        not null,               -- hash do corpo: mesma chave + corpo diferente é erro
  status       text        not null check (status in ('em_andamento', 'concluido')),
  http_status  integer,
  response     jsonb,
  created_at   timestamptz not null default now(),
  primary key (client, key)
);

comment on table public.ctrl_api_idempotency is
  'Respostas da API externa do Compras por Idempotency-Key. Só o service role lê e escreve.';

-- Sem policy: só o service role (a rota da API) alcança a tabela.
alter table public.ctrl_api_idempotency enable row level security;
revoke all on public.ctrl_api_idempotency from anon, authenticated;
