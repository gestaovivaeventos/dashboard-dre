import type { DreGerencialInputRow } from "@/lib/pdf/dre-gerencial";

// Dados de exemplo do layout aprovado (docs/modelo DRE Gerencial.dc.html):
// unidade Village, Jan a Jun/2026. Usados pela rota de preview visual
// /api/dev/dre-pdf-preview para conferência do template.

type LeafSpec = [string, number, number, number, number, number, number];

const SAMPLE: Record<string, { name: string; leaves: LeafSpec[] }> = {
  "1": {
    name: "Receitas Diretas",
    leaves: [
      ["Clientes - Serviços Prestados", 77268.12, 85441.61, 68363.44, 28420.97, 18392.5, 114737.0],
      ["Clientes - Receita com Serviços Vendidos", 103357.15, 218411.71, 38381.43, 67807.2, 65321.19, 71831.41],
      ["Clientes - Venda de unidades", 0, 0, 0, 0, 0, 0],
    ],
  },
  "2": {
    name: "Receitas Indiretas",
    leaves: [
      ["Rendimentos de Aplicações", 0, 4.37, 0.47, 0.45, 0.45, 0.45],
      ["Reembolso de Despesas", 0, 0, 0, 0, 0, 0],
      ["Seguros", 0, 0, 0, 0, 0, 0],
    ],
  },
  "3": {
    name: "Deduções da Receita",
    leaves: [
      ["ISS", 5452.4, 8022.65, 7213.82, 2133.91, 2877.25, 3960.63],
      ["COFINS", 5452.41, 8022.64, 7213.83, 2133.92, 4437.25, 3960.63],
      ["PIS", 1181.35, 1738.24, 1563.0, 462.35, 961.4, 858.14],
      ["Retenções Federais", 13.02, 13.02, 23.66, 0, 11.39, 21.53],
      ["Devoluções de Vendas", 0, 0, 0, 0, 0, 0],
    ],
  },
  "5": {
    name: "Despesas Diretas",
    leaves: [
      ["Custos de Serviços e Produtos de Contratos Vendidos", 145751.46, 67755.86, 81590.22, 87455.08, 74808.42, 103157.85],
    ],
  },
  "7.1": {
    name: "Despesas Administrativas",
    leaves: [
      ["Aluguel", 0, 0, 0, 0, 0, 0],
      ["Condomínio", 0, 0, 0, 0, 0, 0],
      ["Água e Esgoto", 0, 0, 0, 0, 0, 0],
      ["Energia Elétrica", 0, 0, 0, 0, 0, 0],
      ["Telefonia", 25.0, 330.0, 195.0, 195.0, 195.0, 265.0],
      ["Manutenção de Imobilizado", 0, 0, 0, 0, 0, 0],
      ["Seguros", 0, 0, 0, 0, 0, 0],
      ["IPTU", 0, 0, 0, 0, 0, 0],
      ["Contabilidade", 2593.0, 1168.0, 1168.0, 2718.0, 1168.0, 1168.0],
      ["Advogados", 0, 0, 750.0, 750.0, 750.0, 750.0],
      ["Segurança", 0, 0, 0, 0, 0, 0],
      ["Outras Despesas Administrativas", 0, 0, 108.39, 455.66, 0, 1621.0],
      ["Softwares, Sistemas e Servidores", 946.7, 766.7, 779.72, 2728.1, 2728.1, 3558.0],
      ["Material Limpeza / Escritório / Mercado / Padaria", 0, 0, 0, 0, 0, 0],
      ["Fretes e Transportes em Geral", 201.59, 57.01, 0, 407.19, 279.92, 395.0],
      ["Assessoria Administrativa", 3242.0, 3242.0, 3242.0, 3242.0, 3242.0, 3242.0],
      ["Taxas Diversas", 2364.68, 170.41, 14.06, 972.27, 285.59, 0],
    ],
  },
  "7.2": {
    name: "Despesas com Pessoal",
    leaves: [
      ["Salários", 2245.19, 2245.19, 2334.17, 2314.17, 2334.17, 2374.0],
      ["Férias", 0, 0, 0, 0, 0, 0],
      ["Rescisões", 0, 0, 0, 3786.0, 8031.87, 0],
      ["13º Salário", 0, 0, 0, 0, 0, 0],
      ["INSS", 0, 0, 0, 0, 0, 0],
      ["FGTS", 0, 0, 0, 0, 0, 0],
      ["IRRF Sobre Folha", 0, 0, 0, 0, 0, 0],
      ["Pensão Alimentícia", 0, 0, 0, 0, 0, 0],
      ["Assistência Médica", 0, 0, 0, 0, 0, 0],
      ["Vale Transporte / Mobilidade", 0, 0, 0, 0, 0, 0],
      ["Benefícios Flexíveis", 0, 0, 0, 0, 0, 0],
      ["Seguro de Vida", 293.58, 0, 587.72, 294.14, 294.14, 0],
      ["Outros Benefícios", 0, 0, 0, 0, 0, 0],
      ["Pró Labore Sócios", 0, 0, 0, 0, 0, 0],
      ["Outros (Contribuição Sindical - PCMO, Exames...)", 197.99, 280.63, 197.99, 197.99, 531.85, 594.0],
      ["Capacitação e Treinamentos", 0, 0, 0, 0, 0, 0],
      ["Endomarketing", 3965.82, 0, 500.0, 279.89, 0, 0],
      ["Salários PJ", 4620.25, 4620.25, 4705.37, 4705.37, 4705.37, 4705.0],
    ],
  },
  "7.3": {
    name: "Despesas de Vendas e Marketing",
    leaves: [
      ["Comissões", 0, 0, 0, 0, 0, 0],
      ["Marketing", 4018.0, 2500.0, 2500.0, 5036.0, 1300.0, 5025.0],
      ["Despesa de Captação de Clientes", 165.0, 0, 5495.0, 5165.0, 5000.0, 165.0],
      ["Despesas de Viagens", 0, 0, 0, 0, 0, 0],
      ["Bonificações", 0, 0, 0, 0, 0, 0],
    ],
  },
  "7.4": {
    name: "Despesas Financeiras / Bancos",
    leaves: [
      ["Juros sobre Empréstimos", 0, 0, 0, 0, 0, 0],
      ["Multas", 0, 0, 0, 0, 0, 0],
      ["Tarifas Bancárias", 138.89, 133.9, 136.4, 139.4, 206.0, 150.0],
      ["IOF s/ Aplicação Financeira", 0, 0, 0, 0, 0, 0],
      ["IR s/ Aplicação Financeira", 0, 0, 0, 0, 0, 0],
    ],
  },
};

