import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Feat Produções — produtora de eventos (margem por fechamento)
// ============================================================================
// Produtora de eventos corporativos, shows e licitações. Particularidade: a
// receita entra no resultado via FECHAMENTO do evento (apuração de margem por
// evento). A margem é lançada no DRE no mês em que o evento ocorreu, mas SÓ
// depois que o fechamento é concluído — fechamentos atrasados deixam o
// resultado do mês incompleto. NÃO usa indicadores das Franquias Viva nem
// contexto de outras empresas do grupo (Case Shows, Sirena, Terrazzo).
// ============================================================================

const FEAT_PRODUCOES_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — FEAT PRODUÇÕES (produtora de eventos):
A Feat Produções é uma PRODUTORA DE EVENTOS — realiza eventos corporativos, shows e licitações. Particularidade central do modelo: a receita entra no resultado por meio do FECHAMENTO DO EVENTO, que é a apuração da MARGEM de cada evento. Cada evento tem sua margem apurada individualmente e, somente após a finalização desse fechamento, o resultado é inserido no dashboard DRE como resultado da empresa. O valor da margem é sempre lançado no MÊS EM QUE O EVENTO OCORREU.

IMPLICAÇÃO CRÍTICA PARA A LEITURA: se o fechamento de um evento estiver atrasado, o resultado da empresa naquele mês estará INCOMPLETO — ainda falta entrar a receita/margem do evento pendente de fechamento. Portanto, um resultado abaixo do esperado em determinado mês PODE estar relacionado a eventos ainda não fechados, e NÃO necessariamente a baixa performance operacional.

REGRA DE INTERPRETAÇÃO (anti-conclusão precipitada):
- NÃO afirme que houve "baixa performance operacional" apenas com base no resultado do DRE — o resultado pode estar incompleto por fechamentos pendentes.
- Trate um resultado abaixo do esperado como POSSIVELMENTE afetado por fechamentos pendentes; comunique isso como hipótese/ponto de atenção, sem alarmismo e sem cravar causa.
- O input NÃO informa se há eventos pendentes de fechamento. Logo, você pode RECOMENDAR verificar o status de fechamentos, mas NÃO pode afirmar que existem fechamentos pendentes nem quantos.

Analise a Feat Produções considerando, a partir dos dados do DRE:
- receita/margem reconhecida no dashboard DRE;
- resultado do período;
- despesas operacionais, custos e impostos relacionados à operação;
- possível impacto de eventos realizados ainda sem margem apurada (como hipótese);
- aderência do resultado ao orçamento.

O relatório deve responder principalmente:
- O resultado do período reflete integralmente os eventos realizados, ou pode haver fechamentos pendentes afetando a leitura?
- A margem reconhecida no DRE está compatível com o esperado/orçado?
- O resultado foi pressionado por despesas operacionais, custos ou impostos?
- Há necessidade de acelerar o fechamento de projetos/eventos?

Ações recomendadas devem girar em torno de: acompanhar eventos realizados no período; verificar o status de fechamento dos projetos; identificar eventos com margem ainda não apurada; avaliar o impacto de fechamentos pendentes no resultado do mês; comparar eventos realizados com a margem reconhecida no DRE; monitorar custos, impostos e despesas operacionais; avaliar a qualidade da margem apurada por evento; reforçar o processo de fechamento financeiro dos eventos.

