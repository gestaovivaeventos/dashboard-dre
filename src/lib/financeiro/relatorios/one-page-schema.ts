import { z } from "zod";

// ============================================================================
// Schema da resposta da IA para o One Page Report do menu Financeiro > Relatorios.
//
// Esta camada VALIDA o que a IA devolve. Numeros principais, variacoes e
// percentuais ja vieram calculados pelo sistema e foram enviados a IA — ela
// nao recalcula nada. Os campos abaixo sao apenas a leitura executiva.
//
// Caps de tamanho aplicados em todos os campos textuais para garantir que o
// relatorio caiba numa unica pagina, conforme o conceito "One Page".
// ============================================================================

// ─── Enums ─────────────────────────────────────────────────────────────────

export const StatusGeralSchema = z.enum([
  "Excelente",
  "Boa",
  "Atenção",
  "Crítica",
]);

export const ImpactoSchema = z.enum(["Alto", "Médio", "Baixo"]);

export const RiscoSchema = z.enum(["Alto", "Médio", "Baixo"]);

// Feminino: concorda com o substantivo "urgencia".
export const UrgenciaSchema = z.enum(["Alta", "Média", "Baixa"]);

export const ClassificacaoIndicadorSchema = z.enum([
  "Positivo",
  "Neutro",
  "Atenção",
  "Crítico",
]);

// ─── Sub-objetos ───────────────────────────────────────────────────────────

export const DestaqueSchema = z.object({
  titulo: z.string().min(1).max(100),
  descricao: z.string().min(1).max(400),
  impacto: ImpactoSchema,
});

export const PontoAtencaoSchema = z.object({
  titulo: z.string().min(1).max(100),
  descricao: z.string().min(1).max(400),
  risco: RiscoSchema,
});

export const AcaoRecomendadaSchema = z.object({
  acao: z.string().min(1).max(280),
  justificativa: z.string().min(1).max(400),
  impacto: ImpactoSchema,
  urgencia: UrgenciaSchema,
  areaResponsavel: z.string().min(1).max(80),
});

export const LeituraIndicadorSchema = z.object({
  indicador: z.string().min(1).max(80),
  analise: z.string().min(1).max(500),
  classificacao: ClassificacaoIndicadorSchema,
});

// ─── Schema raiz ───────────────────────────────────────────────────────────

export const OnePageReportSchema = z.object({
  statusGeral: StatusGeralSchema,
  notaGeral: z.number().min(0).max(100),
  resumoExecutivo: z.string().min(1).max(800),
  diagnosticoPrincipal: z.string().min(1).max(500),
  destaques: z.array(DestaqueSchema).min(0).max(5),
  pontosAtencao: z.array(PontoAtencaoSchema).min(0).max(5),
  acoesRecomendadas: z.array(AcaoRecomendadaSchema).min(0).max(5),
  // Sem limite minimo de leituras, mas cap em 12 para preservar o formato
  // One Page (mesmo limite usado em outras telas executivas do projeto).
  leituraPorIndicador: z.array(LeituraIndicadorSchema).min(0).max(12),
});

// ─── Tipos TS derivados ────────────────────────────────────────────────────

export type StatusGeral = z.infer<typeof StatusGeralSchema>;
export type Impacto = z.infer<typeof ImpactoSchema>;
export type Risco = z.infer<typeof RiscoSchema>;
export type Urgencia = z.infer<typeof UrgenciaSchema>;
export type ClassificacaoIndicador = z.infer<typeof ClassificacaoIndicadorSchema>;

export type Destaque = z.infer<typeof DestaqueSchema>;
export type PontoAtencao = z.infer<typeof PontoAtencaoSchema>;
export type AcaoRecomendada = z.infer<typeof AcaoRecomendadaSchema>;
export type LeituraIndicador = z.infer<typeof LeituraIndicadorSchema>;

export type OnePageReport = z.infer<typeof OnePageReportSchema>;
