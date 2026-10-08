// A abertura do ORÇADO no Budget: de linhas (conta × mês × despesa) para a lista
// que o drilldown mostra, AGRUPADA POR SETOR.
//
// O pedido original foi explícito — "nesse drilldown pode aparecer apenas o nome
// da despesa" —, então aqui não há mês, conta nem origem: só nome e valor,
// somados no período pedido. Uma despesa mensal apareceria 12 vezes sem esta soma.
//
// ── Por que o SETOR entrou (08/10/2026) ──────────────────────────────────────
// A lista saía corrida, e numa conta que vários setores alimentam ("Viagens e
// estadias", "Marketing") isso responde quanto foi orçado sem responder POR QUEM.
// O setor não está na linha do detalhe: ele vive na `source` da fatia
// (`orc:<metodo>:<categoria>:<setor>`), que a finalização grava junto. Quem
// resolve source → setor é o chamador, com a MESMA função que montou a source
// (`sourceFinalizacao`) — parsear a string aqui criaria um segundo entendimento
// da chave, que é o tipo de divergência que não dá erro.
//
// Módulo PURO: a rota só busca e delega.

export interface LinhaDetalheOrcado {
  company_id: string;
  nome: string;
  valor: number | string;
  /** A fatia que publicou esta linha. É daqui que o setor é resolvido. */
  source?: string | null;
}

export interface ItemOrcado {
  nome: string;
  valor: number;
}

export interface GrupoOrcado {
  /** Rótulo do setor já pronto (com a empresa, quando o recorte tem várias). */
  setor: string;
  /** O balde: linha sem setor resolvido. Vai por ÚLTIMO. */
  semSetor: boolean;
  total: number;
  itens: ItemOrcado[];
}

/** Como o chamador identifica o setor de cada linha. */
export interface SetorDaLinha {
  rotulo: string;
  /**
   * `true` quando não há setor (empresa que não orça por setor) ou quando a
   * fatia não foi encontrada. Separado do rótulo porque é ele que decide a
   * ordem — o balde vai por último mesmo tendo o maior valor.
   */
  semSetor: boolean;
}

export interface OpcoesDetalheOrcado {
  /**
   * Resolve o setor de uma linha.
   *
   * Recebe a linha inteira (e não só a source) porque a mesma source pode existir
   * em empresas diferentes: `orc:pessoal:-:-` é idêntica em todas as que não
   * orçam por setor, e sem a empresa as duas se fundiriam numa só.
   */
  setorDaLinha: (linha: LinhaDetalheOrcado) => SetorDaLinha;
}

/**
 * Agrupa por SETOR e, dentro dele, soma por despesa (maior primeiro).
 *
 * O nome da EMPRESA, quando o recorte tem mais de uma, vai no rótulo do setor e
 * não no da despesa: o cabeçalho já desambigua, e repetir a empresa em cada item
 * ("Mídia paga · Feat" dentro de "Marketing · Feat") seria ruído. A razão de
 * desambiguar continua a mesma de antes — duas despesas homônimas de empresas
 * diferentes somando numa linha só fariam o leitor concluir que é uma despesa
 * que custa o dobro.
 *
 * Valor vem do Postgres como `numeric`, que o PostgREST pode entregar em string:
 * converter aqui evita a concatenação silenciosa ("100" + "200").
 */
export function agruparDetalheOrcado(
  linhas: readonly LinhaDetalheOrcado[],
  opcoes: OpcoesDetalheOrcado,
): GrupoOrcado[] {
  const grupos = new Map<string, { semSetor: boolean; itens: Map<string, number> }>();

  for (const l of linhas) {
    const bruto = typeof l.valor === "number" ? l.valor : Number(l.valor);
    if (!Number.isFinite(bruto) || bruto === 0) continue;

    const { rotulo, semSetor } = opcoes.setorDaLinha(l);
    const chaveGrupo = rotulo || "Sem setor";
    let grupo = grupos.get(chaveGrupo);
    if (!grupo) {
      grupo = { semSetor, itens: new Map() };
      grupos.set(chaveGrupo, grupo);
    }

    const nome = (l.nome ?? "").trim() || "Sem nome";
    grupo.itens.set(nome, (grupo.itens.get(nome) ?? 0) + bruto);
  }

  const saida: GrupoOrcado[] = [];
  for (const [setor, g] of Array.from(grupos.entries())) {
    const itens = Array.from(g.itens.entries())
      .map(([nome, valor]) => ({ nome, valor: Math.round(valor * 100) / 100 }))
      .filter((i) => i.valor !== 0)
      .sort((a, b) => Math.abs(b.valor) - Math.abs(a.valor) || a.nome.localeCompare(b.nome, "pt-BR"));
    if (itens.length === 0) continue;
    saida.push({
      setor,
      semSetor: g.semSetor,
      total: Math.round(itens.reduce((a, i) => a + i.valor, 0) * 100) / 100,
      itens,
    });
  }

  // Maior primeiro — é um drilldown, e a pergunta é "de onde vem este número".
  // O balde "Sem setor" vai por ÚLTIMO mesmo assim: ele é dívida visível, não um
  // setor de verdade, e misturá-lo na ordem o faria passar por um. Mesma
  // convenção de "Sem grupo" (grupos.ts) e do "Sem setor" do quadro de pessoal.
  return saida.sort((a, b) => {
    if (a.semSetor !== b.semSetor) return a.semSetor ? 1 : -1;
    return Math.abs(b.total) - Math.abs(a.total) || a.setor.localeCompare(b.setor, "pt-BR");
  });
}

/** Total do drilldown — a soma dos grupos, que é a soma do que está na tela. */
export function totalDoDetalhe(grupos: readonly GrupoOrcado[]): number {
  return Math.round(grupos.reduce((a, g) => a + g.total, 0) * 100) / 100;
}

/** Quantas despesas o drilldown lista, somando os grupos. */
export function contarDespesas(grupos: readonly GrupoOrcado[]): number {
  return grupos.reduce((a, g) => a + g.itens.length, 0);
}