QUADRO DE EVENTOS (campo "feat_eventos" do input — quando presente):
Este bloco é um cadastro GERENCIAL de projetos/eventos da Feat (orçamento de eventos), acumulado ATÉ a data de referência do relatório. NÃO é o DRE — é um complemento que ajuda a explicar o resultado. Campos:
- total_previsto_ate_referencia: soma do RESULTADO PREVISTO (margem orçada) de todos os eventos até a referência.
- total_realizado_ate_referencia: soma do RESULTADO REALIZADO (margem apurada no fechamento) até a referência. Eventos sem fechamento entram como zero.
- resultado_por_tipo: previsto e realizado agrupados por tipo (Corporativo, Show, Licitação).
- eventos_realizados_por_tipo: quantidade de eventos com fechamento "Realizado" por tipo.
- eventos_previstos_orcamento: quantidade de eventos com resultado_previsto maior que zero. Eventos com resultado_previsto igual a zero NÃO estavam previstos em orçamento.
- eventos_realizados_periodo: quantidade de eventos com fechamento "Realizado" ou "Em aberto". "Em aberto" significa que o evento aconteceu, mas o fechamento ainda não foi concluído.
- eventos_em_aberto: eventos que ocorreram mas AINDA NÃO tiveram o fechamento/apuração de margem feito — resultado POTENCIAL ainda não consolidado.
- eventos_previstos_nao_realizados: eventos que estavam no orçamento mas NÃO ocorreram — explicam parte do desvio entre previsto e realizado.
- eventos_realizados: total de eventos já fechados.
- eventos_em_aberto_detalhe: lista dos eventos com fechamento em aberto (nome do projeto + resultado_previsto orçado de cada um).
- previsto_em_aberto_total: soma do resultado previsto dos eventos em aberto.
- resultado_acumulado_atual: Resultado do Exercício ACUMULADO do DRE até a referência (o mesmo número do "Acumulado do Ano > Resultado"). Base já consolidada.
- resultado_acumulado_projetado: PROJEÇÃO GERENCIAL = resultado_acumulado_atual (DRE acumulado) + previsto_em_aberto_total. NÃO é resultado realizado — é uma estimativa que só se confirma após a conclusão dos fechamentos e a apuração das margens.
- resultado_acumulado_previsto_orcamento: Resultado do Exercício acumulado ORÇADO do DRE (Acumulado do Ano > Resultado previsto).
- percentual_atingimento_projecao: quanto a projeção (resultado_acumulado_projetado) representa do orçado acumulado, em % (ex.: 92,2% do orçamento). Pode ser citado para mostrar quão perto a projeção fica da meta orçamentária — sempre lembrando que é projeção, não realizado.

COMO INTERPRETAR (anti-alarmismo, tom executivo e equilibrado):
1. Se total_realizado < total_previsto, NÃO trate a diferença como perda definitiva. Parte dela pode ser margem de "eventos_em_aberto" ainda não consolidada e/ou "eventos_previstos_nao_realizados".
2. Quando "eventos_em_aberto" > 0, sinalize que há eventos com fechamento pendente — parte do resultado ainda pode ser consolidada — e recomende priorizar a tabulação/apuração das margens pendentes. Quando útil, CITE os eventos de "eventos_em_aberto_detalhe" pelo nome e o resultado_previsto de cada um (ex.: "o FESTIVAL DE VERÃO tem resultado previsto de R$ 300.000,00, ainda dependente do fechamento para virar resultado realizado").
3. Ao mencionar a projeção, use "resultado_acumulado_projetado" deixando EXPLÍCITO que é projeção gerencial baseada no orçamento dos eventos em aberto, NÃO resultado consolidado/garantido (ex.: "considerando o previsto dos eventos em aberto, o acumulado poderia alcançar R$ X — leitura gerencial, não resultado realizado").
4. Quando "eventos_previstos_nao_realizados" > 0, explique que esses eventos geram desvio direto entre orçado e realizado, e sugira revisar se houve cancelamento, postergação ou mudança no planejamento comercial.
5. Compare "eventos_previstos_orcamento" com "eventos_realizados_periodo" para explicar eventos realizados sem previsão orçamentária e/ou eventos previstos que não aconteceram. Um evento com resultado_previsto = 0 pode ser realizado, mas NÃO deve ser tratado como evento previsto em orçamento.
6. Diferencie SEMPRE resultado previsto de resultado realizado; nunca trate previsto/projeção como receita já realizada. Reforce a importância de concluir os fechamentos para consolidar o resultado.
7. Analise a distribuição por tipo (volume e resultado): destaque quais tipos de evento mais contribuem para o resultado.
8. Use SOMENTE os números do bloco; não invente eventos nem margens. Ao citar valores, copie-os literalmente.