export const MESES = ["Jan/26", "Fev/26", "Mar/26", "Abr/26", "Mai/26", "Jun/26"].map(
  (label, index) => ({ key: `m${index}`, label }),
);

export function buildSampleRows(): { rows: DreGerencialInputRow[]; formulas: Record<string, string> } {
  const rows: DreGerencialInputRow[] = [];
  const formulas: Record<string, string> = {};
  let order = 0;

  const vals = (v: number[]): Record<string, number> =>
    Object.fromEntries(MESES.map((mes, i) => [mes.key, v[i] ?? 0]));
  const zero = vals([]);

  const addCalc = (code: string, name: string, formula: string) => {
    rows.push({
      id: `acc-${code}`,
      code,
      name,
      parent_id: null,
      level: 1,
      type: "calculado",
      is_summary: true,
      sort_order: order++,
      valuesByBucket: zero,
    });
    formulas[`acc-${code}`] = formula;
  };

  const addBlock = (code: string, parentCode: string | null, tipo: "receita" | "despesa") => {
    const spec = SAMPLE[code];
    rows.push({
      id: `acc-${code}`,
      code,
      name: spec.name,
      parent_id: parentCode ? `acc-${parentCode}` : null,
      level: parentCode ? 2 : 1,
      type: tipo,
      is_summary: true,
      sort_order: order++,
      valuesByBucket: zero,
    });
    spec.leaves.forEach(([name, ...v], index) => {
      rows.push({
        id: `acc-${code}.${index + 1}`,
        code: `${code}.${index + 1}`,
        name,
        parent_id: `acc-${code}`,
        level: parentCode ? 3 : 2,
        type: tipo,
        is_summary: false,
        sort_order: order++,
        valuesByBucket: vals(v),
      });
    });
  };

  addBlock("1", null, "receita");
  addBlock("2", null, "receita");
  addBlock("3", null, "despesa");
  addCalc("4", "Receita Operacional Líquida", "1+2-3");
  addBlock("5", null, "despesa");
  addCalc("6", "Lucro Operacional Bruto", "4-5");
  rows.push({
    id: "acc-7",
    code: "7",
    name: "Despesas Operacionais",
    parent_id: null,
    level: 1,
    type: "despesa",
    is_summary: true,
    sort_order: order++,
    valuesByBucket: zero,
  });
  addBlock("7.1", "7", "despesa");
  addBlock("7.2", "7", "despesa");
  addBlock("7.3", "7", "despesa");
  addBlock("7.4", "7", "despesa");
  addCalc("8", "Resultado do Exercício Antes IR e CS", "6-7");
  rows.push({
    id: "acc-9",
    code: "9",
    name: "IRPJ",
    parent_id: null,
    level: 1,
    type: "despesa",
    is_summary: false,
    sort_order: order++,
    valuesByBucket: vals([36523.4, 0, 0, 0, 40857.31, 0]),
  });
  rows.push({
    id: "acc-10",
    code: "10",
    name: "Contribuição Social",
    parent_id: null,
    level: 1,
    type: "despesa",
    is_summary: false,
    sort_order: order++,
    valuesByBucket: vals([15308.42, 0, 0, 0, 16897.35, 0]),
  });
  addCalc("11", "Resultado Após IR e CS", "8-9-10");

  return { rows, formulas };
}
