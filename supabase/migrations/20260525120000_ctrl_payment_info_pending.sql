-- ============================================================
-- CTRL — Status e actions para o fluxo "Pedir info no pagamento"
-- ============================================================
-- Quando o usuario de contas_a_pagar precisa de mais informacao
-- antes de efetuar o envio, ele abre uma "solicitacao de info"
-- que bloqueia o envio ate o solicitante responder. Pode haver
-- varias trocas (thread) — cada turno gera um registro em
-- ctrl_history com action info_pagamento_solicitada ou
-- info_pagamento_respondida.

ALTER TYPE public.ctrl_request_status ADD VALUE IF NOT EXISTS 'info_pagamento_pendente';

ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'info_pagamento_solicitada';
ALTER TYPE public.ctrl_history_action ADD VALUE IF NOT EXISTS 'info_pagamento_respondida';
