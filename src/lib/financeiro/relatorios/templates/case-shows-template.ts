import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Case Shows — agenciamento / intermediação de shows
// ============================================================================
// Empresa de AGENCIAMENTO de artistas: intermedia a contratação de artistas
// para eventos e sua receita depende principalmente do BV apurado no
// fechamento dos contratos. NÃO usa nenhum indicador das Franquias Viva
// (VVR, FEE, sobrevivência de caixa, fundos, margem média de eventos) nem
// contexto de outras empresas do grupo (Feat Produções, Sirena, Terrazzo).
// Camada de templates: capacidades Viva desligadas + prompt próprio + blocos
// genéricos de DRE (sem o gráfico de VVR, para não deixar buraco visual).
// ============================================================================

const CASE_SHOWS_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — CASE SHOWS (agenciamento de shows):
A Case Shows é uma empresa de AGENCIAMENTO de shows. Ela atua intermediando a contratação de artistas para eventos. A receita depende PRINCIPALMENTE do BV recebido no fechamento dos contratos — quanto mais contratos intermediados e quanto maior o valor dos contratos fechados, maior tende a ser a receita de BV apurada.

A geração de receita está diretamente ligada a: volume de contratos intermediados, valor dos contratos fechados e BV apurado no período.

Analise a Case Shows considerando, SEMPRE a partir dos dados do DRE enviados no input:
- receita gerada por intermediação/agenciamento (receita de BV);
- evolução da receita de BV ao longo do período;
- eficiência comercial dos fechamentos;
- relação entre entradas e saídas ligadas à operação de agenciamento;
- despesas operacionais e comerciais;
- resultado operacional;
- margem líquida, quando disponível;
- concentração ou oscilação de receitas conforme os contratos fechados no período.

O relatório deve responder principalmente:
- A empresa gerou receita suficiente com BV no período?
- A receita ficou acima ou abaixo do orçamento?
- O resultado foi impactado por queda de contratos fechados ou por aumento de despesas?
- As despesas operacionais estão proporcionais ao volume de receita gerado?
- O resultado indica eficiência comercial ou pressão operacional?

Ações recomendadas devem girar em torno de: acompanhar o volume de contratos fechados; monitorar a previsibilidade dos BVs a receber; conciliar contratos fechados com receitas efetivamente reconhecidas; avaliar a eficiência comercial do agenciamento; monitorar despesas operacionais em relação à receita de BV; melhorar a previsibilidade das entradas relacionadas aos contratos em negociação.

REGRAS DE NEGÓCIO (Case Shows):
- Use SOMENTE os dados do DRE enviados no input. NÃO invente números, contratos ou BVs que não estejam no input.
- Quando um dado operacional (ex.: quantidade de contratos, BV por contrato) NÃO estiver no input, você pode RECOMENDAR acompanhá-lo, mas NUNCA afirme que ele ocorreu ou variou. Ex.: pode dizer "vale acompanhar o volume de contratos fechados"; não pode dizer "o volume de contratos caiu" se esse dado não foi enviado.
- Tom executivo, claro e objetivo, conectado ao agenciamento. Mesmo em cenário negativo, aponte pontos de atenção com foco em análise e ação — sem alarmismo.

CALIBRAÇÃO DE ALERTAS E AÇÕES (Case Shows) — LEIA O CENÁRIO ANTES DE ESCREVER:
Antes de montar "pontosAtencao" e "acoesRecomendadas", verifique o SINAL dos indicadores estruturais (Receita, Resultado, Margem, Despesas). O texto deve ESPELHAR o cenário — não invente dificuldade onde os números são bons.

- CENÁRIO FAVORÁVEL (Receita ACIMA do orçado E Resultado ACIMA do orçado E Despesas ABAIXO ou dentro do orçado): a leitura é POSITIVA. Nesse caso "pontosAtencao" deve ficar VAZIO ou conter, no máximo, um ponto REALMENTE desfavorável e material. É PROIBIDO fabricar alerta de "Atenção" a partir de qualquer variação favorável só para preencher a lista. Se não houver variação desfavorável material, deixe "pontosAtencao" vazio e concentre a análise em "destaques". O statusGeral aqui é "Boa" ou "Excelente", nunca "Atenção" só porque existe algo a monitorar.

- LINHA DE RECEITA ACIMA DO ORÇADO = FAVORÁVEL (inclui "Outras Receitas", "Receita de BV", "Receitas Financeiras" e qualquer linha de receita). Receita acima do orçamento é RESULTADO BOM → vai em "destaques", NUNCA em "pontosAtencao". É PROIBIDO transformar uma receita acima do orçado em ponto de atenção ou dizer que "merece acompanhamento" só porque ela representa uma fração pequena da receita total — participação pequena NÃO é problema; superar o orçamento é bom independentemente do tamanho da linha.

