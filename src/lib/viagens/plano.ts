// =============================================================================
// O PLANO DO ANO, recebido de uma vez (02/10/2026) — fase 3.
//
// ── Onde a IA passa a valer de verdade ────────────────────────────────────
// Não cotando: RECEBENDO. O gestor tem ~50 viagens na cabeça e, ditando ou
// colando, descreve o ano inteiro numa mensagem — "Curitiba em março, 2 noites, 3
// pessoas; Recife em maio, 3 noites, 2 pessoas; ..." — e uma única chamada de IA
// devolve as 50 linhas da grade para ele conferir. É o mesmo padrão do pedido
// colado do WhatsApp do Case, que já se provou.
//
// ── A IA devolve NOMES, não ids ──────────────────────────────────────────
// O modelo não conhece uuid. Ele diz "Treinamento"; o casamento nome → id acontece
// aqui, com normalização (sem acento, sem caixa), e o que não casar volta como AVISO
// em vez de virar linha errada em silêncio.
//
// ── Preço NÃO passa por aqui (06/10/2026) ───────────────────────────────
// A leitura do plano descreve a viagem; o custo vem da cotação externa, lançada
// depois por grupo de despesa. As faixas de preço saíram do intake junto com o resto
// da estimativa — pedir à IA que escolha faixa era pedir que ela opinasse sobre
// preço, que é exatamente o que este módulo deixou de fazer.
//
// ── Nada é gravado ───────────────────────────────────────────────────────
// A leitura preenche a grade; gravar continua sendo o botão "Salvar e calcular",
// onde o custo é calculado e as travas valem. Leitura é SUGESTÃO.
//
// Módulo PURO e testado.
// =============================================================================

export interface PlanoLinhaBruta {
  destino: string;
  mes: number | null;
  noites: number;
  pessoas: number;
  pessoasPorQuarto: number | null;
  /** Nome do tipo, como a IA o leu. */
  tipo: string | null;
  modal: string | null;
  finalidade: string | null;
  /**
   * Etiqueta das cidades de uma MESMA ida.
   *
   * A grade tem uma cidade por linha, então uma ida a duas cidades volta como
   * duas linhas — e cada uma recebe uma passagem. Isso DOBRA a passagem, e é por
   * isso que a etiqueta existe: ela vira aviso. Descartar a 2a cidade seria pior
   * (o gestor acharia que orçou algo que não orçou), e somar as duas numa linha
   * esconderia a 2a cidade da conferência.
   */
  junto: string | null;
}

/** Normaliza para casar nome: sem acento, sem caixa, sem espaço sobrando. */
export function chaveNome(s: string): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

const MESES_NOME: Record<string, number> = {
  janeiro: 1, jan: 1,
  fevereiro: 2, fev: 2,
  marco: 3, mar: 3,
  abril: 4, abr: 4,
  maio: 5, mai: 5,
  junho: 6, jun: 6,
  julho: 7, jul: 7,
  agosto: 8, ago: 8,
  setembro: 9, set: 9,
  outubro: 10, out: 10,
  novembro: 11, nov: 11,
  dezembro: 12, dez: 12,
};

/**
 * Lê o mês de um número OU de um nome.
 *
 * A IA escreve "maio" com a mesma frequência com que escreve 5, e recusar o nome
 * perderia a linha inteira por causa do campo mais fácil de acertar.
 */
export function lerMes(v: unknown): number | null {
  if (typeof v === "number") {
    return Number.isInteger(v) && v >= 1 && v <= 12 ? v : null;
  }
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return null;
  const n = Number(t);
  if (Number.isInteger(n) && n >= 1 && n <= 12) return n;
  return MESES_NOME[chaveNome(t)] ?? null;
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

function inteiro(v: unknown, minimo: number, padrao: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return padrao;
  return Math.max(minimo, Math.round(n));
}

/**
 * Converte o JSON da IA nas linhas brutas.
 *
 * O MÍNIMO é o destino: linha sem cidade não é viagem, e uma linha pela metade na
 * grade é pior do que uma linha a menos — o gestor conferiria o que não existe.
 */
export function parsePlanoViagens(bruto: unknown): PlanoLinhaBruta[] {
  const lista = Array.isArray(bruto)
    ? bruto
    : Array.isArray((bruto as Record<string, unknown> | null)?.viagens)
      ? ((bruto as Record<string, unknown>).viagens as unknown[])
      : [];

  const out: PlanoLinhaBruta[] = [];
  for (const item of lista) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const destino = texto(o.destino) ?? texto(o.cidade);
    if (!destino) continue;
    out.push({
      destino,
      mes: lerMes(o.mes ?? o.mesIda ?? o.mes_ida),
      noites: inteiro(o.noites ?? o.dias, 0, 1),
      pessoas: inteiro(o.pessoas, 1, 1),
      pessoasPorQuarto: ((): number | null => {
        const v = o.pessoasPorQuarto ?? o.pessoas_por_quarto;
        if (v == null || v === "") return null;
        return inteiro(v, 1, 2);
      })(),
      tipo: texto(o.tipo),
      modal: texto(o.modal),
      finalidade: texto(o.finalidade),
      junto: texto(o.junto) ?? texto(o.mesma_viagem),
    });
  }
  return out;
}

