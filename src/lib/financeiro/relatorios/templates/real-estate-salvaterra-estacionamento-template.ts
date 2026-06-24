import { NO_VIVA_CAPABILITIES, type ReportTemplate } from "./report-template-types";

// ============================================================================
// Template Real Estate — Salvaterra Estacionamento (operação ligada a eventos)
// ============================================================================

const SALVATERRA_ESTACIONAMENTO_SYSTEM_CONTEXT = `CONTEXTO DA EMPRESA — Salvaterra Estacionamento:
Representa EXCLUSIVAMENTE a operação do estacionamento do empreendimento. Não paga aluguel nem taxa condominial ao Salvaterra Mall; investimentos e manutenções são custeados pela própria operação; os trabalhadores são freelancers. A receita depende diretamente da realização de EVENTOS no Terrazzo (cobra visitantes conforme o tipo de evento).

Leitura OPERACIONAL — o foco é: os eventos geram receita suficiente para cobrir freelancers, manutenção e investimentos do próprio estacionamento?

O relatório deve responder:
- A operação foi lucrativa no período? A receita por evento cobriu os freelancers?
- Os custos variáveis estão proporcionais à receita? Manutenções/investimentos consumiram o resultado?
- O estacionamento dependeu de poucos eventos ou teve receita recorrente?

INDICADORES:
- Se houver dado operacional de eventos no input, use Resultado por Evento e Receita Média por Evento.
- Se NÃO houver número de eventos, use indicadores financeiros: Receita do Estacionamento, Custos com Freelancers, Manutenções/Investimentos, Resultado e Margem Operacional, além da relação Freelancers / Receita.

REGRAS:
- NÃO use conceitos de Franquias Viva (VVR, FEE disponível, margem de eventos no sentido da Viva, sobrevivência de caixa).
- Se não houver dados operacionais de eventos nem separação clara de freelancers/manutenção no DRE fornecido, analise o resultado agregado e registre que a visão por evento e a quebra de custos dependem de dados/mapeamento a confirmar. NÃO invente valores nem códigos.`;

export const realEstateSalvaterraEstacionamentoTemplate: ReportTemplate = {
  id: "real-estate-salvaterra-estacionamento",
  name: "Real Estate — Salvaterra Estacionamento",
  segment: "real-estate",
  description: "Salvaterra Estacionamento: operação ligada a eventos do Terrazzo (receita x freelancers/manutenção).",
  // Mais específico que o condomínio (ambos contêm "salvaterra"); os matchers
  // são mutuamente exclusivos por "estacion", mas mantemos prioridade maior.
  priority: 110,
  matches: (ctx) =>
    ctx.companyNameLower.includes("salvaterra") &&
    ctx.companyNameLower.includes("estacion"),

  capabilities: { ...NO_VIVA_CAPABILITIES },
  prompt: { kind: "custom", systemContext: SALVATERRA_ESTACIONAMENTO_SYSTEM_CONTEXT },

  expectedKpis: [
    { key: "receita_estacionamento", label: "Receita do Estacionamento", source: "core-receita" },
    { key: "custos_freelancers", label: "Custos com Freelancers", source: "todo" },
    { key: "manutencoes_investimentos", label: "Manutenções / Investimentos", source: "todo" },
    { key: "resultado_estacionamento", label: "Resultado do Estacionamento", source: "core-resultado" },
    { key: "margem_operacional", label: "Margem Operacional", source: "core-margem" },
  ],
  expectedCharts: [
    { key: "receita_x_custos", title: "Receita x Custos Variáveis", note: "TODO" },
    { key: "composicao", title: "Composição do Resultado (Receita (-) Freelancers (-) Manutenção (=) Resultado)" },
    { key: "historico_resultado", title: "Histórico de Resultado" },
    { key: "historico_receita", title: "Histórico de Receita" },
    { key: "freelancers_sobre_receita", title: "Freelancers sobre Receita", note: "TODO" },
    { key: "receita_por_evento", title: "Receita por Evento", note: "TODO: se existir dado operacional de eventos" },
  ],
  semaforoIndicators: ["Resultado do Estacionamento", "Margem Operacional", "Freelancers / Receita"],
  alertHints: [
    "Custo com freelancers acima do padrão.",
    "Mês com baixa receita por poucos eventos.",
    "Manutenção consumindo o resultado.",
    "Resultado negativo mesmo com eventos.",
    "Receita concentrada em poucos dias/eventos.",
  ],
  actionHints: [
    "Acompanhar receita por evento.",
    "Revisar escala de freelancers.",
    "Analisar rentabilidade por tipo de evento.",
    "Separar manutenção recorrente de investimento.",
    "Criar controle de veículos/eventos, se ainda não existir.",
  ],
  dreAccountMapping: {
    receita_estacionamento: { label: "Receita do Estacionamento", byNameIncludes: ["estacionamento", "estacion"], status: "todo" },
    custos_freelancers: { label: "Custos com Freelancers", byNameIncludes: ["freelancer", "diarista", "diária", "diaria"], status: "todo" },
    manutencoes_investimentos: { label: "Manutenções / Investimentos", byNameIncludes: ["manutenção", "manutencao", "investimento"], status: "todo" },
  },
};
