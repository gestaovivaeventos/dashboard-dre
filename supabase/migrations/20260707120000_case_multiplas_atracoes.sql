-- Case: múltiplas atrações por contrato.
-- Cada atração tem seu próprio contrato de artista (anexo), valor e parcelas
-- de pagamento; os títulos a pagar somam todas. case_contracts.band_id e
-- attachment_path viram espelho da PRIMEIRA atração (compat com telas/PDF).

CREATE TABLE IF NOT EXISTS public.case_contract_atracoes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id     uuid NOT NULL REFERENCES public.case_contracts(id) ON DELETE CASCADE,
  band_id         uuid NOT NULL REFERENCES public.case_bands(id),
  attachment_path text,
  valor_artista   numeric(15,2) NOT NULL DEFAULT 0,
  pagar_schedule  jsonb,
  created_by      uuid REFERENCES public.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS case_contract_atracoes_contract_idx ON public.case_contract_atracoes(contract_id);

ALTER TABLE public.case_titles ADD COLUMN IF NOT EXISTS atracao_id uuid REFERENCES public.case_contract_atracoes(id) ON DELETE SET NULL;

-- Backfill: contratos existentes com atração única viram 1 linha de atração.
INSERT INTO public.case_contract_atracoes (contract_id, band_id, attachment_path, valor_artista, created_at)
SELECT c.id, c.band_id, c.attachment_path, c.valor_artista, c.created_at
FROM public.case_contracts c
WHERE c.band_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.case_contract_atracoes a WHERE a.contract_id = c.id);

UPDATE public.case_titles t
SET atracao_id = a.id
FROM public.case_contract_atracoes a
WHERE a.contract_id = t.contract_id AND t.leg = 'pagar_custodia' AND t.atracao_id IS NULL;

-- Reconstrói o cronograma de pagamento da atração a partir dos títulos existentes.
UPDATE public.case_contract_atracoes a
SET pagar_schedule = sub.sched
FROM (
  SELECT t.atracao_id, jsonb_agg(jsonb_build_object('vencimento', t.vencimento, 'valor', t.valor) ORDER BY t.parcela_numero) AS sched
  FROM public.case_titles t
  WHERE t.leg = 'pagar_custodia' AND t.atracao_id IS NOT NULL
  GROUP BY t.atracao_id
) sub
WHERE sub.atracao_id = a.id AND a.pagar_schedule IS NULL;

-- RLS: mesmo guard das demais tabelas do Case.
ALTER TABLE public.case_contract_atracoes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS case_contract_atracoes_rw ON public.case_contract_atracoes;
CREATE POLICY case_contract_atracoes_rw ON public.case_contract_atracoes FOR ALL TO authenticated
  USING (public.has_case_access())
  WITH CHECK (public.has_case_access());
