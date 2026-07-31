// =============================================================================
// Motor da prévia mensal de despesas com pessoal.
//
// Função PURA (sem I/O, sem Supabase): recebe o quadro, as alíquotas e o regime
// de apuração, devolve a matriz 12 meses × linhas. Sendo pura, os números podem
// ser conferidos sem subir a tela e o motor é reaproveitável quando a prévia
// virar linha de orçamento na DRE.
//
// ─── Composição das linhas ──────────────────────────────────────────────────
//   Salários    SAL(m) + PJ(m) + EST(m)
//   Benefícios  BEN(m)
//   Férias      médiaCorrida(m)/36 × (1 + i + f) no mês ativo ← só o terço
//   13º         competência: médiaCorrida(m)/12 × (1 + i + f) no mês ativo
//               caixa:       50% em novembro + 50% em dezembro
//
// médiaCorrida(m) é a média salarial de janeiro (ou da admissão) ATÉ o mês m —
// sempre olhando para trás. Nenhum salário futuro entra: um aumento previsto
// para outubro não pode inflar a provisão de março, porque não se sabe se será
// executado. Quem entra em julho acumula 6 meses de provisão, logo 6/12 do 13º.
//   INSS        SAL(m) × i
//   FGTS        SAL(m) × f
//
// SAL(m) é a base de encargos e inclui SOMENTE colaboradores CLT: PJ não gera
// encargo, 13º nem férias, e estágio (Lei 11.788) não é vínculo CLT — sem INSS
// patronal, sem FGTS, sem 13º e sem férias. Os dois entram só em Salários (e nos
// benefícios, que valem para todos).
//
// As linhas de INSS e FGTS multiplicam SAL(m) puro. Os encargos das provisões
// vivem dentro das linhas de Férias e 13º — somar tudo sobre a mesma base
// contaria os encargos duas vezes.
//
// ─── Defasagem (só no regime de caixa) ──────────────────────────────────────
// A folha de um mês é paga no dia 5 do mês seguinte, e o INSS/FGTS dela no dia
// 20 do mês seguinte. No caixa, portanto, a célula de cada mês mostra a folha
// do mês ANTERIOR. Defasam só Salários, INSS e FGTS. Consequências assumidas:
//   • janeiro usa a folha de janeiro como proxy da folha de dezembro do ano
//     anterior (que está fora do quadro);
//   • a folha de dezembro do ano orçado cai em janeiro do ano seguinte, ou
//     seja, fica fora desta prévia — logo, movimentação marcada para dezembro
//     não aparece no ano.
// NÃO defasam: benefícios (do próprio mês de uso), férias (o mês de gozo é
// desconhecido, então deslocar a provisão não diria nada) e o 13º, que tem
// calendário próprio — novembro e dezembro.
// =============================================================================

import {
  FRACAO_DECIMO_MES,
  FRACAO_FERIAS_MES,
  fatorEncargos,
  fatorFgts,
  fatorInss,
  type EncargoValues,
} from "@/lib/orcamento/encargos";
import { BENEFICIOS, type BeneficioKey } from "@/lib/orcamento/beneficios";
import type { RegimeApuracao } from "@/lib/orcamento/regime-apuracao";
import type { Colaborador } from "@/lib/orcamento/actions/pessoal";

export const MESES_CURTOS = [
  "jan", "fev", "mar", "abr", "mai", "jun",
  "jul", "ago", "set", "out", "nov", "dez",
] as const;

export type PreviaLinhaKey =
  | "salarios"
  | "beneficios"
  | "ferias"
  | "decimo"
  | "inss"
  | "fgts";

/** Prefixo da chave de um benefício que foi SEPARADO em linha própria. */
export const LINHA_BENEFICIO_PREFIXO = "beneficio:";

export interface PreviaLinha {
  /** Uma PreviaLinhaKey, ou "beneficio:<chave>" quando é benefício separado. */
  key: string;
  label: string;
  /** 12 posições, índice 0 = janeiro. */
  meses: number[];
  total: number;
}

