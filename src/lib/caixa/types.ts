/** Tipos do módulo Caixa. Puro — sem import de servidor. */

/**
 * Tipos de "conta corrente" da Omie (campo `tipo_conta_corrente`). A Omie trata
 * tudo como conta corrente, inclusive cartão de crédito — os rótulos aqui são
 * o que separa dinheiro de dívida na tela.
 *
 * Levantado contra as 272 contas ativas do grupo em 17/09/2026.
 */
export const CAIXA_TIPOS: Record<string, string> = {
  CC: "Conta corrente",
  CX: "Caixa físico",
  CA: "Aplicação",
  CR: "Cartão de crédito",
  CV: "Cartão / garantia",
  PG: "Conta de pagamento",
  AD: "Adiantamento",
};

/**
 * Tipos que são DINHEIRO DISPONÍVEL — o que "Caixa Real" quer dizer.
 *
 * Fora daqui, de propósito:
 *  • CA (aplicação) — é dinheiro do grupo, mas investido, não em conta;
 *  • CR (cartão de crédito) — o saldo é DÍVIDA, e somá-lo subtrairia fatura
 *    do caixa, respondendo outra pergunta (posição líquida, não caixa);
 *  • CV (garantia) — margem bloqueada, indisponível por definição.
 *
 * A tela mostra TODAS as contas e o total é sempre a soma do que está na tela;
 * esta lista é só o filtro que já vem aplicado ao abrir, visível como chip e
 * removível em um clique. O invariante "total = o que você está vendo" é o que
 * mantém a tela honesta — não crie um total que ignore o filtro.
 */
export const CAIXA_TIPOS_LIQUIDOS: readonly string[] = ["CC", "CX", "PG"];

/** Rótulos da coluna Status (espelham `ativo`). Fonte única para tela e padrão salvo. */
export const CAIXA_STATUS_ATIVA = "Ativa";
export const CAIXA_STATUS_INATIVA = "Inativa";

export function statusLabel(ativo: boolean): string {
  return ativo ? CAIXA_STATUS_ATIVA : CAIXA_STATUS_INATIVA;
}

export function tipoLabel(tipo: string | null | undefined): string {
  if (!tipo) return "—";
  return CAIXA_TIPOS[tipo] ?? tipo;
}

/**
 * Código que a Omie usa como "sem banco" — caixa físico, cofre, dinheiro em
 * espécie. Não é um banco de verdade, então a tela não tenta nomeá-lo.
 */
export const OMIE_BANCO_SEM_BANCO = "999";

/** Uma conta corrente com o saldo mais recente, como a tela consome. */
export interface CaixaAccountRow {
  id: string;
  companyId: string;
  companyName: string;
  omieCcId: string;
  descricao: string;
  tipo: string | null;
  bancoCodigo: string | null;
  agencia: string | null;
  conta: string | null;
  ativo: boolean;
  /** null = nunca capturado. */
  saldo: number | null;
  saldoAt: string | null;
  /** Preenchido = o saldo acima está velho; a tela tem que sinalizar. */
  saldoError: string | null;
  /**
   * Saldo de agora menos o último saldo capturado ANTES de hoje (Brasília).
   * null quando não há captura anterior — o que é diferente de zero, e a tela
   * mostra "—" em vez de "sem variação".
   */
  variacaoDia: number | null;
}

/** Resultado de uma varredura (cadastro ou saldos) de uma empresa. */
export interface CaixaCompanyResult {
  companyId: string;
  companyName: string;
  ok: boolean;
  /** Contas criadas/atualizadas (cadastro) ou com saldo novo (saldos). */
  accountsOk: number;
  accountsError: number;
  error: string | null;
}

/** Um ponto da série "Evolução do caixa" (caixa_history / POST /api/caixa/history). */
export interface CaixaHistoryPoint {
  /** 'YYYY-MM-DD' em Brasília. */
  day: string;
  total: number;
  /** Quantas das contas pedidas tinham saldo conhecido nesse dia. */
  contas: number;
}
