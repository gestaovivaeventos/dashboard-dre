-- =============================================================================
-- `budget_uploads_raw.source`: aceita as FATIAS do Finalizar e aposenta o
-- publicador antigo (02/10/2026).
--
-- ── 1. O que estava quebrado ──────────────────────────────────────────────
-- O CHECK era uma lista fechada de dois valores:
--
--   CHECK (source IN ('planilha', 'pessoal'))
--
-- e o Finalizar Orçamento grava uma source DETERMINÍSTICA por fatia
-- (`orc:<metodo>:<categoria>:<setor>`), que é um conjunto ABERTO — uma por
-- método × categoria × setor. Resultado: clicar em Finalizar devolvia
-- "new row for relation budget_uploads_raw violates check constraint
-- budget_uploads_raw_source_check" e nada era publicado.
--
-- Mesmo erro de desenho dos quatro CHECK destravados em `20261001130000`: valor
-- novo inventado no código sem conferir a constraint da coluna. Esta é a quinta.
--
-- ── 2. O Budget de 2027 já tinha valor sem ninguém finalizar ──────────────
-- Conferido contra produção com contagem EXATA (header `count=exact`, não a
-- primeira página — a leitura sem filtro trunca em 1000 linhas e esconderia isto):
--
--   budget_uploads_raw: 8172 linhas = 8100 'planilha' (todas 2026)
--                                   +   72 'pessoal'  (todas 2027, 1 empresa)
--   budget_entries:     6296 linhas = 6224 em 2026 + 72 em 2027
--   fatias publicadas ('orc:%'):      0
--   orcamento_finalizacoes:           0 linhas
--
-- As 72 linhas de 2027 são do publicador ANTIGO, `enviarPreviaParaOrcamento`,
-- que gravava a folha com `source = 'pessoal'`. O botão dela saiu da tela em
-- 29/09/2026 e a action ficou sem NENHUM chamador; agora o arquivo também saiu.
--
-- Pior do que aparecer cedo: a fatia do Pessoal publica em `orc:pessoal:…`, que
-- NÃO colide com `'pessoal'`. Ao finalizar, o `reprocess.ts` somaria as duas
-- origens e o Budget contaria a folha DUAS VEZES — número dobrado, sem erro em
-- lugar nenhum. Por isso a limpeza vem junto da correção, e não depois.
--
-- Apagar é reversível pelo próprio produto: finalizar a fatia republica o valor,
-- agora com a source certa e só com o que a diretoria aprovou.
-- =============================================================================

-- ── A ORDEM importa: `budget_entries` sai ANTES das linhas cruas ────────────
-- `reprocessBudgetEntriesForCompany` limpa só os anos que ENCONTRA nas linhas
-- cruas (`yearsTouched`). Apagando as cruas primeiro, 2027 deixaria de ser
-- "tocado" e o `budget_entries` dele ficaria órfão — o Budget seguiria mostrando
-- o valor antigo para sempre, sem nada no banco que explicasse de onde vinha.
--
-- O escopo é EXPLÍCITO: só os pares (empresa, ano) que têm linha `'pessoal'`.
-- NÃO se usa um `NOT EXISTS (linha crua)` genérico porque existe um SEGUNDO
-- caminho de escrita em `budget_entries` que não passa por `budget_uploads_raw` —
-- `POST /api/companies/[companyId]/budget` faz upsert direto de uma planilha já
-- mapeada por conta. Um delete amplo levaria embora o orçamento de toda empresa
-- que usou aquele caminho.
--
-- Alcance medido desta limpeza: 72 linhas cruas + 72 de `budget_entries`, uma
-- empresa, ano 2027. Os 8100/6224 registros de 2026 não são tocados.
DELETE FROM public.budget_entries be
WHERE EXISTS (
  SELECT 1
  FROM public.budget_uploads_raw r
  WHERE r.company_id = be.company_id
    AND r.year = be.year
    AND r.source = 'pessoal'
);

DELETE FROM public.budget_uploads_raw WHERE source = 'pessoal';

-- ── O CHECK novo ───────────────────────────────────────────────────────────
-- Vem DEPOIS do delete, de propósito: `ADD CONSTRAINT` valida as linhas que já
-- existem, e com `'pessoal'` fora da lista ele falharia enquanto aquelas 72
-- linhas estivessem lá.
--
-- `'pessoal'` SAI da lista. O publicador que o escrevia não existe mais, e deixar
-- o valor aceito manteria aberta a porta da contagem dupla — agora é o BANCO que
-- recusa a ressurreição, não só um comentário no CLAUDE.md.
--
-- `'planilha'` fica: é o upload .xlsx, escrito à mão no código, e um erro de
-- digitação ali produziria linha órfã que nenhuma rotina apaga (cada uma deleta
-- só a própria origem antes de reinserir) — ela somaria no Budget para sempre,
-- sem tela por onde achá-la. É para isso que o CHECK serve.
--
-- `LIKE 'orc:%'` em vez de um regex estrito (`^orc:[a-z_]+:[^:]+:[^:]+$`): o
-- `category_code` vem da Omie e nada garante que ele nunca traga um caractere
-- inesperado. No dia em que trouxesse, o regex devolveria 23514 no Finalizar — o
-- mesmo defeito com outra roupa. A source da fatia é gerada por
-- `sourceFinalizacao`, nunca digitada, então o prefixo basta: ele separa o que é
-- gerado do que é escrito à mão, que é a única distinção que o CHECK precisa.
ALTER TABLE public.budget_uploads_raw
  DROP CONSTRAINT IF EXISTS budget_uploads_raw_source_check;

ALTER TABLE public.budget_uploads_raw
  ADD CONSTRAINT budget_uploads_raw_source_check
  CHECK (
    source = 'planilha'
    OR source LIKE 'orc:%'
  );

NOTIFY pgrst, 'reload schema';
