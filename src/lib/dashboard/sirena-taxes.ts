// ============================================================================
// IMPOSTOS CALCULADOS DA SIRENA (camada de cálculo, separada de Omie/planilha)
// ============================================================================
//
// A Sirena calcula 5 linhas de imposto DIRETAMENTE no dashboard DRE, a partir
// dos valores mensais já exibidos em duas linhas de receita:
//   • "Receita de Estacionamento" — vem da Omie (regime de caixa/mapeamento),
//     regra existente e INALTERADA.
//   • "Locação de Espaço" — vem da planilha Google Sheets (sirena-sync.ts).
//
// Fórmulas (mês a mês):
//   ISS                  = Estacionamento                * 5%
//   PIS                  = (Estacionamento + Locação)    * 0,65%
//   COFINS               = (Estacionamento + Locação)    * 3%
//   IRPJ                 = (Estacionamento + Locação)    * 32% * 15%
//   Contribuição Social  = (Estacionamento + Locação)    * 32% * 9%
//
// SINAL: as linhas de imposto são deduções/despesa, armazenadas como MAGNITUDE
// POSITIVA — as fórmulas do DRE as SUBTRAEM (ex.: "Receita Líquida" = `1+2-3`,
// onde "3 Deduções de Receita" soma ISS/PIS/COFINS). Por isso injetamos os
// valores positivos do exemplo (ISS=500, PIS=390, ...).
//
// COMO É APLICADO: este módulo é chamado DENTRO de `aggregateDreRows`
// (dre.ts), via o hook opcional `postProcessAmounts`, DEPOIS de montar o mapa de
// `amounts` (Omie + planilha + ajustes) e ANTES de `buildDashboardRows`. Assim
// as linhas calculadas/totalizadoras (Receita Líquida, Resultado do Exercício)
// já incorporam os impostos automaticamente, sem mudar a engine de fórmulas.
//
// ISOLAMENTO: só roda para a Sirena (o chamador — dashboard/page.tsx — só passa
// o hook quando a ÚNICA empresa selecionada é a Sirena). Resolve as contas por
// NOME no plano custom da própria Sirena; se as contas-base não existirem, faz
// no-op (nunca quebra o dashboard, nunca toca outra empresa). NÃO grava nada no
// banco, NÃO altera Omie, mapeamento, planilha nem a Receita de Estacionamento.

import type { DreAccountBase } from "@/lib/dashboard/dre";

export const SIRENA_COMPANY_NAME = "Sirena";

// Alíquotas. IRPJ/CS aplicam a presunção de 32% sobre a base e depois a alíquota.
const ISS_RATE = 0.05;
const PIS_RATE = 0.0065;
const COFINS_RATE = 0.03;
const IRPJ_PRESUNCAO = 0.32;
const IRPJ_RATE = 0.15;
const CSLL_PRESUNCAO = 0.32;
const CSLL_RATE = 0.09;

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Nomes aceitos (normalizados) para cada linha do plano da Sirena. Listas para
// tolerar pequenas variações de cadastro sem quebrar a regra.
const ESTACIONAMENTO_NAMES = ["receita de estacionamento"];
const LOCACAO_NAMES = ["locacao de espaco"];
const ISS_NAMES = ["iss"];
const PIS_NAMES = ["pis"];
const COFINS_NAMES = ["cofins"];
const IRPJ_NAMES = ["irpj"];
const CSLL_NAMES = ["contribuicao social", "csll", "contribuicao social sobre o lucro"];

function findAccountIdByNames(
  accounts: DreAccountBase[],
  acceptedNormalizedNames: string[],
): string | null {
  const matches = accounts.filter((a) =>
    acceptedNormalizedNames.includes(normalizeName(a.name)),
  );
  // Exige match único para não escolher a conta errada por ambiguidade.
  if (matches.length === 1) return matches[0].id;
  return null;
}

/**
 * Calcula os 5 impostos da Sirena para o período e os ESCREVE (overwrite) no
 * mapa `amountsByScopedId`, de modo que `buildDashboardRows` use exatamente o
 * valor calculado (sem somar Omie/planilha indevidamente).
 *
 * Mutação in-place. No-op seguro se as contas-base (Estacionamento/Locação) não
 * existirem no plano escopado — assim o hook é inofensivo caso seja chamado para
 * um escopo que não é o plano custom da Sirena (ex.: plano global no
 * consolidado multi-empresa).
 */
export function applySirenaCalculatedTaxes(
  scopedAccounts: DreAccountBase[],
  amountsByScopedId: Map<string, number>,
): void {
  const estacId = findAccountIdByNames(scopedAccounts, ESTACIONAMENTO_NAMES);
  const locacaoId = findAccountIdByNames(scopedAccounts, LOCACAO_NAMES);

  // Sem as duas linhas-base não há o que calcular (escopo não é o da Sirena, ou
  // estrutura DRE incompleta). No-op seguro.
  if (!estacId && !locacaoId) return;

  const estacionamento = estacId ? amountsByScopedId.get(estacId) ?? 0 : 0;
  const locacao = locacaoId ? amountsByScopedId.get(locacaoId) ?? 0 : 0;
  const base = estacionamento + locacao;

  const taxes: Array<{ id: string | null; value: number }> = [
    { id: findAccountIdByNames(scopedAccounts, ISS_NAMES), value: estacionamento * ISS_RATE },
    { id: findAccountIdByNames(scopedAccounts, PIS_NAMES), value: base * PIS_RATE },
    { id: findAccountIdByNames(scopedAccounts, COFINS_NAMES), value: base * COFINS_RATE },
    { id: findAccountIdByNames(scopedAccounts, IRPJ_NAMES), value: base * IRPJ_PRESUNCAO * IRPJ_RATE },
    { id: findAccountIdByNames(scopedAccounts, CSLL_NAMES), value: base * CSLL_PRESUNCAO * CSLL_RATE },
  ];

  for (const tax of taxes) {
    if (!tax.id) continue; // linha de imposto não encontrada → não força nada
    // Overwrite: a linha de imposto passa a exibir SOMENTE o valor calculado.
    amountsByScopedId.set(tax.id, tax.value);
  }
}
