// ============================================================================
// Indicadores do quadro (DP). Puro e testado: recebe as linhas que a tela já
// carregou e devolve os números — a mesma conta para os cards, a tabela por
// empresa e o total, para nunca divergirem entre si.
//
// Limites que a TELA tem de dizer, porque mudam a leitura do número:
//  - "Folha" é a soma do SALÁRIO informado na Sólides. Não tem encargo,
//    benefício nem variável; e quem está sem salário lá não entra na soma
//    (por isso `semSalario` vai junto, em vez de a folha só parecer menor).
//  - Salário médio é só de CLT: misturar pró-labore de sócio e nota de
//    prestador numa média produziria um número que não descreve ninguém.
//  - Admissões por mês saem da data de admissão de quem está ATIVO hoje. Quem
//    entrou e já saiu não está na lista da Sólides, então o passado aparece
//    menor do que foi (viés de sobrevivência). Desligamento só existe a partir
//    de 29/09/2026, quando o espelho começou.
// ============================================================================

export interface DpIndicadorEntrada {
  ativo: boolean;
  companyName: string | null;
  tipoContrato: string | null;
  salario: number | null;
  dataAdmissao: string | null; // AAAA-MM-DD
  dataDesligamento: string | null;
  desligadoDetectadoEm: string | null; // ISO
}

export type DpGrupoContrato = "clt" | "socio" | "prestador" | "estagio" | "outro";

export const ROTULO_CONTRATO: Record<DpGrupoContrato, string> = {
  clt: "CLT",
  socio: "Sócios",
  prestador: "Prestadores",
  estagio: "Estágio / aprendiz",
  outro: "Sem tipo",
};

export const SEM_EMPRESA = "Sem empresa definida";

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
}

/** Os rótulos da Sólides vistos em 29/09/2026: CLT, Sócio, Prestador de Serviço, Estagiário, Jovem Aprendiz. */
export function grupoContrato(tipo: string | null): DpGrupoContrato {
  const t = semAcento(tipo ?? "");
  if (!t) return "outro";
  if (t.includes("clt")) return "clt";
  if (t.includes("socio")) return "socio";
  if (t.includes("prestador")) return "prestador";
  if (t.includes("estag") || t.includes("aprendiz")) return "estagio";
  return "outro";
}

export interface DpIndicadorLinha {
  empresa: string;
  ativos: number;
  porContrato: Record<DpGrupoContrato, number>;
  /** Soma do salário informado dos ativos (todas as modalidades). */
  folha: number;
  /** Ativos sem salário na Sólides — ficam fora de `folha` e da média. */
  semSalario: number;
  /** Média do salário dos CLT com salário informado; null se nenhum. */
  salarioMedioClt: number | null;
  /** Tempo médio de casa dos ativos, em meses; null se ninguém tem admissão. */
  tempoMedioMeses: number | null;
  /** Ativos admitidos nos últimos 12 meses (até `hoje`). */
  admitidos12m: number;
}

export interface DpIndicadores {
  total: DpIndicadorLinha;
  porEmpresa: DpIndicadorLinha[];
  /** Admissões por mês ("AAAA-MM"), últimos 12 meses inclusive o corrente, dos ATIVOS. */
  admissoesPorMes: Array<{ mes: string; quantidade: number }>;
  /** Desligados percebidos nos últimos 12 meses (o espelho só os vê a partir de 29/09/2026). */
  desligados12m: number;
}

function vazio(empresa: string): DpIndicadorLinha {
  return {
    empresa,
    ativos: 0,
    porContrato: { clt: 0, socio: 0, prestador: 0, estagio: 0, outro: 0 },
    folha: 0,
    semSalario: 0,
    salarioMedioClt: null,
    tempoMedioMeses: null,
    admitidos12m: 0,
  };
}

function mesesEntre(inicio: string, hoje: string): number {
  const [ay, am, ad] = inicio.split("-").map(Number);
  const [by, bm, bd] = hoje.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) + (bd - ad) / 30;
}