REGRAS DE NEGÓCIO (Feat Produções):
- Use SOMENTE os dados do DRE enviados no input. NÃO invente números, eventos ou margens.
- Tom executivo, claro, objetivo e equilibrado. Mesmo em cenário negativo, sem alarmismo — aponte pontos de atenção com foco em análise e ação.

NÃO use, NÃO cite e NÃO recomende ações relacionadas a: VVR; FEE disponível; sobrevivência de caixa; carteira de fundos; fundos de formatura; margem média de eventos das Franquias Viva; agenciamento de artistas da Case Shows; locação de salão da Sirena ou do Terrazzo; estacionamento; taxa condominial; franquias; nem projetos de Real Estate. Analise EXCLUSIVAMENTE os dados da Feat Produções — nunca assuma receitas, custos ou contexto de outras empresas do grupo.`;

export const featProducoesTemplate: ReportTemplate = {
  id: "feat-producoes",
  name: "Feat Produções — Produtora de eventos",
  segment: "eventos",
  description:
    "Feat Produções: produtora de eventos; receita reconhecida via fechamento (margem) por evento — resultado sensível a fechamentos pendentes.",
  priority: 100,
  matches: (ctx) => ctx.companyNameLower.includes("feat"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: FEAT_PRODUCOES_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_margem", label: "Receita / Margem reconhecida", source: "core-receita" },
    { key: "despesas", label: "Despesas Operacionais", source: "core-despesas" },
    { key: "resultado", label: "Resultado do Período", source: "core-resultado" },
    { key: "margem", label: "Margem Líquida", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "previsto_realizado", title: "Previsto x Realizado" },
    { key: "acumulado", title: "Acumulado do Ano" },
    { key: "historico", title: "Histórico do Resultado" },
  ],
  semaforoIndicators: ["Receita", "Despesas", "Resultado", "Margem"],
  alertHints: [
    "Resultado do mês abaixo do orçado — avaliar se há fechamentos de eventos pendentes.",
    "Margem reconhecida abaixo do esperado para o período.",
    "Custos, impostos ou despesas operacionais pressionando o resultado.",
    "Possível defasagem entre eventos realizados e margem reconhecida no DRE.",
  ],
  actionHints: [
    "Acompanhar os eventos realizados no período.",
    "Verificar o status de fechamento dos projetos/eventos.",
    "Identificar eventos com margem ainda não apurada.",
    "Avaliar o impacto de fechamentos pendentes no resultado do mês.",
    "Comparar eventos realizados com a margem reconhecida no DRE.",
    "Monitorar custos, impostos e despesas operacionais.",
    "Reforçar o processo de fechamento financeiro dos eventos.",
  ],
  dreAccountMapping: {
    receita_margem: {
      label: "Receita / Margem de Eventos reconhecida",
      byNameIncludes: ["margem", "evento", "fechamento"],
      codes: ["1"],
      status: "confirmed",
      note: "Receita Operacional Bruta (code 1) = margem reconhecida no fechamento.",
    },
    despesas: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado: { label: "Resultado do Exercício", codes: ["11"], status: "confirmed" },
  },

  // Núcleo DRE puro, sem gráfico de VVR (evita buraco visual e indicadores de
  // franquias). KPIs de saúde/caixa da Viva ausentes (capacidades desligadas).
  report: {
    enabledBlocks: [
      "diagnostico",
      "previstoRealizado",
      "semaforo",
      // Quadro exclusivo de eventos da Feat Produções (indicadores + gráficos).
      "featEventos",
      "acumuladoAno",
      "historico",
      "alertas",
      "acoes",
    ],
  },
};
