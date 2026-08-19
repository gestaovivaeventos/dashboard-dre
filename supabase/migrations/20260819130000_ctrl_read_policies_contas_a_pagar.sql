-- Leitura dos cadastros do módulo Compras para o perfil `contas_a_pagar`.
--
-- A migração 20260601190000 alinhou várias policies ctrl_* ao modelo do app
-- (onde `contas_a_pagar` absorveu o `csc`), mas deixou de fora justamente as
-- policies de LEITURA de três cadastros: setores, tipos de despesa e
-- fornecedores. No banco, get_ctrl_role() devolve 'contas_a_pagar' — que não
-- consta nesses ARRAYs — então o usuário abre a tela de Nova Requisição e
-- recebe listas vazias (setor/tipo/fornecedor sem opção nenhuma).
--
-- O app já contorna isso lendo esses três cadastros pelo service role quando o
-- role é contas_a_pagar; esta migração corrige a origem do problema.

ALTER POLICY "ctrl_sectors_read" ON public.ctrl_sectors
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));

ALTER POLICY "ctrl_expense_types_read" ON public.ctrl_expense_types
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));

ALTER POLICY "ctrl_suppliers_read" ON public.ctrl_suppliers
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc','contas_a_pagar']));
