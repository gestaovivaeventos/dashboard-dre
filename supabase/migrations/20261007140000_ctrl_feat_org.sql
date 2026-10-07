-- ============================================================================
-- Compras (CTRL) multiempresa — ETAPA E: cria a empresa FEAT PRODUÇÕES.
-- Ver docs/superpowers/specs/2026-10-06-ctrl-multiempresa-design.md (§8, etapa E).
--
-- A Feat JÁ existe em `companies` (ativa, com credenciais Omie), então aqui só:
--   1. cria a empresa do Compras "Feat Produções" (ctrl_orgs);
--   2. vincula o CNPJ dela como pagador (ctrl_org_companies).
--
-- NÃO concede usuários (isso é na tela de Usuários, decisão do admin), NÃO cria
-- setores/tipos (o admin cadastra pela tela, com o seletor na Feat) e NÃO mexe no
-- Mapeamento Omie (o admin configura em Mapeamento Omie). A Feat nasce VAZIA — a
-- Viva fica intocada.
-- ============================================================================

do $$
declare
  feat_company uuid;
  feat_org uuid;
begin
  -- CNPJ pagador da Feat: a empresa já cadastrada em companies.
  select id into feat_company
  from public.companies
  where name ilike 'feat produ%' and active
  order by name
  limit 1;
  if feat_company is null then
    raise exception 'Empresa "Feat Produções" não encontrada (ativa) em companies.';
  end if;

  -- Empresa do Compras.
  insert into public.ctrl_orgs (nome, slug)
  values ('Feat Produções', 'feat-producoes')
  on conflict (slug) do nothing;
  select id into feat_org from public.ctrl_orgs where slug = 'feat-producoes';

  -- Vincula o CNPJ. O unique(company_id) de ctrl_org_companies garante que ele não
  -- pertence a outra empresa (os 5 da Viva não incluem a Feat).
  insert into public.ctrl_org_companies (org_id, company_id)
  values (feat_org, feat_company)
  on conflict do nothing;
end $$;