export interface Cadastro {
  id: string;
  nome: string;
}

export interface LinhaResolvida {
  destino: string;
  mesIda: number | null;
  noites: number;
  pessoas: number;
  pessoasPorQuarto: number | null;
  tipoId: string;
  modal: string | null;
  finalidade: string | null;
}

export interface ResolucaoPlano {
  linhas: LinhaResolvida[];
  /** O que não casou com cadastro, uma frase por caso, sem repetir. */
  avisos: string[];
}

function casar(cadastro: readonly Cadastro[], nome: string | null): Cadastro | null {
  if (!nome) return null;
  const k = chaveNome(nome);
  return (
    cadastro.find((c) => chaveNome(c.nome) === k) ??
    // Casamento por CONTINÊNCIA depois do exato: a IA escreve "Nordeste" para
    // "Capital Nordeste" com frequência, e recusar perderia a faixa da linha.
    cadastro.find((c) => chaveNome(c.nome).includes(k) || k.includes(chaveNome(c.nome))) ??
    null
  );
}

/**
 * Casa os nomes com os cadastros e devolve as linhas da grade.
 *
 * Quem não casa cai no PADRÃO (o primeiro do cadastro) e gera aviso — a linha
 * aparece preenchida e o gestor corrige, em vez de a leitura descartar metade do
 * plano e ele não saber o que faltou.
 */
export function resolverPlano(
  brutas: readonly PlanoLinhaBruta[],
  cadastros: { tipos: readonly Cadastro[] },
): ResolucaoPlano {
  const avisos = new Set<string>();
  const linhas: LinhaResolvida[] = [];

  for (const b of brutas) {
    const tipo = casar(cadastros.tipos, b.tipo) ?? cadastros.tipos[0] ?? null;
    if (!tipo) {
      avisos.add("Não há tipo de viagem cadastrado — as linhas vieram sem tipo.");
    } else if (b.tipo && chaveNome(tipo.nome) !== chaveNome(b.tipo)) {
      avisos.add(`Tipo "${b.tipo}" não existe; usei "${tipo.nome}".`);
    }

    if (b.mes == null) {
      avisos.add(`"${b.destino}" veio sem mês — escolha na linha antes de enviar.`);
    }

    linhas.push({
      destino: b.destino,
      mesIda: b.mes,
      noites: b.noites,
      pessoas: b.pessoas,
      pessoasPorQuarto: b.pessoasPorQuarto,
      tipoId: tipo?.id ?? "",
      modal: b.modal,
      finalidade: b.finalidade,
    });
  }

  // Cidades de uma MESMA ida: viraram linhas separadas, e cada linha leva uma
  // passagem. O aviso nomeia as cidades em vez de a tela mostrar duas passagens
  // que o gestor não pediu.
  const juntas = new Map<string, string[]>();
  for (const b of brutas) {
    if (!b.junto) continue;
    const k = chaveNome(b.junto);
    juntas.set(k, [...(juntas.get(k) ?? []), b.destino]);
  }
  for (const destinos of Array.from(juntas.values())) {
    if (destinos.length < 2) continue;
    avisos.add(
      `${destinos.join(" e ")} vieram como uma ida só — a grade tem uma cidade por linha, ` +
        "então a passagem está contada em cada uma. Ajuste na linha ou monte a viagem multi-destino.",
    );
  }

  return { linhas, avisos: Array.from(avisos) };
}
