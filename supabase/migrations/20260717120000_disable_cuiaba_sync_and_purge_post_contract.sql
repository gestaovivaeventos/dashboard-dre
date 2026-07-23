-- =============================================================================
-- Viva Cuiaba saiu do pacote de servicos (fim de contrato em 31/05/2026).
--
-- Objetivos (escopo: SOMENTE a empresa 'Cuiaba'):
--   1) Parar de sincronizar com a Omie, SEM esconder a empresa das telas. Por
--      isso NAO usamos `active` (esse campo controla a visibilidade em todo o
--      app); introduzimos `sync_enabled`, que so gateia a sincronizacao.
--   2) Apagar os lancamentos sincronizados a partir de 01/06/2026, preservando
--      tudo <= 31/05/2026 para consulta historica.
--   3) Recalcular os agregados materializados da Cuiaba, pois o Dashboard DRE e
--      o Fluxo de Caixa leem de dre_monthly_aggregates / cash_flow_monthly_aggregates
--      (nao de financial_entries direto).
--
-- As demais empresas nao sao afetadas: `sync_enabled` nasce com default true e
-- os cortes abaixo sao chaveados por name = 'Cuiaba'.
-- =============================================================================

-- 1) Flag de sincronizacao, separada de `active` (que controla visibilidade).
ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS sync_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.companies.sync_enabled IS
  'Quando false, a empresa nao e sincronizada com a Omie (cron nem manual). '
  'Diferente de `active`, que controla a visibilidade nas telas — uma empresa '
  'pode ficar visivel para consulta (active=true) sem sincronizar (sync_enabled=false).';

-- 2) Desliga o sync da Cuiaba mantendo-a visivel (active permanece inalterado).
UPDATE public.companies
SET sync_enabled = false
WHERE name = 'Cuiaba';

-- 3) + 4) Exclusao dos dados pos-contrato e recalculo dos agregados.
--    Regime de caixa => o corte e por payment_date. Preserva <= 31/05/2026.
--    As funcoes refresh_* fazem delete+insert de TODO o historico das empresas
--    EFETIVAS alvo; por isso capturamos tambem os destinos de roteamento de
--    departamento (caso algum lancamento da Cuiaba seja roteado para outra
--    empresa efetiva), garantindo que os agregados fiquem consistentes.
DO $$
DECLARE
  v_cuiaba_id uuid;
  v_affected  uuid[];
BEGIN
  SELECT id INTO v_cuiaba_id FROM public.companies WHERE name = 'Cuiaba';

  IF v_cuiaba_id IS NULL THEN
    RAISE NOTICE 'Empresa Cuiaba nao encontrada — nada a fazer.';
    RETURN;
  END IF;

  -- Empresas EFETIVAS impactadas: a propria Cuiaba + destinos de roteamento.
  SELECT array_agg(DISTINCT cid) INTO v_affected FROM (
    SELECT v_cuiaba_id AS cid
    UNION
    SELECT cd.routed_to_company_id
    FROM public.company_departments cd
    WHERE cd.company_id = v_cuiaba_id
      AND cd.routed_to_company_id IS NOT NULL
  ) t;

  -- Apaga os lancamentos a partir de 01/06/2026 (preserva <= 31/05/2026).
  DELETE FROM public.financial_entries
  WHERE company_id = v_cuiaba_id
    AND payment_date >= DATE '2026-06-01';

  -- Recalcula os agregados materializados das empresas efetivas impactadas,
  -- removendo as linhas de jun/2026+ que ficaram sem lancamentos.
  PERFORM public.refresh_dre_monthly_aggregates(v_affected);
  PERFORM public.refresh_cash_flow_monthly_aggregates(v_affected);
END $$;
