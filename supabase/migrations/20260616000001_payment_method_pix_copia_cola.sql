-- Adiciona 'pix_copia_cola' aos métodos de pagamento aceitos.
ALTER TABLE ctrl_requests DROP CONSTRAINT IF EXISTS ctrl_requests_payment_method_check;
ALTER TABLE ctrl_requests
  ADD CONSTRAINT ctrl_requests_payment_method_check
  CHECK (payment_method IN ('boleto','pix','transferencia','cartao_credito','dinheiro','pix_copia_cola'));