/** Abertura de uma linha da prévia (hoje só Benefícios, um item por benefício). */
export interface PreviaSubLinha {
  key: string;
  label: string;
  meses: number[];
  total: number;
}

export interface PreviaResultado {
  linhas: PreviaLinha[];
  /** Benefícios abertos um a um (só os que têm valor). Soma exatamente a linha
   * de Benefícios. */
  beneficiosDetalhe: PreviaSubLinha[];
  /** Soma das linhas, mês a mês. */
  totalMeses: number[];
  totalAno: number;
  /** Base de encargos (folha CLT) por mês, já com a defasagem aplicada. */
  baseClt: number[];
  /** Quantos colaboradores CLT estão ativos em cada mês (antes da defasagem). */
  headcountClt: number[];
  /** Linhas do quadro que o motor não conseguiu posicionar no tempo. */
  avisos: string[];
}

const LINHA_LABELS: Record<PreviaLinhaKey, string> = {
  salarios: "Salários",
  beneficios: "Benefícios",
  ferias: "Férias",
  decimo: "13º Salário",
  inss: "INSS",
  fgts: "FGTS",
};

function zeros(): number[] {
  return new Array<number>(12).fill(0);
}

/** "YYYY-MM-01" → índice do mês (0..11), ou null se ausente/inválido. */
function mesIndex(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const mes = Number(iso.slice(5, 7));
  if (!Number.isInteger(mes) || mes < 1 || mes > 12) return null;
  return mes - 1;
}

interface MovOrdenada {
  ordem: number;
  tipo: "admissao" | "movimentacao" | "desligamento";
  mes: number;
  salario: number | null;
}

/**
 * Linha do tempo de um colaborador no ano: salário vigente em cada mês e null
 * nos meses em que ele não faz parte do quadro (antes da admissão, depois do
 * desligamento).
 */
function linhaDoTempo(colab: Colaborador, avisos: string[]): { salarios: (number | null)[] } {
  const nome = colab.nome?.trim() || "colaborador sem nome";
  const movs: MovOrdenada[] = [];

  [colab.mov1, colab.mov2].forEach((mov, ordem) => {
    if (!mov?.tipo) return;
    const mes = mesIndex(mov.data);
    if (mes == null) {
      avisos.push(`${nome}: movimentação ${ordem + 1} sem mês definido — ignorada.`);
      return;
    }
    movs.push({ ordem, tipo: mov.tipo, mes, salario: mov.salario ?? null });
  });
  // Empate de mês: a ordem em que foram lançadas desempata.
  movs.sort((a, b) => a.mes - b.mes || a.ordem - b.ordem);

  const admissao = movs.find((m) => m.tipo === "admissao");
  const desligamento = movs.find((m) => m.tipo === "desligamento");

  // Sem admissão, o colaborador já está na casa desde janeiro. O desligamento
  // ainda conta a folha do próprio mês, então a saída é a partir do mês seguinte.
  const inicio = admissao?.mes ?? 0;
  const fim = desligamento ? desligamento.mes : 11;

  if (desligamento && admissao && desligamento.mes < admissao.mes) {
    avisos.push(`${nome}: desligamento antes da admissão — linha ignorada na prévia.`);
    return { salarios: new Array<number | null>(12).fill(null) };
  }

  const salarios = new Array<number | null>(12).fill(null);
  let vigente = colab.salarioAtual ?? 0;
  // A admissão define o salário de entrada quando ela traz um.
  if (admissao?.salario != null) vigente = admissao.salario;

  for (let m = 0; m < 12; m += 1) {
    // Movimentações valem a partir do próprio mês.
    for (const mov of movs) {
      if (mov.mes === m && mov.tipo === "movimentacao" && mov.salario != null) {
        vigente = mov.salario;
      }
    }
    if (m < inicio || m > fim) continue;
    salarios[m] = vigente;
  }

  return { salarios };
}

/** Valor mensal de um benefício para um colaborador (null/inválido → 0). */
function valorBeneficio(colab: Colaborador, key: BeneficioKey): number {
  const valor = colab.beneficios[key];
  return valor != null && Number.isFinite(valor) ? valor : 0;
}

