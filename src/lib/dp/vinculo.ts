// ============================================================================
// O vínculo de cada pessoa com a tabela salarial e com o centro de custo:
// AUTOMÁTICO por padrão, com EXCEÇÃO manual por pessoa (pedido do DP na
// reunião de 02/10/2026). Puro e testado — é a regra que a ficha, o
// enquadramento e as simulações usam, para as três telas nunca discordarem.
//
//   linha da tabela  = exceção da pessoa ?? linha do cargo da Sólides (de-para)
//   centro de custo  = exceção da pessoa ?? centro de custo padrão da linha
//
// A origem vai junto do valor: a tela mostra "pela regra do cargo" ou
// "exceção manual", senão ninguém saberia por que uma pessoa foge do padrão.
// ============================================================================

import { grupoContrato } from "@/lib/dp/indicadores";

export type DpOrigemLinha = "excecao" | "cargo";
export type DpOrigemCentro = "excecao" | "linha";

export function resolverLinha(input: {
  excecaoLinhaId: string | null;
  linhaDoCargoId: string | null;
}): { linhaId: string | null; origem: DpOrigemLinha | null } {
  if (input.excecaoLinhaId) return { linhaId: input.excecaoLinhaId, origem: "excecao" };
  if (input.linhaDoCargoId) return { linhaId: input.linhaDoCargoId, origem: "cargo" };
  return { linhaId: null, origem: null };
}

export function resolverCentroCusto(input: {
  excecaoCentroId: string | null;
  centroDaLinhaId: string | null;
}): { centroId: string | null; origem: DpOrigemCentro | null } {
  if (input.excecaoCentroId) return { centroId: input.excecaoCentroId, origem: "excecao" };
  if (input.centroDaLinhaId) return { centroId: input.centroDaLinhaId, origem: "linha" };
  return { centroId: null, origem: null };
}

// ── Experiência ─────────────────────────────────────────────────────────────

export interface DpPeriodoExperiencia {
  numero: 1 | 2;
  /** AAAA-MM-DD */
  fim: string;
}

/** AAAA-MM-DD → milissegundos UTC (dia puro, sem fuso). */
function utc(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function somarDias(iso: string, dias: number): string {
  return new Date(utc(iso) + dias * 86_400_000).toISOString().slice(0, 10);
}

function diasEntre(de: string, ate: string): number {
  return Math.round((utc(ate) - utc(de)) / 86_400_000);
}

/**
 * Os períodos de experiência de um contrato, a partir do que a Sólides traz.
 * Conferido contra os dados em 02/10/2026: `contractExpirationDate` é o fim do
 * 1º período (admissão + 45 em 49 de 55 fichas) e `durationContract` diz o
 * formato ("2 x 45 dias" na maioria dos CLT). O fim da prorrogação é o 1º + o
 * tamanho do período — mesma convenção da Sólides.
 *
 * Só CLT tem experiência: o "90 dias" que a Sólides mostra para sócio e
 * prestador é o padrão do cadastro, não um contrato.
 */
export function periodosExperiencia(input: {
  tipoContrato: string | null;
  admissao: string | null;
  experienciaFim: string | null;
  duracao: string | null;
}): DpPeriodoExperiencia[] {
  if (grupoContrato(input.tipoContrato) !== "clt") return [];
  const m = /(\d+)\s*x\s*(\d+)/i.exec(input.duracao ?? "");
  const vezes = m ? Number(m[1]) : null;
  const tamanho = m ? Number(m[2]) : null;
  const fim1 = input.experienciaFim ?? (input.admissao && tamanho ? somarDias(input.admissao, tamanho) : null);
  if (!fim1) return [];
  const out: DpPeriodoExperiencia[] = [{ numero: 1, fim: fim1 }];
  if (vezes !== null && vezes >= 2 && tamanho) out.push({ numero: 2, fim: somarDias(fim1, tamanho) });
  return out;
}

export interface DpAlertaExperiencia {
  id: string;
  nome: string;
  periodo: 1 | 2;
  fim: string;
  /** 0 = vence hoje. */
  diasRestantes: number;
}

/** Janela do alerta pedida pelo DP: 15 dias antes do vencimento. */
export const JANELA_ALERTA_EXPERIENCIA = 15;

/**
 * Quem tem período de experiência vencendo de hoje até `janela` dias à frente.
 * O 1º período pede decisão de prorrogar ou efetivar; o 2º, de efetivar ou
 * desligar — a tela diz qual dos dois é.
 */
export function alertasExperiencia(
  pessoas: Array<{ id: string; nome: string; ativo: boolean; tipoContrato: string | null; admissao: string | null; experienciaFim: string | null; duracao: string | null }>,
  hoje: string,
  janela = JANELA_ALERTA_EXPERIENCIA,
): DpAlertaExperiencia[] {
  const out: DpAlertaExperiencia[] = [];
  for (const p of pessoas) {
    if (!p.ativo) continue;
    for (const per of periodosExperiencia(p)) {
      const dias = diasEntre(hoje, per.fim);
      if (dias >= 0 && dias <= janela) out.push({ id: p.id, nome: p.nome, periodo: per.numero, fim: per.fim, diasRestantes: dias });
    }
  }
  return out.sort((a, b) => a.diasRestantes - b.diasRestantes || a.nome.localeCompare(b.nome, "pt-BR"));
}
