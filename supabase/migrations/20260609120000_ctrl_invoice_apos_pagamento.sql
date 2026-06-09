-- Permite a resposta "Sim, após o pagamento" para "o fornecedor emite nota fiscal?".
-- Essa opção libera o envio da requisição sem anexo (a NF só será emitida depois).
ALTER TABLE ctrl_requests
  DROP CONSTRAINT IF EXISTS ctrl_requests_supplier_issues_invoice_check;

ALTER TABLE ctrl_requests
  ADD CONSTRAINT ctrl_requests_supplier_issues_invoice_check
  CHECK (supplier_issues_invoice IN ('sim','sim_apos_pagamento','nao','nao_sei'));
