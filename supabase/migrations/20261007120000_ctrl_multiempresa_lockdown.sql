-- ============================================================================
-- Compras (CTRL) multiempresa — ETAPA D: trava de schema.
-- Ver docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md (§7, §8).
--
-- Depende das etapas A/B (empresa Viva + org_id backfillado) e do CÓDIGO da
-- etapa C já no ar (grava org_id em todo insert e filtra por empresa). Aplicar
-- SÓ depois do deploy da etapa C — inclusive da correção do upload de orçamento
-- (auto-criação de tipo de despesa com org_id).
--
-- O que esta migration FAZ:
--   1. org_id NOT NULL nas 5 tabelas (o DEFAULT = Viva FICA — ver abaixo).
--   2. unique(name) -> unique(org_id, name) em ctrl_sectors e ctrl_expense_types
--      (senão a Feat não poderia ter um "Diretoria"/"Marketing" homônimo da Viva).
--   3. Isolamento por empresa na RLS: política RESTRICTIVE ctrl_has_org(org_id).
--
-- O que NÃO faz (fica para a ETAPA E, acoplado a código): DROP do DEFAULT;
-- fornecedor por empresa (índice de CNPJ + RPC ctrl_find_supplier_by_doc);
-- empresa na chave de duplicidade de ctrl_approval_email_log (lembrete por
-- empresa). Esses só importam quando a Feat existir.
--
-- Por que MANTER o DEFAULT agora: o NOT NULL fica sempre satisfeito pelo default,
-- então aplicar isto é risco ZERO mesmo que algum caminho de insert tenha
-- escapado — a linha cai na Viva (correto enquanto só existe a Viva). O DROP do
-- default (que faz um insert sem org_id FALHAR, em vez de cair calado na Viva)
-- entra na etapa E, com uma re-auditoria dos inserts, logo antes da Feat.
-- ============================================================================

do $$
declare
  t text;
begin
  if not exists (select 1 from public.ctrl_orgs where slug = 'viva-company') then
    raise exception 'ETAPAS A/B ausentes. Aplique 20261006130000 e 20261006140000 antes.';
  end if;

  -- 1. NOT NULL (o DEFAULT = Viva, posto na etapa B, continua).
  foreach t in array array[
    'ctrl_sectors','ctrl_expense_types','ctrl_requests','ctrl_events','ctrl_suppliers'
  ] loop
    execute format('alter table public.%I alter column org_id set not null', t);
  end loop;
end $$;

-- 2. Unicidade de nome por EMPRESA (era global). A UNIQUE de coluna criada em
--    20260421000001 tem o nome padrão <tabela>_name_key.
alter table public.ctrl_sectors drop constraint if exists ctrl_sectors_name_key;
alter table public.ctrl_sectors
  add constraint ctrl_sectors_org_name_key unique (org_id, name);

alter table public.ctrl_expense_types drop constraint if exists ctrl_expense_types_name_key;
alter table public.ctrl_expense_types
  add constraint ctrl_expense_types_org_name_key unique (org_id, name);

-- 3. RLS: isolamento por empresa. Predicado de policy (como is_admin /
--    has_ctrl_role): SECURITY DEFINER, liberado a authenticated. Admin passa
--    sempre; os demais só nas empresas concedidas em ctrl_user_orgs.
create or replace function public.ctrl_has_org(p_org uuid)
returns boolean language sql security definer stable as $$
  select public.is_admin()
      or exists (
        select 1
        from public.ctrl_user_orgs uo
        join public.users u on u.id = uo.user_id
        where uo.user_id = auth.uid() and uo.org_id = p_org and u.active
      );
$$;
revoke all on function public.ctrl_has_org(uuid) from public;
grant execute on function public.ctrl_has_org(uuid) to authenticated;

-- Política RESTRICTIVE: é AND'd com as permissivas existentes (has_ctrl_role),
-- então APERTA o acesso sem precisar reescrever as policies de cada tabela.
-- Hoje (todos concedidos à Viva, tudo Viva) é inerte; isola quando houver outra
-- empresa. Leitura pelo admin client (service role) ignora RLS, como já é o caso
-- nas telas que o usam — isto é 2ª linha de defesa para o client do usuário.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ctrl_sectors','ctrl_expense_types','ctrl_requests','ctrl_events','ctrl_suppliers'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_org_isolation', t);
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated '
      || 'using (public.ctrl_has_org(org_id)) with check (public.ctrl_has_org(org_id))',
      t || '_org_isolation', t);
  end loop;
end $$;
