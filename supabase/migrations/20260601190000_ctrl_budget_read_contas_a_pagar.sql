-- O perfil unificado `contas_a_pagar` absorveu as permissões de `csc`
-- (ver deriveCtrlRoles em src/lib/auth/session.ts), mas a migração do modelo
-- unificado não atualizou todas as policies RLS que citavam `csc`. Resultado:
-- usuários contas_a_pagar abrem telas (o app os trata como csc) mas o RLS
-- devolve 0 linhas — ex.: a tela de orçamento aparecia sem orçado/realizado.
--
-- Aqui alinhamos o RLS ao modelo do app: em toda policy ctrl_* que concede a
-- `csc`, concedemos também a `contas_a_pagar`.

-- Orçamento (a tela do problema reportado)
ALTER POLICY "ctrl_budget_read" ON public.ctrl_budget
  USING (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc','contas_a_pagar']));
ALTER POLICY "ctrl_budget_write" ON public.ctrl_budget
  USING (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));

-- Eventos
ALTER POLICY "ctrl_events_read" ON public.ctrl_events
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));
ALTER POLICY "ctrl_events_write" ON public.ctrl_events
  USING (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));

-- Tipos de despesa (escrita)
ALTER POLICY "ctrl_expense_types_write" ON public.ctrl_expense_types
  USING (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));

-- Histórico de requisições
ALTER POLICY "ctrl_history_read" ON public.ctrl_history
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));
ALTER POLICY "ctrl_history_insert" ON public.ctrl_history
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']) AND (user_id = auth.uid()));

-- Notificações
ALTER POLICY "ctrl_notifications_insert" ON public.ctrl_notifications
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc','contas_a_pagar']));

-- Requisições (insert)
ALTER POLICY "ctrl_requests_insert" ON public.ctrl_requests
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']) AND (created_by = auth.uid()));

-- Setores (escrita)
ALTER POLICY "ctrl_sectors_write" ON public.ctrl_sectors
  USING (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));

-- Vínculo fornecedor x tipo de despesa
ALTER POLICY "ctrl_set_read" ON public.ctrl_supplier_expense_types
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));
ALTER POLICY "ctrl_set_write" ON public.ctrl_supplier_expense_types
  USING (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));

-- Histórico de fornecedor
ALTER POLICY "ctrl_supplier_history_read" ON public.ctrl_supplier_history
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));

-- Fornecedores
ALTER POLICY "ctrl_suppliers_insert_any" ON public.ctrl_suppliers
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));
ALTER POLICY "ctrl_suppliers_write_admin" ON public.ctrl_suppliers
  USING (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','csc','contas_a_pagar']));
