-- Módulo Caixa: série diária do saldo para o gráfico "Evolução do caixa".
--
-- Recebe as contas que a tela está mostrando (o recorte de qualquer filtro) e
-- devolve, dia a dia, a soma do ÚLTIMO saldo conhecido de cada uma até aquele
-- dia. O "último conhecido" (carry-forward) é o ponto: num dia em que uma
-- empresa falhou na varredura, a conta dela não tem snapshot — sem o carry-
-- forward ela cairia para zero e o gráfico mostraria uma queda que não houve.
--
-- Dias anteriores à primeira captura de TODAS as contas ficam de fora (HAVING),
-- então a série começa onde há dado, não num zero falso.
--
-- SECURITY DEFINER só para service_role (regra da auditoria de 03/09/2026):
-- a rota /api/caixa/history chama com o admin client depois do gate do módulo.

-- Índice para o lookup "último snapshot da conta até o dia D": o existente
-- (account_id, captured_at) obrigaria a varrer para trás até achar o dia.
CREATE INDEX IF NOT EXISTS caixa_snapshots_account_day_idx
  ON public.caixa_balance_snapshots (account_id, captured_day DESC, captured_at DESC);

CREATE OR REPLACE FUNCTION public.caixa_history(p_account_ids UUID[], p_days INT DEFAULT 90)
RETURNS TABLE (day DATE, total NUMERIC, contas INT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH hoje AS (
    -- Dia em Brasília, como os snapshots (captured_day).
    SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date AS d
  ),
  dias AS (
    SELECT generate_series(
      (SELECT d FROM hoje) - (GREATEST(COALESCE(p_days, 90), 1) - 1),
      (SELECT d FROM hoje),
      interval '1 day'
    )::date AS d
  ),
  contas AS (
    SELECT a.id
    FROM public.caixa_accounts a
    WHERE a.id = ANY(p_account_ids)
  ),
  pontos AS (
    SELECT
      dias.d AS dia,
      contas.id AS account_id,
      (
        SELECT s.saldo
        FROM public.caixa_balance_snapshots s
        WHERE s.account_id = contas.id
          AND s.captured_day <= dias.d
        ORDER BY s.captured_day DESC, s.captured_at DESC
        LIMIT 1
      ) AS saldo
    FROM dias
    CROSS JOIN contas
  )
  SELECT
    pontos.dia AS day,
    COALESCE(SUM(pontos.saldo), 0)::numeric AS total,
    COUNT(pontos.saldo)::int AS contas
  FROM pontos
  GROUP BY pontos.dia
  HAVING COUNT(pontos.saldo) > 0
  ORDER BY pontos.dia;
$$;

REVOKE EXECUTE ON FUNCTION public.caixa_history(UUID[], INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.caixa_history(UUID[], INT) TO service_role;
