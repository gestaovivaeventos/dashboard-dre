// ============================================================================
// Simulações de custo do DP — "quanto custa promover, dar aumento, contratar
// ou levar quem está abaixo da tabela ao salário dela". Puro e testado.
//
// A IA NÃO entra aqui: o número sai desta conta, determinística e explicável
// linha a linha (mesma filosofia da Rhuvio, "a IA não é a fonte dos números",
// e do motor de Viagens do Orçamento).
//
// A conta é a MESMA do Pessoal do Orçamento (`pessoal-calc.ts`, regime de
// competência), com as mesmas frações e as mesmas alíquotas
// (`resolverEncargos`), para o custo de uma pessoa não sair diferente nos dois
// módulos:
//   CLT    → salário × (1 + encargos) × (1 + 1/12 do 13º + 1/36 do terço de férias)
//   demais → só o salário (sócio, prestador e estágio não levam encargos nem
//            provisões no motor do Orçamento — mesma regra aqui)
// Benefícios NÃO entram: o DP não traz benefício por pessoa da Sólides. A tela
// diz isso, em vez de o custo só parecer menor.
// ============================================================================

import { grupoContrato } from "@/lib/dp/indicadores";
import { FRACAO_DECIMO_MES, FRACAO_FERIAS_MES, fatorEncargos, type EncargoValues } from "@/lib/orcamento/encargos";

export type DpVinculoCusto = "clt" | "sem_encargos";

/**
 * Como o tipo de contrato da Sólides entra na conta. "Sem tipo" é tratado como
 * CLT — e avisado: errar para mais (encargo que talvez não exista) é melhor
 * numa decisão de custo do que errar para menos.
 */
export function vinculoDeCusto(tipoContrato: string | null): { vinculo: DpVinculoCusto; presumido: boolean } {
  const g = grupoContrato(tipoContrato);
  if (g === "clt") return { vinculo: "clt", presumido: false };
  if (g === "outro") return { vinculo: "clt", presumido: true };
  return { vinculo: "sem_encargos", presumido: false };
}

