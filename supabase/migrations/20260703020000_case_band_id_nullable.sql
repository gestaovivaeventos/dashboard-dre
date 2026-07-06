-- Fase D.2: a atração/artista passou para a aba "Contrato Atração", que pode ser
-- preenchida separadamente. Logo, o contrato pode ser salvo (rascunho do cliente)
-- antes de escolher o artista — band_id vira opcional.
ALTER TABLE public.case_contracts ALTER COLUMN band_id DROP NOT NULL;
