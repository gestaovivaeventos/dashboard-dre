-- Um rendimento por CDI por credor e por fim de período. Duas execuções
-- simultâneas (duplo clique em "Lançar rendimento", ou um lançamento manual
-- correndo com o botão) leem o mesmo ponto de partida e gravariam o mesmo
-- segmento duas vezes — dinheiro real creditado em dobro, sem caminho de
-- exclusão. Com o índice, a segunda vira um insert recusado (23505).
CREATE UNIQUE INDEX IF NOT EXISTS vb_entries_cdi_one_per_period
  ON public.vb_entries (creditor_id, period_end)
  WHERE kind = 'rendimento' AND rate_basis = 'cdi' AND status = 'aprovado';
