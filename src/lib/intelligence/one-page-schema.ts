import { z } from "zod";

// ============================================================================
// Schema do One Page Report - saida estruturada do motor de analise por IA.
//
// Regras de tamanho aplicadas como guarda contra respostas inflada — o One
// Page precisa caber numa pagina. O motor (ver one-page-analyzer.ts) tambem
// chama a IA com `generateObject` passando este schema, o que ja restringe
// a resposta no provider; a validacao zod aqui e a 2a camada de defesa.
// ============================================================================

export const StatusGeralSchema = z.enum(["verde", "amarelo", "vermelho"]);

export const ImpactoSchema = z.enum(["positivo", "neutro", "negativo"]);

export const SeveridadeSchema = z.enum(["baixa", "media", "alta"]);

export const PrioridadeSchema = z.enum(["p0", "p1", "p2"]);

export const VariacaoSchema = z.enum([
  "acima",
  "abaixo",
  "alinhado",
  "sem_orcamento",
]);

export const DestaqueSchema = z.object({
  indicador: z.string().min(1).max(80),
  leitura: z.string().min(1).max(280),
  impacto: ImpactoSchema,
});

export const PontoAtencaoSchema = z.object({
  indicador: z.string().min(1).max(80),
  descricao: z.string().min(1).max(320),
  severidade: SeveridadeSchema,
});

export const AcaoRecomendadaSchema = z.object({
  acao: z.string().min(1).max(280),
  prioridade: PrioridadeSchema,
  area: z.string().min(1).max(40),
});

export const LeituraIndicadorSchema = z.object({
  codigo: z.string().min(1).max(20),
  nome: z.string().min(1).max(80),
  comentario: z.string().min(1).max(400),
  variacao_versus_orcamento: VariacaoSchema,
});

export const OnePageAnalysisSchema = z.object({
  status_geral: StatusGeralSchema,
  resumo_executivo: z.string().min(1).max(800),
  destaques: z.array(DestaqueSchema).min(0).max(5),
  pontos_atencao: z.array(PontoAtencaoSchema).min(0).max(5),
  acoes_recomendadas: z.array(AcaoRecomendadaSchema).min(0).max(5),
  leitura_por_indicador: z.array(LeituraIndicadorSchema).min(1).max(12),
});

export type StatusGeral = z.infer<typeof StatusGeralSchema>;
export type Impacto = z.infer<typeof ImpactoSchema>;
export type Severidade = z.infer<typeof SeveridadeSchema>;
export type Prioridade = z.infer<typeof PrioridadeSchema>;
export type Variacao = z.infer<typeof VariacaoSchema>;
export type Destaque = z.infer<typeof DestaqueSchema>;
export type PontoAtencao = z.infer<typeof PontoAtencaoSchema>;
export type AcaoRecomendada = z.infer<typeof AcaoRecomendadaSchema>;
export type LeituraIndicador = z.infer<typeof LeituraIndicadorSchema>;
export type OnePageAnalysis = z.infer<typeof OnePageAnalysisSchema>;

// ============================================================================
// Schema do INPUT que o motor recebe (de quem chama). Validar tambem o input
// evita que requisicoes com payload malformado cheguem ate o LLM e gerem
// respostas espurias. Numeros sao opcionais (null) para casos de campo
// nao-aplicavel — ex.: orcamento ausente.
// ============================================================================

export const IndicadorDreSchema = z.object({
  code: z.string().min(1).max(20),
  name: z.string().min(1).max(120),
  realizado: z.number(),
  orcado: z.number().nullable(),
  variacao_absoluta: z.number().nullable(),
  variacao_percentual: z.number().nullable(),
  pct_receita_liquida: z.number().nullable(),
});

export const FeeVvrInputSchema = z.object({
  // `fee_mes` e mantido por compatibilidade — historicamente guardava a
  // soma de VVR META no periodo (rename feito na migration 20260521150000).
  // Novos callers devem preferir `vvr_meta_mes`, que e o nome semanticamente
  // correto. Mantemos ambos por enquanto e podemos remover `fee_mes` quando
  // todos os callers tiverem migrado.
  fee_mes: z.number().nullable(),
  vvr_mes: z.number().nullable(),
  vvr_meta_mes: z.number().nullable().optional(),
});