/** "AAAA-MM" dos últimos 12 meses terminando no mês de `hoje`. */
export function ultimos12Meses(hoje: string): string[] {
  const [y, m] = hoje.split("-").map(Number);
  const out: string[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return out;
}

/** `hoje` em AAAA-MM-DD (dia de Brasília, quem chama decide). */
export function calcularIndicadores(rows: DpIndicadorEntrada[], hoje: string): DpIndicadores {
  const meses = ultimos12Meses(hoje);
  const primeiroMes = meses[0];
  const contagemMes = new Map(meses.map((m) => [m, 0]));

  // Acumuladores por empresa: somas brutas, médias resolvidas no fim.
  type Acc = { linha: DpIndicadorLinha; somaClt: number; nClt: number; somaMeses: number; nMeses: number };
  const accs = new Map<string, Acc>();
  const acc = (empresa: string): Acc => {
    let a = accs.get(empresa);
    if (!a) {
      a = { linha: vazio(empresa), somaClt: 0, nClt: 0, somaMeses: 0, nMeses: 0 };
      accs.set(empresa, a);
    }
    return a;
  };
  const total: Acc = { linha: vazio("Total"), somaClt: 0, nClt: 0, somaMeses: 0, nMeses: 0 };

  let desligados12m = 0;
  for (const r of rows) {
    if (!r.ativo) {
      const quando = r.dataDesligamento ?? r.desligadoDetectadoEm?.slice(0, 10) ?? null;
      if (quando && quando.slice(0, 7) >= primeiroMes && quando <= hoje) desligados12m += 1;
      continue;
    }
    const grupo = grupoContrato(r.tipoContrato);
    const admissao = r.dataAdmissao && r.dataAdmissao <= hoje ? r.dataAdmissao : null;
    for (const a of [acc(r.companyName ?? SEM_EMPRESA), total]) {
      a.linha.ativos += 1;
      a.linha.porContrato[grupo] += 1;
      if (r.salario !== null && r.salario > 0) {
        a.linha.folha += r.salario;
        if (grupo === "clt") {
          a.somaClt += r.salario;
          a.nClt += 1;
        }
      } else {
        a.linha.semSalario += 1;
      }
      if (admissao) {
        a.somaMeses += Math.max(0, mesesEntre(admissao, hoje));
        a.nMeses += 1;
        if (admissao.slice(0, 7) >= primeiroMes) a.linha.admitidos12m += 1;
      }
    }
    // Admissão futura (contratação agendada) não entra no gráfico do passado.
    if (admissao) {
      const m = admissao.slice(0, 7);
      if (contagemMes.has(m)) contagemMes.set(m, (contagemMes.get(m) ?? 0) + 1);
    }
  }

  const fechar = (a: Acc): DpIndicadorLinha => ({
    ...a.linha,
    folha: Math.round(a.linha.folha * 100) / 100,
    salarioMedioClt: a.nClt > 0 ? Math.round((a.somaClt / a.nClt) * 100) / 100 : null,
    tempoMedioMeses: a.nMeses > 0 ? Math.round((a.somaMeses / a.nMeses) * 10) / 10 : null,
  });

  const porEmpresa = Array.from(accs.values())
    .map(fechar)
    // Maior quadro primeiro; "Sem empresa" sempre por último (mesma convenção do "Sem grupo").
    .sort(
      (x, y) =>
        Number(x.empresa === SEM_EMPRESA) - Number(y.empresa === SEM_EMPRESA) ||
        y.ativos - x.ativos ||
        x.empresa.localeCompare(y.empresa, "pt-BR"),
    );

  return {
    total: fechar(total),
    porEmpresa,
    admissoesPorMes: meses.map((mes) => ({ mes, quantidade: contagemMes.get(mes) ?? 0 })),
    desligados12m,
  };
}
