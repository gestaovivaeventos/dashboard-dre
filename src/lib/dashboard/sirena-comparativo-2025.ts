// ============================================================================
// DADOS DE 2025 DA SIRENA — coluna "Ano Anterior" da tela COMPARATIVOS ANUAIS
// ============================================================================
//
// A Sirena é composta da Omie da Feat (department routing) e só tem dados
// confiáveis a partir de 2026 (ver company-period-limits.ts). Os lançamentos
// de 2025 na Omie estão INCOMPLETOS (houve movimentação externa à Omie que
// nunca foi lançada), então NÃO servem para a comparação ano-a-ano.
//
// O gestor forneceu o resultado FECHADO de 2025 (planilha "Resultados SIRENA
// 2025"), mês a mês, por linha. Este módulo guarda esses valores e os injeta
// APENAS na coluna "Ano Anterior" da tela Comparativos Anuais — em nenhuma
// outra tela. Como a fonte é este módulo (e não a Omie / dashboard_dre_aggregate
// / manual_account_values), o dado 2025 NUNCA vaza para Dashboard, Fluxo,
// Budget/Forecast, relatórios etc.
//
// COMO É USADO: `comparativos-anuais/page.tsx`, quando a ÚNICA empresa é a
// Sirena e o ano anterior é 2025, troca a agregação Omie do prior period por
// `buildSirenaComparativo2025Amounts` e passa o mapa a `buildDashboardRows` —
// exatamente o mesmo pipeline do realizado. Assim os totalizadores (Receita
// Líquida, Lucro, Resultado) e os sinais são COMPUTADOS pela engine, iguais às
// demais colunas.
//
// FORMATO: `code -> 12 valores mensais (Jan..Dez), magnitude POSITIVA`. Só as
// contas ANALÍTICAS (folha) e as summary sem filhos (IRPJ=9, Contrib. Social=10)
// entram aqui; os grupos e as linhas `calculado` (Receita Líquida=4, Despesas
// Diretas=5, Lucro=6/8, Resultado=11) são recompostos pela engine a partir
// destes. 2025 é um ano fechado — estes números não mudam.

import type { DreAccountBase } from "@/lib/dashboard/dre";

// Ano que este módulo cobre. O piso só se aplica quando o "ano anterior" é 2025.
export const SIRENA_COMPARATIVO_PRIOR_YEAR = 2025;