// Resumo do VVR acumulado no ano (de Janeiro ate o mes filtrado) +
// sinalizador de queda recente. Usado pela IA para aplicar a regra de
// nao sugerir aumentos comerciais quando a franquia ja esta a frente da
// meta acumulada, exceto quando houver deterioracao nos 2 ultimos meses.
export const VvrYtdResumoSchema = z.object({
  realizado_acumulado: z.number(),
  meta_acumulada: z.number(),
  acima_da_meta: z.boolean(),
  // True quando o VVR realizado mensal ficou abaixo da meta em CADA UM
  // dos 2 ultimos meses da serie YTD (mes do periodo + mes anterior).
  // Quando a serie tem menos de 2 pontos com dados, fica false.
  abaixo_meta_ultimos_2_meses: z.boolean(),
});

// Resumo gerencial EXCLUSIVO da Feat Produções (produtora de eventos). Vem da
// tabela company_feat_projetos, acumulado até a data de referência do relatório.
// Só é enviado quando a empresa analisada é a Feat Produções; null/ausente nos
// demais casos. Complementa o DRE — NUNCA substitui os números financeiros.
export const FeatEventosResumoSchema = z.object({
  referencia: z.string().min(1).max(80),
  total_previsto_ate_referencia: z.number(),
  total_realizado_ate_referencia: z.number(),
  resultado_por_tipo: z
    .array(
      z.object({
        tipo: z.string().min(1).max(40),
        previsto: z.number(),
        realizado: z.number(),
      }),
    )
    .max(10),
  eventos_realizados_por_tipo: z
    .array(
      z.object({
        tipo: z.string().min(1).max(40),
        quantidade: z.number(),
      }),
    )
    .max(10),
  eventos_previstos_orcamento: z.number(),
  eventos_realizados_periodo: z.number(),
  eventos_em_aberto: z.number(),
  eventos_previstos_nao_realizados: z.number(),
  eventos_realizados: z.number(),
  // Detalhe dos eventos em aberto (nome + resultado previsto) + projeção
  // gerencial: resultado_acumulado_atual (= realizado) + previsto_em_aberto_total.
  // A projeção NÃO é resultado realizado — depende da conclusão dos fechamentos.
  eventos_em_aberto_detalhe: z
    .array(
      z.object({
        projeto: z.string().min(1).max(200),
        resultado_previsto: z.number(),
      }),
    )
    .max(30),
  previsto_em_aberto_total: z.number(),
  resultado_acumulado_atual: z.number(),
  resultado_acumulado_projetado: z.number(),
  // Resultado acumulado orçado (Acumulado do Ano > Resultado previsto) e o % de
  // atingimento da projeção sobre ele. Null quando não há orçamento acumulado.
  resultado_acumulado_previsto_orcamento: z.number().nullable(),
  percentual_atingimento_projecao: z.number().nullable(),
});

// Comparativo das empresas de uma HOLDING (EXCLUSIVO da Hero Holding). Cada
// item = uma unidade Viva do grupo. A comparação de VVR é feita por % de
// ATINGIMENTO DA META (realizado ÷ meta) — não por VVR absoluto — para permitir
// comparar franquias com metas diferentes de forma justa:
//   - `pct_meta_anual_vvr_acumulada`: % acumulado Jan→mês de referência.
//   - `pct_meta_vvr_mes`: % do mês de referência.
// Os demais indicadores seguem o relatório individual (FEE disponível,
// sobrevivência de caixa em meses, margem média dos eventos %, inadimplência
// atual R$). Valores null quando o dado/meta não existe para a empresa. A IA usa
// este bloco para analisar a Hero Holding como PORTFÓLIO, comparando a
// performance RELATIVA entre as unidades — nunca como franquia individual.
export const HoldingEmpresaIndicadoresSchema = z.object({
  empresa: z.string().min(1).max(120),
  pct_meta_anual_vvr_acumulada: z.number().nullable(),
  pct_meta_vvr_mes: z.number().nullable(),
  // % de FEE disponível = FEE disponível ÷ FEE a receber (não valor absoluto).
  pct_fee_disponivel: z.number().nullable(),
  sobrevivencia_caixa_meses: z.number().nullable(),
  margem_media_eventos: z.number().nullable(),
  inadimplencia_atual: z.number().nullable(),
});

