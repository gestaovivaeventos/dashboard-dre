-- ============================================================================
-- Compras (CTRL) multiempresa — ETAPA B: coluna org_id nas tabelas de domínio,
-- com BACKFILL de todas as linhas existentes para a empresa "Viva Company".
-- Ver docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md (§4, §8).
--
-- Depende da ETAPA A (20261006130000) já aplicada. Continua INERTE (leitura e
-- escrita seguem funcionando): o app ainda não filtra nem grava org_id — isso é a
-- etapa C. Como TODA linha de hoje vira Viva e, na etapa C, a empresa ativa de
-- todo usuário atual é a Viva, o resultado é idêntico ao de hoje (diff-zero).
--
-- EXPAND/CONTRACT: aqui a coluna fica NULLABLE e com DEFAULT = Viva — assim os
-- inserts do app ANTES da etapa C (que ainda não passam org_id) caem na Viva e
-- continuam visíveis. O SET NOT NULL + DROP DEFAULT acontece na ETAPA D, depois
-- que o código passa a gravar org_id explicitamente. Pôr NOT NULL agora quebraria
-- toda criação (setor/requisição/fornecedor) até a etapa C entrar.
--
-- NÃO ganham org_id de propósito: ctrl_budget / ctrl_budget_items (derivam a
-- empresa via sector_id); o mapeamento Omie (ctrl_company_omie_config etc.) já é
-- por company_id (CNPJ, que pertence a uma empresa via ctrl_org_companies).
-- ============================================================================

do $$
declare
  viva uuid;
  t text;
begin
  -- Falha cedo e claro se a etapa A não foi aplicada.
  select id into viva from public.ctrl_orgs where slug = 'viva-company';
  if viva is null then
    raise exception
      'ETAPA A ausente: empresa "viva-company" não existe. Aplique 20261006130000_ctrl_orgs.sql antes.';
  end if;

  foreach t in array array[
    'ctrl_sectors','ctrl_expense_types','ctrl_requests','ctrl_events','ctrl_suppliers'
  ] loop
    -- coluna + FK (sem ON DELETE: não se apaga empresa que ainda tem dados)
    execute format(
      'alter table public.%I add column if not exists org_id uuid references public.ctrl_orgs(id)', t);
    -- backfill: tudo que existe hoje é Viva
    execute format('update public.%I set org_id = %L where org_id is null', t, viva);
    -- DEFAULT transitório = Viva (removido na etapa D, junto do SET NOT NULL)
    execute format('alter table public.%I alter column org_id set default %L', t, viva);
    -- índice para o filtro por empresa
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_id_idx', t);
  end loop;
end $$;