// code -> [Jan..Dez] em magnitude positiva. Fonte: planilha Resultados SIRENA 2025.
const VALUES_BY_CODE: Record<string, number[]> = {
  // 1. Receitas Diretas (folhas)
  "1.1": [6000, 18100, 20500, 20000, 36000, 15000, 31000, 18300, 5500, 5500, 4000, 4000], // Locação de Espaço
  "1.2": [6390, 5040, 1440, 5340, 360, 0, 0, 0, 0, 0, 0, 0], // Receita de Estacionamento
  "1.3": [1, 0, 4, 4, 0, 0, 0, 1359, 22, 315, 1, 0], // Receitas Não Operacionais
  // 3. Deduções de Receita (folhas)
  "3.1": [0, 0, 300, 0, 0, 332, 234, 0, 450, 0, 0, 0], // ISS
  "3.2": [0, 0, 0, 0, 109, 0, 70, 153, 177, 33, 33, 26], // PIS
  "3.3": [0, 0, 0, 0, 480, 1534, 321, 705, 819, 150, 150, 120], // COFINS
  "3.4": [0, 0, 0, 0, 0, 0, 6400, 0, 0, 0, 0, 0], // Devoluções de Locações e/ou Serviços Prestados
  // 5. Despesas Diretas (folhas)
  "5.1": [0, 1773, 641, 875, 854, 1855, 900, 1450, 915, 275, 0, 200], // Comissão Comercial
  "5.2": [425, 0, 0, 0, 0, 0, 0, 0, 160, 0, 109, 0], // Compra de Serviços
  "5.3": [1361, 0, 0, 759, 0, 0, 0, 0, 0, 3378, 750, 0], // Custo com Material de Limpeza e Descartáveis
  "5.4": [575, 575, 575, 575, 575, 130, 575, 575, 575, 575, 575, 575], // Despesa com Remoção de Resíduos
  "5.5": [1040, 1850, 260, 1738, 400, 80, 240, 320, 790, 200, 200, 3560], // Mão de obra - Freelancer
  // 7.1 Vendas e Marketing
  "7.1.1": [0, 0, 0, 3000, 1500, 4500, 2500, 2700, 0, 0, 0, 0], // Marketing
  // 7.2 Pessoal
  "7.2.1": [1445, 1292, 1296, 1629, 1296, 923, 1514, 1630, 1629, 1629, 1679, 1433], // Salários
  "7.2.2": [0, 0, 0, 0, 1088, 0, 0, 0, 0, 0, 0, 1088], // Férias
  "7.2.4": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 746], // 13º Salário
  "7.2.5": [141, 137, 137, 136, 137, 136, 223, 136, 195, 228, 248, 390], // INSS
  "7.2.6": [143, 141, 141, 141, 141, 81, 165, 141, 290, 340, 295, 377], // FGTS
  "7.2.7": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 3], // IRRF
  "7.2.11": [250, 904, 250, 250, 345, 250, 250, 250, 250, 250, 409, 150], // Benefícios Flexíveis
  "7.2.13": [392, 707, 476, 542, 609, 547, 295, 631, 533, 519, 561, 505], // Outros Benefícios
  "7.2.14": [268, 0, 0, 0, 3486, 0, 0, 0, 0, 1000, 0, 0], // Endomarketing
  // 7.3 Administrativas
  "7.3.1": [8680, 6810, 7180, 2770, 7560, 0, 0, 2320, 4040, 2840, 1570, 4120], // Aluguel
  "7.3.4": [248, 308, 379, 177, 372, 575, 121, 38, 86, 229, 73, 410], // Energia
  "7.3.5": [235, 235, 235, 235, 235, 235, 235, 235, 235, 235, 235, 242], // Telefonia
  "7.3.6": [1626, 565, 7892, 4865, 3064, 1500, 11215, 4789, 4690, 2620, 925, 1515], // Manutenção de Imobilizado
  "7.3.11": [405, 405, 424, 424, 424, 424, 424, 424, 424, 424, 424, 424], // Segurança
  "7.3.15": [1518, 1518, 1518, 1518, 1518, 1518, 1518, 1518, 1518, 1518, 1518, 3036], // Assessoria Administrativa
  "7.3.17": [270, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 306], // Material Limpeza / Escritório / Mercado / Padaria
  "7.3.18": [758, 1098, 718, 718, 718, 718, 718, 718, 1618, 718, 718, 4518], // Outras Despesas Administrativas
  "7.3.19": [0, 0, 0, 0, 0, 0, 21, 0, 0, 76, 30, 0], // Softwares
  "7.3.20": [0, 0, 0, 0, 0, 0, 60, 0, 0, 0, 0, 0], // Fretes
  // 7.4 Financeiras
  "7.4.3": [0, 0, 0, 0, 0, 0, 0, 0, 197, 19, 0, 0], // Tarifas Bancárias
  // 7.6 Investimento
  "7.6.4": [0, 0, 0, 0, 5284, 0, 0, 491, 0, 0, 0, 0], // Móveis e Utensílios
  // 9 / 10 (summary sem filhos — recebem valor direto)
  "9": [0, 0, 0, 0, 0, 0, 0, 0, 0, 3534, 0, 0], // IRPJ
  "10": [0, 0, 0, 0, 0, 0, 0, 0, 0, 1530, 0, 0], // Contribuição Social
};

/**
 * Monta o mapa `scopedId -> valor` do resultado de 2025 da Sirena para o
 * intervalo de meses [monthFrom..monthTo] (1..12), resolvendo cada code para o
 * id da conta no plano escopado. O resultado é passado a `buildDashboardRows`
 * como se fosse o realizado — os totalizadores são computados pela engine.
 *
 * No-op seguro (mapa vazio) se o plano não for o da Sirena (nenhum code casa).
 */
export function buildSirenaComparativo2025Amounts(
  scopedAccounts: DreAccountBase[],
  monthFrom: number,
  monthTo: number,
): Map<string, number> {
  const idByCode = new Map(scopedAccounts.map((a) => [a.code, a.id]));
  const amounts = new Map<string, number>();
  const from = Math.max(1, Math.min(12, monthFrom));
  const to = Math.max(1, Math.min(12, monthTo));
  for (const [code, months] of Object.entries(VALUES_BY_CODE)) {
    const id = idByCode.get(code);
    if (!id) continue;
    let sum = 0;
    for (let m = from; m <= to; m += 1) sum += months[m - 1] ?? 0;
    if (sum !== 0) amounts.set(id, sum);
  }
  return amounts;
}