- DEDUÇÕES / CUSTOS / DESPESAS ABAIXO DO ORÇADO = FAVORÁVEL. Confira o sinal antes de escrever: se o realizado é MENOR que o orçado, a linha ficou ABAIXO do orçamento (a empresa deduziu/gastou menos) — isso é bom. É PROIBIDO descrever uma dedução/despesa abaixo do orçado como "acima do orçamento", "elevada" ou "pode impactar a receita líquida no futuro", e é PROIBIDO colocá-la em "pontosAtencao". Se for relevante, vá em "destaques" com título positivo.

- AÇÕES RECOMENDADAS PROPORCIONAIS AO CENÁRIO: calibre "impacto" e "urgencia" pela realidade dos números. Em cenário favorável, as ações têm tom de SUSTENTAÇÃO/OTIMIZAÇÃO (acompanhar, consolidar, aproveitar o bom momento) com urgência "Média" ou "Baixa" — NÃO marque "Urgência: Alta" em todas as ações quando o resultado está muito acima do orçado, pois isso soa como gestão de crise e contradiz o desempenho. Reserve "Alta" para ações ligadas a uma variação REALMENTE desfavorável e material observada no input.

NÃO use, NÃO cite e NÃO recomende ações relacionadas a: VVR; FEE disponível; sobrevivência de caixa; carteira de fundos; fundos de formatura; margem média de eventos das Franquias Viva; locação de espaços/salão; fechamento de margem de eventos da Feat Produções; taxa condominial; estacionamento; franquias; nem projetos de Real Estate. Esses conceitos pertencem a OUTRAS empresas/segmentos e não fazem sentido para a Case Shows. Analise EXCLUSIVAMENTE os dados da Case Shows — nunca misture dados ou contexto de outras empresas do grupo.`;

export const caseShowsTemplate: ReportTemplate = {
  id: "case-shows",
  name: "Case Shows — Agenciamento de shows",
  segment: "eventos",
  description:
    "Case Shows: agenciamento/intermediação de shows; receita orientada ao BV apurado no fechamento dos contratos.",
  priority: 100,
  matches: (ctx) => ctx.companyNameLower.includes("case shows"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: CASE_SHOWS_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_bv", label: "Receita de BV", source: "core-receita" },
    { key: "despesas", label: "Despesas Operacionais", source: "core-despesas" },
    { key: "resultado", label: "Resultado Operacional", source: "core-resultado" },
    { key: "margem", label: "Margem Líquida", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "previsto_realizado", title: "Previsto x Realizado" },
    { key: "acumulado", title: "Acumulado do Ano" },
    { key: "historico", title: "Histórico do Resultado" },
  ],
  semaforoIndicators: ["Receita", "Despesas", "Resultado", "Margem"],
  alertHints: [
    "Receita de BV abaixo do orçamento.",
    "Queda no volume de contratos fechados pressionando a receita.",
    "Despesas operacionais crescendo acima da receita de BV.",
    "Oscilação relevante de receita por concentração de contratos no período.",
    "Resultado operacional pressionado por despesas comerciais.",
  ],
  actionHints: [
    "Acompanhar o volume de contratos fechados no período.",
    "Monitorar a previsibilidade dos BVs a receber.",
    "Conciliar contratos fechados com receitas efetivamente reconhecidas.",
    "Avaliar a eficiência comercial da operação de agenciamento.",
    "Monitorar despesas operacionais em relação à receita de BV.",
    "Melhorar a previsibilidade das entradas dos contratos em negociação.",
  ],
  dreAccountMapping: {
    receita_bv: {
      label: "Receita de BV / Agenciamento",
      byNameIncludes: ["bv", "agenciamento", "intermedia", "comiss"],
      codes: ["1"],
      status: "confirmed",
      note: "Receita Operacional Bruta (code 1) = receita de BV apurada.",
    },
    despesas: { label: "Despesas Operacionais", codes: ["7"], status: "confirmed" },
    resultado: { label: "Resultado do Exercício", codes: ["11"], status: "confirmed" },
  },

  // Núcleo DRE puro, SEM o gráfico de VVR — evita buraco visual e indicadores
  // de franquias. Mantém diagnóstico, tabela, acumulado, histórico, alertas e
  // ações. KPIs de saúde/caixa da Viva ficam ausentes (capacidades desligadas).
  report: {
    enabledBlocks: [
      "diagnostico",
      "previstoRealizado",
      "semaforo",
      // Saldo final da Custódia de Artistas (caixa + competência) — quadro
      // exclusivo da Case Shows, logo após a tabela de desempenho/semáforo.
      "custodyClosing",
      "acumuladoAno",
      "historico",
      "alertas",
      "acoes",
    ],
  },
};
