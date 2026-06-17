-- omie_launch_status passou a ter o valor 'previsao_editada' (edição de previsão
-- recorrente no Omie), mas o CHECK não o aceitava — o UPDATE final falhava em
-- silêncio e a requisição ficava sem status. Recria o CHECK incluindo o valor.
ALTER TABLE ctrl_requests DROP CONSTRAINT IF EXISTS ctrl_requests_omie_launch_status_check;
ALTER TABLE ctrl_requests
  ADD CONSTRAINT ctrl_requests_omie_launch_status_check
  CHECK (omie_launch_status IN ('pendente','recebido','lancado','erro','previsao_editada'));