/** Desloca uma série um mês para a frente; janeiro repete o próprio valor,
 * usado como proxy da folha de dezembro do ano anterior. */
function defasar(serie: number[]): number[] {
  const saida = zeros();
  saida[0] = serie[0];
  for (let m = 1; m < 12; m += 1) saida[m] = serie[m - 1];
  return saida;
}

function somar(serie: number[]): number {
  return serie.reduce((acc, v) => acc + v, 0);
}

export interface PreviaInput {
  colaboradores: Colaborador[];
  encargos: EncargoValues;
  regimeApuracao: RegimeApuracao;
  /**
   * Benefícios que NÃO entram na linha "Benefícios": cada um vira uma linha
   * própria da prévia (e um rótulo próprio no orçamento). Ausente = todos
   * agrupados, o comportamento padrão.
   */
  beneficiosSeparados?: BeneficioKey[];
}

export function calcularPrevia({
  colaboradores,
  encargos,
  regimeApuracao,
  beneficiosSeparados = [],
}: PreviaInput): PreviaResultado {
  const avisos: string[] = [];
  const i = fatorInss(encargos);
  const f = fatorFgts(encargos);
  const comEncargos = 1 + fatorEncargos(encargos);
  const caixa = regimeApuracao === "caixa";

  const salCLT = zeros();
  const outrosVinculos = zeros();
  const headcountClt = zeros();
  // Benefícios acumulados por chave, para poder abrir a linha um a um. A linha
  // de Benefícios é a soma destas séries.
  const beneficiosPorKey = new Map<BeneficioKey, number[]>(
    BENEFICIOS.map((b) => [b.key, zeros()]),
  );
  // Provisões por mês, ANTES dos encargos. A base de cada mês é a MÉDIA CORRIDA
  // do salário: em cada mês olha-se para TRÁS — de janeiro (ou da admissão) até
  // o mês que está sendo calculado —, nunca para a frente, porque um aumento
  // previsto para outubro não pode inflar a provisão de março: ninguém sabe se
  // vai ser executado.
  //   13º    = médiaCorrida(m) / 12   por mês ativo
  //   Férias = médiaCorrida(m) / 36   por mês ativo (só o terço: (1/3)/12)
  // Uma promoção faz a provisão subir GRADUALMENTE a partir do mês dela, à
  // medida que ela entra na média — não muda os meses anteriores.
  const decimoMensal = zeros();
  const feriasMensal = zeros();

  for (const colab of colaboradores) {
    const { salarios } = linhaDoTempo(colab, avisos);
    const ehClt = colab.vinculo === "clt";

    // Média corrida: acumula mês a mês só o que já passou. A janela legal é de
    // 12 meses para trás, o que dentro de um ano de orçamento significa "desde
    // janeiro" — ou desde a admissão, para quem entra no meio do ano.
    let somaAcumulada = 0;
    let mesesAcumulados = 0;

    for (let m = 0; m < 12; m += 1) {
      const salario = salarios[m];
      if (salario == null) continue;
      somaAcumulada += salario;
      mesesAcumulados += 1;
      const mediaCorrida = somaAcumulada / mesesAcumulados;

      if (ehClt) {
        salCLT[m] += salario;
        headcountClt[m] += 1;
        decimoMensal[m] += mediaCorrida * FRACAO_DECIMO_MES;
        feriasMensal[m] += mediaCorrida * FRACAO_FERIAS_MES;
      } else {
        outrosVinculos[m] += salario;
      }
      for (const meta of BENEFICIOS) {
        const serie = beneficiosPorKey.get(meta.key);
        if (serie) serie[m] += valorBeneficio(colab, meta.key);
      }
    }
  }

  // Benefícios separados saem da linha "Benefícios" e viram linhas próprias.
  const separados = new Set<BeneficioKey>(beneficiosSeparados);

  // Só os benefícios que têm valor entram na abertura — a tela não precisa de
  // sete linhas zeradas. A abertura mostra o que está DENTRO de "Benefícios",
  // então os separados ficam de fora dela.
  const beneficiosDetalhe: PreviaSubLinha[] = BENEFICIOS.filter(
    (meta) => !separados.has(meta.key),
  )
    .map((meta) => {
      const meses = beneficiosPorKey.get(meta.key) ?? zeros();
      return { key: meta.key, label: meta.label, meses, total: somar(meses) };
    })
    .filter((linha) => linha.total > 0);

  const linhasBeneficioSeparado: PreviaLinha[] = BENEFICIOS.filter((meta) =>
    separados.has(meta.key),
  )
    .map((meta) => {
      const meses = beneficiosPorKey.get(meta.key) ?? zeros();
      return {
        key: `${LINHA_BENEFICIO_PREFIXO}${meta.key}`,
        label: meta.label,
        meses,
        total: somar(meses),
      };
    })
    .filter((linha) => linha.total > 0);

  const beneficios = zeros();
  beneficiosPorKey.forEach((serie, key) => {
    if (separados.has(key)) return;
    for (let m = 0; m < 12; m += 1) beneficios[m] += serie[m];
  });

  // Séries da folha, na competência do trabalho (antes de qualquer defasagem).
  const folhaSalarios = salCLT.map((v, m) => v + outrosVinculos[m]);
  const folhaInss = salCLT.map((v) => v * i);
  const folhaFgts = salCLT.map((v) => v * f);
  const provisaoFerias = feriasMensal.map((v) => v * comEncargos);

  // ─── O REGIME DE APURAÇÃO decide o resto ──────────────────────────────────
  // Ele vem primeiro: cada regime monta as 6 linhas à sua maneira, e nada é
  // "calculado antes e ajustado depois". Os dois blocos são independentes de
  // propósito — mexer num não pode mudar o outro sem querer.
  let series: Record<PreviaLinhaKey, number[]>;

  if (caixa) {
    // CAIXA — o mês mostra quando o dinheiro SAI.
    //  • Folha paga no dia 5 e INSS/FGTS no dia 20 do mês seguinte → defasam 1 mês.
    //  • Benefícios são do próprio mês de uso.
    //  • Férias ficam no próprio mês do cálculo: como o mês de gozo é
    //    desconhecido, deslocar a provisão não significaria nada.
    //  • 13º: as duas parcelas do ano saem sempre em novembro e dezembro.
    const decimo = zeros();
    const metade = somar(decimoMensal) * 0.5 * comEncargos;
    decimo[10] = metade;
    decimo[11] = metade;

    series = {
      salarios: defasar(folhaSalarios),
      beneficios,
      ferias: provisaoFerias,
      decimo,
      inss: defasar(folhaInss),
      fgts: defasar(folhaFgts),
    };
  } else {
    // COMPETÊNCIA — o mês mostra o custo GERADO nele, sem defasagem nenhuma.
    // As provisões de férias e 13º são acumuladas mês a mês sobre a média
    // corrida do salário.
    series = {
      salarios: folhaSalarios,
      beneficios,
      ferias: provisaoFerias,
      decimo: decimoMensal.map((v) => v * comEncargos),
      inss: folhaInss,
      fgts: folhaFgts,
    };
  }

  const linhaBase = (key: PreviaLinhaKey): PreviaLinha => ({
    key,
    label: LINHA_LABELS[key],
    meses: series[key],
    total: somar(series[key]),
  });

  // Os benefícios separados vêm logo depois da linha de Benefícios, para ficar
  // claro que saíram dela.
  const linhas: PreviaLinha[] = [
    linhaBase("salarios"),
    linhaBase("beneficios"),
    ...linhasBeneficioSeparado,
    linhaBase("ferias"),
    linhaBase("decimo"),
    linhaBase("inss"),
    linhaBase("fgts"),
  ];

  const totalMeses = zeros();
  for (const linha of linhas) {
    for (let m = 0; m < 12; m += 1) totalMeses[m] += linha.meses[m];
  }

  return {
    linhas,
    beneficiosDetalhe,
    totalMeses,
    totalAno: somar(totalMeses),
    baseClt: caixa ? defasar(salCLT) : salCLT,
    headcountClt,
    avisos,
  };
}