export interface DpCustoMensal {
  salario: number;
  encargos: number;
  decimo: number;
  ferias: number;
  total: number;
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Custo mensal equivalente (competência) de uma pessoa, aberto por componente. */
export function custoMensal(salario: number, vinculo: DpVinculoCusto, enc: EncargoValues): DpCustoMensal {
  const s = Math.max(0, salario);
  if (vinculo !== "clt") return { salario: r2(s), encargos: 0, decimo: 0, ferias: 0, total: r2(s) };
  const f = fatorEncargos(enc);
  const encargos = s * f;
  const decimo = s * FRACAO_DECIMO_MES * (1 + f);
  const ferias = s * FRACAO_FERIAS_MES * (1 + f);
  return { salario: r2(s), encargos: r2(encargos), decimo: r2(decimo), ferias: r2(ferias), total: r2(s + encargos + decimo + ferias) };
}

// ── Cenário ─────────────────────────────────────────────────────────────────

export interface DpPessoaSim {
  id: string;
  nome: string;
  departamento: string | null;
  tipoContrato: string | null;
  /** Salário da Sólides; null = não informado (fica fora da conta e é contado). */
  salario: number | null;
  /** Salário da linha da tabela vinculada (enquadramento); null = sem linha. */
  salarioTabela: number | null;
}

export type DpItemCenario =
  | { id: string; tipo: "aumento"; percentual: number; alvo: "todos" | "departamento" | "pessoas"; departamento?: string; pessoas?: string[] }
  | { id: string; tipo: "promocao"; pessoaId: string; novoSalario: number; rotulo?: string }
  | { id: string; tipo: "contratacao"; quantidade: number; salario: number; vinculo: DpVinculoCusto; rotulo: string }
  | { id: string; tipo: "enquadrar" };

export interface DpEfeitoItem {
  itemId: string;
  /** Pessoas cujo salário o item mudou (ou contratadas). */
  pessoas: number;
  /** Diferença de custo mensal equivalente que o item causou. */
  deltaMensal: number;
}

export interface DpPessoaResultado {
  id: string;
  nome: string;
  salarioAtual: number;
  salarioSimulado: number;
  custoAtual: number;
  custoSimulado: number;
  contratacao: boolean;
}

export interface DpResultadoCenario {
  custoAtual: number;
  custoSimulado: number;
  deltaMensal: number;
  /** 12 × a diferença mensal equivalente. */
  deltaDozeMeses: number;
  /** Da vigência (mês 1–12) até dezembro: diferença mensal × meses restantes, inclusive o da vigência. */
  deltaAteDezembro: number;
  mesesAteDezembro: number;
  porItem: DpEfeitoItem[];
  /** Só quem muda (ou entra). */
  afetados: DpPessoaResultado[];
  /** Ativos sem salário na Sólides: ficam fora do custo e de qualquer item. */
  semSalario: number;
  /** Ativos sem tipo de contrato, contados como CLT. */
  presumidosClt: number;
}

interface Estado {
  id: string;
  nome: string;
  departamento: string | null;
  vinculo: DpVinculoCusto;
  salarioTabela: number | null;
  salarioAtual: number;
  salario: number;
  contratacao: boolean;
}

/**
 * Aplica os itens EM ORDEM, cada um sobre o resultado do anterior (um aumento
 * depois de uma promoção incide sobre o salário já promovido — é a ordem que a
 * pessoa montou na tela), e mede o efeito de cada item como a diferença de
 * custo que ele causou naquele ponto.
 */
export function simularCenario(input: {
  pessoas: DpPessoaSim[];
  itens: DpItemCenario[];
  encargos: EncargoValues;
  /** Mês (1–12) em que o cenário passa a valer. */
  mesVigencia: number;
}): DpResultadoCenario {
  const custo = (e: Estado) => custoMensal(e.salario, e.vinculo, input.encargos).total;
  const total = (es: Estado[]) => r2(es.reduce((s, e) => s + custo(e), 0));

  let semSalario = 0;
  let presumidosClt = 0;
  const estado: Estado[] = [];
  for (const p of input.pessoas) {
    if (p.salario === null || p.salario <= 0) {
      semSalario += 1;
      continue;
    }
    const v = vinculoDeCusto(p.tipoContrato);
    if (v.presumido) presumidosClt += 1;
    estado.push({
      id: p.id,
      nome: p.nome,
      departamento: p.departamento,
      vinculo: v.vinculo,
      salarioTabela: p.salarioTabela,
      salarioAtual: p.salario,
      salario: p.salario,
      contratacao: false,
    });
  }
  const custoAtual = total(estado);

  const porItem: DpEfeitoItem[] = [];
  for (const item of input.itens) {
    const antes = total(estado);
    let pessoas = 0;
    if (item.tipo === "aumento") {
      const pct = Math.max(0, item.percentual);
      const alvo = new Set(item.pessoas ?? []);
      for (const e of estado) {
        const entra =
          item.alvo === "todos" ||
          (item.alvo === "departamento" && (e.departamento ?? "") === (item.departamento ?? "")) ||
          (item.alvo === "pessoas" && alvo.has(e.id));
        if (!entra || pct === 0) continue;
        e.salario = r2(e.salario * (1 + pct / 100));
        pessoas += 1;
      }
    } else if (item.tipo === "promocao") {
      const e = estado.find((x) => x.id === item.pessoaId);
      if (e && item.novoSalario >= 0 && Math.abs(item.novoSalario - e.salario) >= 0.005) {
        e.salario = r2(item.novoSalario);
        pessoas = 1;
      }
    } else if (item.tipo === "contratacao") {
      const n = Math.max(0, Math.floor(item.quantidade));
      for (let i = 0; i < n; i += 1) {
        estado.push({
          id: `${item.id}#${i}`,
          nome: `${item.rotulo || "Contratação"}${n > 1 ? ` (${i + 1}/${n})` : ""}`,
          departamento: null,
          vinculo: item.vinculo,
          salarioTabela: null,
          salarioAtual: 0,
          salario: Math.max(0, item.salario),
          contratacao: true,
        });
      }
      pessoas = n;
    } else {
      // Leva quem está ABAIXO da tabela ao salário da linha. Quem está acima
      // não desce: simulação de redução salarial não é o que se pediu.
      for (const e of estado) {
        if (e.contratacao || e.salarioTabela === null) continue;
        if (e.salario + 0.005 < e.salarioTabela) {
          e.salario = e.salarioTabela;
          pessoas += 1;
        }
      }
    }
    porItem.push({ itemId: item.id, pessoas, deltaMensal: r2(total(estado) - antes) });
  }

  const custoSimulado = total(estado);
  const deltaMensal = r2(custoSimulado - custoAtual);
  const mes = Math.min(12, Math.max(1, Math.floor(input.mesVigencia)));
  const mesesAteDezembro = 13 - mes;
  const afetados = estado
    .filter((e) => e.contratacao || Math.abs(e.salario - e.salarioAtual) >= 0.005)
    .map((e) => ({
      id: e.id,
      nome: e.nome,
      salarioAtual: e.salarioAtual,
      salarioSimulado: e.salario,
      custoAtual: e.contratacao ? 0 : custoMensal(e.salarioAtual, e.vinculo, input.encargos).total,
      custoSimulado: custoMensal(e.salario, e.vinculo, input.encargos).total,
      contratacao: e.contratacao,
    }));

  return {
    custoAtual,
    custoSimulado,
    deltaMensal,
    deltaDozeMeses: r2(deltaMensal * 12),
    deltaAteDezembro: r2(deltaMensal * mesesAteDezembro),
    mesesAteDezembro,
    porItem,
    afetados,
    semSalario,
    presumidosClt,
  };
}
