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
});

export type IndicadorDre = z.infer<typeof IndicadorDreSchema>;
export type FeeVvrInput = z.infer<typeof FeeVvrInputSchema>;
export type OnePageInput = z.infer<typeof OnePageInputSchema>;
