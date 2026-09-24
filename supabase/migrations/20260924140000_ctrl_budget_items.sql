-- Itens de orçamento (rubricas) por setor × tipo de despesa × ano — subnível do
-- orçamento do Compras. Cada item (ex.: "Alura") tem orçado ANUAL próprio, e a
-- requisição aponta para ele (coluna budget_item_id abaixo); no Bloco 2 a
-- verificação de orçamento passa a rodar contra o item.
--
-- CAMADA ADITIVA: NÃO altera ctrl_budget nem o realizado histórico. Os itens
-- começam do zero — o consumo de um item é a soma dinâmica das requisições
-- vinculadas a ele. Requisição sem item cai no comportamento atual (balde do
-- setor × tipo). Assim o passado fica isolado e o Alura passa a ser conferido só
-- contra o orçamento do Alura.

create table if not exists public.ctrl_budget_items (
  id uuid primary key default gen_random_uuid(),
  sector_id uuid not null references public.ctrl_sectors(id) on delete cascade,
  expense_type_id uuid not null references public.ctrl_expense_types(id) on delete cascade,
  period_year integer not null,
  name text not null,
  amount numeric(14, 2) not null default 0, -- orçado ANUAL do item
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id),
  unique (sector_id, expense_type_id, period_year, name)
);
create index if not exists ctrl_budget_items_line_idx
  on public.ctrl_budget_items (sector_id, expense_type_id, period_year);

alter table public.ctrl_requests
  add column if not exists budget_item_id uuid references public.ctrl_budget_items(id);
create index if not exists ctrl_requests_budget_item_idx
  on public.ctrl_requests (budget_item_id) where budget_item_id is not null;

alter table public.ctrl_budget_items enable row level security;

-- Leitura: qualquer papel do módulo (o formulário de requisição precisa listar os
-- itens). Escrita: admin + csc/contas_a_pagar (mesmo enquadramento do ctrl_budget).
create policy ctrl_budget_items_read on public.ctrl_budget_items
  for select to authenticated
  using (public.has_ctrl_role(array['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));
create policy ctrl_budget_items_write on public.ctrl_budget_items
  for all to authenticated
  using (public.has_ctrl_role(array['admin','csc','contas_a_pagar']))
  with check (public.has_ctrl_role(array['admin','csc','contas_a_pagar']));
