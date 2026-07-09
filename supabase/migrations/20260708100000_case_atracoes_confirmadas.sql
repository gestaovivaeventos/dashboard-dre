-- Gate de lançamento: com múltiplas atrações, o BV (margem) só fecha quando
-- TODOS os contratos de artista subiram. O usuário confirma explicitamente;
-- qualquer mudança nas atrações derruba a confirmação.
ALTER TABLE public.case_contracts
  ADD COLUMN atracoes_confirmadas_at timestamptz,
  ADD COLUMN atracoes_confirmadas_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

-- Contratos que já lançaram título no Omie ficam confirmados (já estão travados).
UPDATE public.case_contracts c
SET atracoes_confirmadas_at = now()
WHERE EXISTS (
  SELECT 1 FROM public.case_titles t
  WHERE t.contract_id = c.id AND t.status = 'lancado'
);