export const HoldingComparativoSchema = z.object({
  referencia: z.string().min(1).max(80),
  empresas: z.array(HoldingEmpresaIndicadoresSchema).min(1).max(20),
});

export const OnePageInputSchema = z.object({
  empresa: z.object({
    id: z.string().uuid(),
    nome: z.string().min(1).max(120),
  }),
  periodo: z.object({
    date_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    date_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().min(1).max(80),
  }),
  dre: z.array(IndicadorDreSchema).min(1).max(30),
  fee_vvr: FeeVvrInputSchema.nullable(),
  // Saldo atual de FEE Disponivel da franquia (snapshot no momento da
  // geracao, nao do periodo). Usado pela IA para calibrar a urgencia do
  // saque e a classificacao de statusGeral — uma franquia com prejuizo
  // mas com FEE Disponivel cobrindo varios meses de despesas nao deve
  // ser tratada como critica. Null quando nao informado.
  fee_disponivel: z.number().nullable().optional(),
  // % de FEE disponível (FEE disponivel ÷ FEE a receber, em pontos percentuais)
  // da propria empresa — leitura de quanto do FEE a receber ja esta disponivel
  // para saque. So enviado para empresas do segmento Franquias Viva; null nos
  // demais. Complementa `fee_disponivel` (absoluto), nao o substitui no input.
  fee_disponivel_pct: z.number().nullable().optional(),
  // Resumo do VVR acumulado YTD (ver VvrYtdResumoSchema acima).
  vvr_ytd_resumo: VvrYtdResumoSchema.nullable().optional(),
  // Sobrevivencia de caixa, em MESES — quantos meses de despesas operacionais
  // o FEE Disponivel atual cobre (KPI do topo do One Page Report). Usado pela
  // IA para calibrar acoes de revisao de despesas quando a cobertura e baixa.
  // Null quando nao foi possivel calcular (sem despesas/FEE de referencia).
  sobrevivencia_caixa_meses: z.number().nullable().optional(),
  // Margem media dos eventos (%) da propria empresa — mesmo valor do card. So
  // enviado para o segmento Franquias Viva; null nos demais.
  margem_media_eventos: z.number().nullable().optional(),
  // Inadimplencia atual (R$) da propria empresa — PASSIVO EM ATRASO da franquia
  // (o que ELA deve e nao pagou), NAO conta a receber de clientes. Mesmo valor
  // do card. So enviado para o segmento Franquias Viva; null nos demais.
  inadimplencia_atual: z.number().nullable().optional(),
  // Segmento/grupo ao qual a empresa pertence. Define QUAL contexto de
  // negocio a IA aplica: quando `slug` === "franquias-viva", o motor usa o
  // system prompt com as regras especificas das Franquias Viva; qualquer
  // outro segmento (ou ausencia) recebe o prompt generico. Cada grupo tera
  // seu proprio contexto — por isso as regras Viva NAO vazam para os demais.
  segmento: z
    .object({
      slug: z.string().min(1).max(60).nullable(),
      nome: z.string().min(1).max(120).nullable(),
    })
    .nullable()
    .optional(),
  // Bloco gerencial de eventos da Feat Produções (ver FeatEventosResumoSchema).
  // Presente APENAS para a Feat Produções; null/ausente para todas as demais.
  feat_eventos: FeatEventosResumoSchema.nullable().optional(),
  // Comparativo das empresas da holding (ver HoldingComparativoSchema).
  // Presente APENAS para a Hero Holding; null/ausente para todas as demais.
  holding_comparativo: HoldingComparativoSchema.nullable().optional(),
});

export type IndicadorDre = z.infer<typeof IndicadorDreSchema>;
export type FeeVvrInput = z.infer<typeof FeeVvrInputSchema>;
export type FeatEventosResumo = z.infer<typeof FeatEventosResumoSchema>;
export type HoldingEmpresaIndicadores = z.infer<typeof HoldingEmpresaIndicadoresSchema>;
export type HoldingComparativo = z.infer<typeof HoldingComparativoSchema>;
export type OnePageInput = z.infer<typeof OnePageInputSchema>;
