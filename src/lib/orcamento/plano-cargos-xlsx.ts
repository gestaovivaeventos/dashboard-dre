// Leitura da planilha de Plano de Cargos e Salários.
//
// Formato esperado (uma linha por cargo × nível):
//   Empresa | Setor | Cargo | Nível | Salário base
//
// A ordem das colunas é livre e o cabeçalho é procurado nas primeiras linhas —
// planilhas reais costumam ter título e linhas em branco antes dele. A coluna
// Setor é opcional: empresas que não orçam por setor no ano a ignoram.
//
// Módulo puro (sem I/O): recebe a matriz de células e devolve linhas prontas,
// para o parsing poder ser conferido sem banco.

export interface PlanoCargosRow {
  /** Linha na planilha (1-based), para apontar o problema ao usuário. */
  linha: number;
  empresa: string;
  setor: string;
  cargo: string;
  nivel: string;
  salario: number;
}

export interface PlanoCargosParse {
  rows: PlanoCargosRow[];
  /** Linhas descartadas na leitura, já com o motivo. */
  problemas: string[];
  /** true quando a planilha traz coluna de Setor. */
  temColunaSetor: boolean;
}

export function normalizarTexto(valor: unknown): string {
  return String(valor ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/** Número em pt-BR ou en-US: "3.500,00", "3500.00", "R$ 3.500", 3500. */
export function lerSalario(bruto: unknown): number | null {
  if (bruto == null || bruto === "") return null;
  if (typeof bruto === "number") return Number.isFinite(bruto) ? bruto : null;

  const texto = String(bruto).trim();
  if (!texto || texto === "-") return null;
  const corpo = texto.replace(/[R$\s]/gi, "");
  if (!corpo) return null;

  // Com vírgula, ela é o separador decimal e o ponto é milhar: "4.500,00".
  // Sem vírgula, o ponto é ambíguo — "6.000" é seis mil em pt-BR e seis em
  // en-US. Desempata pelo formato: só é milhar quando TODOS os grupos depois do
  // ponto têm exatamente 3 dígitos. Assim "6.000" → 6000 e "3500.50" → 3500,5.
  let num: number;
  if (corpo.includes(",")) {
    num = Number(corpo.replace(/\./g, "").replace(",", "."));
  } else if (/^\d{1,3}(\.\d{3})+$/.test(corpo)) {
    num = Number(corpo.replace(/\./g, ""));
  } else {
    num = Number(corpo);
  }
  return Number.isFinite(num) ? num : null;
}

interface Colunas {
  empresa: number;
  setor: number;
  cargo: number;
  nivel: number;
  salario: number;
}

/** Procura o cabeçalho nas primeiras linhas e mapeia as colunas. */
function acharCabecalho(data: unknown[][]): { linha: number; cols: Colunas } | null {
  const limite = Math.min(data.length, 30);
  for (let i = 0; i < limite; i += 1) {
    const row = data[i] ?? [];
    const cols: Colunas = { empresa: -1, setor: -1, cargo: -1, nivel: -1, salario: -1 };

    row.forEach((celula, idx) => {
      const texto = normalizarTexto(celula);
      if (!texto) return;
      // Testa "salario" antes de "cargo" porque "salario base" não colide, mas
      // um cabeçalho como "cargo e salario" cairia nos dois.
      if (cols.salario < 0 && /salario|remunerac/.test(texto)) cols.salario = idx;
      else if (cols.empresa < 0 && /empresa|cnpj|unidade/.test(texto)) cols.empresa = idx;
      else if (cols.setor < 0 && /setor|departamento|area/.test(texto)) cols.setor = idx;
      else if (cols.nivel < 0 && /nivel|senioridade/.test(texto)) cols.nivel = idx;
      else if (cols.cargo < 0 && /cargo|funcao/.test(texto)) cols.cargo = idx;
    });

    if (cols.empresa >= 0 && cols.cargo >= 0 && cols.nivel >= 0 && cols.salario >= 0) {
      return { linha: i, cols };
    }
  }
  return null;
}

export function parsePlanoCargos(
  data: unknown[][],
): { parse: PlanoCargosParse } | { erro: string } {
  const cabecalho = acharCabecalho(data);
  if (!cabecalho) {
    return {
      erro:
        "Não encontrei o cabeçalho da planilha. Ela precisa ter colunas Empresa, Cargo, Nível e Salário base (Setor é opcional).",
    };
  }

  const { linha: headerIdx, cols } = cabecalho;
  const rows: PlanoCargosRow[] = [];
  const problemas: string[] = [];

  for (let i = headerIdx + 1; i < data.length; i += 1) {
    const row = data[i] ?? [];
    const numeroLinha = i + 1;

    const empresa = String(row[cols.empresa] ?? "").trim();
    const cargo = String(row[cols.cargo] ?? "").trim();
    const nivel = String(row[cols.nivel] ?? "").trim();
    const setor = cols.setor >= 0 ? String(row[cols.setor] ?? "").trim() : "";
    const salarioBruto = row[cols.salario];

    // Linha totalmente vazia é separador, não erro.
    if (!empresa && !cargo && !nivel && !setor && (salarioBruto == null || salarioBruto === "")) {
      continue;
    }

    if (!empresa) {
      problemas.push(`Linha ${numeroLinha}: sem empresa.`);
      continue;
    }
    if (!cargo) {
      problemas.push(`Linha ${numeroLinha}: sem cargo.`);
      continue;
    }
    if (!nivel) {
      problemas.push(`Linha ${numeroLinha}: sem nível.`);
      continue;
    }
    const salario = lerSalario(salarioBruto);
    if (salario == null) {
      problemas.push(`Linha ${numeroLinha}: salário inválido ("${String(salarioBruto ?? "")}").`);
      continue;
    }
    if (salario < 0) {
      problemas.push(`Linha ${numeroLinha}: salário negativo.`);
      continue;
    }

    rows.push({ linha: numeroLinha, empresa, setor, cargo, nivel, salario });
  }

  return { parse: { rows, problemas, temColunaSetor: cols.setor >= 0 } };
}
