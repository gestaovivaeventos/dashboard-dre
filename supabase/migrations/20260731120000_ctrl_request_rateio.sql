-- Rateio de uma requisição de pagamento entre VÁRIOS setores.
--
-- A requisição continua ÚNICA (1 número, e no envio 1 título no Omie com rateio
-- por departamento). A divisão entre setores — cada um com seu VALOR, seu
-- consumo de orçamento e sua APROVAÇÃO própria (gerente/diretor daquele setor) —
-- vive na tabela ctrl_request_sectors. A requisição só é considerada "aprovado"
-- quando TODOS os setores do rateio aprovarem.
--
-- Requisições de 1 setor só (o caso comum) NÃO usam esta tabela: continuam com
-- ctrl_requests.sector_id + amount e is_rateio = false. Nada muda para elas.

ALTER TABLE public.ctrl_requests
  ADD COLUMN IF NOT EXISTS is_rateio boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.ctrl_requests.is_rateio IS
  'true = requisição rateada entre setores (ver ctrl_request_sectors). sector_id guarda o 1º setor; amount é o total.';

CREATE TABLE IF NOT EXISTS public.ctrl_request_sectors (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id           uuid NOT NULL REFERENCES public.ctrl_requests(id) ON DELETE CASCADE,
  sector_id            uuid NOT NULL REFERENCES public.ctrl_sectors(id),
  amount               numeric(15,2) NOT NULL CHECK (amount > 0),
  -- Aprovação POR SETOR, espelhando o fluxo de 1 setor: nivel_2 = dentro do
  -- orçamento do setor (só gerente); nivel_3 = fora (gerente + diretor).
  approval_tier        text NOT NULL DEFAULT 'nivel_2' CHECK (approval_tier IN ('nivel_2','nivel_3')),
  status               text NOT NULL DEFAULT 'pendente'
                         CHECK (status IN ('pendente','pendente_diretor','aprovado','rejeitado')),
  manager_approved_by  uuid REFERENCES public.users(id),
  manager_approved_at  timestamptz,
  director_approved_by uuid REFERENCES public.users(id),
  director_approved_at timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (request_id, sector_id)
);

CREATE INDEX IF NOT EXISTS ctrl_request_sectors_request_idx ON public.ctrl_request_sectors(request_id);
CREATE INDEX IF NOT EXISTS ctrl_request_sectors_sector_idx  ON public.ctrl_request_sectors(sector_id);

ALTER TABLE public.ctrl_request_sectors ENABLE ROW LEVEL SECURITY;

-- Espelha a visibilidade de ctrl_requests: gestores/CSC/admin veem tudo; o
-- solicitante vê o rateio das próprias requisições. (O app usa o service role
-- para as operações do CTRL — a RLS é defesa em profundidade.)
CREATE POLICY "ctrl_request_sectors_read_all" ON public.ctrl_request_sectors
  FOR SELECT TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','gerente','diretor','csc']));

CREATE POLICY "ctrl_request_sectors_read_own" ON public.ctrl_request_sectors
  FOR SELECT TO authenticated
  USING (
    public.has_ctrl_role(ARRAY['solicitante'])
    AND EXISTS (
      SELECT 1 FROM public.ctrl_requests r
      WHERE r.id = ctrl_request_sectors.request_id AND r.created_by = auth.uid()
    )
  );

CREATE POLICY "ctrl_request_sectors_write" ON public.ctrl_request_sectors
  FOR ALL TO authenticated
  USING (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']))
  WITH CHECK (public.has_ctrl_role(ARRAY['admin','solicitante','gerente','diretor','csc']));
