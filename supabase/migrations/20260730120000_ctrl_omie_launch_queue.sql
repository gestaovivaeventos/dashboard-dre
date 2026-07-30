-- Fila de lançamento no Omie (contas a pagar).
--
-- O envio em massa deixou de ser síncrono: a Omie bloqueia por "consumo
-- redundante" (proteção contra duplicidade) chamadas equivalentes dentro de
-- ~40s, então os lançamentos passaram a ser drenados por cron, um por vez.
--
-- A fila NÃO precisa de tabela nova: uma requisição enfileirada é
--   status = 'aprovado' AND omie_launch_status = 'pendente'
-- ('pendente' já é aceito pelo CHECK de omie_launch_status desde
-- 20260609230000 e nunca era gravado por nenhum caminho de código).
-- `omie_launched_at` serve de lease: preenchido ao reservar a requisição,
-- impede que duas execuções do cron peguem a mesma.
--
-- Só falta um lugar para guardar a previsão que o usuário escolheu editar no
-- momento do envio, já que o lançamento acontece minutos depois.

ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS omie_previsao_codigo bigint;

COMMENT ON COLUMN public.ctrl_requests.omie_previsao_codigo IS
  'Código da previsão (título Omie) que o usuário optou por editar no envio. Consumido pelo worker da fila e limpo após o lançamento.';

-- Worker: próximo da fila por empresa pagadora, mais antigo primeiro.
CREATE INDEX IF NOT EXISTS ctrl_requests_omie_queue_idx
  ON public.ctrl_requests (paying_company_id, sent_to_payment_at)
  WHERE omie_launch_status = 'pendente';
