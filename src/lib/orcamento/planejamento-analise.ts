// =============================================================================
// Leitura crítica da BASE do Planejamento dos gestores (Etapa 1).
//
// A base é semeada automaticamente com os fornecedores do ano anterior vindos
// da Omie. Isso é conveniente, mas arrasta o lixo da contabilidade para dentro
// do orçamento: o mesmo gasto com duas grafias ("Google ADS" e "Gogle ADS"),
// nomes de pessoa física, e centavos que não movem o total. Quem só confirma
// item a item não enxerga esses padrões — eles só aparecem olhando o CONJUNTO.
//
// Estas mesmas observações a IA faz na abertura da entrevista. Aqui elas chegam
// ANTES, para o administrador limpar a base em vez de levar o problema para a
// conversa com o gestor.
//
// REGRA: são HIPÓTESES, nunca vereditos. A função aponta e explica; nada é
// removido, somado ou alterado por conta disso — a decisão é de quem lê.
//
// Módulo puro (sem I/O): dá para conferir cada regra sem subir a tela.
// =============================================================================

export type AlertaBaseTipo = "duplicata" | "concentracao" | "irrisorio";

export interface AlertaBase {
  tipo: AlertaBaseTipo;
  /** Chaves dos itens envolvidos, para destacar as linhas na tabela. */
  keys: string[];
  /** Texto pronto, já em tom de pergunta. */
  texto: string;
}

export interface ItemAnalise {
  key: string;
  descricao: string;
  /** Total do ano do item (já com a periodicidade aplicada). */
  totalAno: number;
}

/** Só letras, números e espaços — sem acento e sem caixa. */
function normalizar(s: string): string {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Distância de edição, com corte: acima de `teto` não interessa quanto é. */
function distancia(a: string, b: string, teto: number): number {
  if (Math.abs(a.length - b.length) > teto) return teto + 1;
  let anterior = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const atual = [i];
    let menor = i;
    for (let j = 1; j <= b.length; j += 1) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(atual[j - 1] + 1, anterior[j] + 1, anterior[j - 1] + custo);
      atual.push(v);
      if (v < menor) menor = v;
    }
    // Linha inteira já acima do teto: não há como voltar para baixo dele.
    if (menor > teto) return teto + 1;
    anterior = atual;
  }
  return anterior[b.length];
}

/**
 * Dois nomes descrevem provavelmente o MESMO gasto?
 *
 * Dois sinais, ambos observados em base real:
 *  - erro de digitação: "Gogle ADS" x "Google ADS" (1 caractere de diferença);
 *  - nome truncado: "LUCAS EDUARDO FERREIRA" x "LUCAS EDUARDO FERREIRA BERNARDES
 *    - CC BB" (um é o começo do outro, como o fornecedor vem da Omie).
 *
 * O piso de 8 caracteres evita casar siglas curtas ("TV", "ADS") por acidente.
 */
export function pareceMesmoItem(a: string, b: string): boolean {
  const x = normalizar(a);
  const y = normalizar(b);
  if (!x || !y) return false;
  if (x === y) return true;

  const curto = x.length <= y.length ? x : y;
  const longo = x.length <= y.length ? y : x;
  if (curto.length < 8) return false;

  // Um começa com o outro (nome truncado / com sufixo de conta, filial etc.).
  if (longo.startsWith(curto)) return true;

  // Erro de digitação: tolerância cresce um pouco com o tamanho, mas nunca a
  // ponto de casar palavras diferentes ("Google Ads" x "Google Analytics").
  const teto = curto.length >= 16 ? 2 : 1;
  return distancia(x, y, teto) <= teto;
}

/** Fração do total abaixo da qual um item não muda o orçamento. */
const FRACAO_IRRISORIO = 0.01;
/** Fração do total a partir da qual um item domina a categoria. */
const FRACAO_CONCENTRACAO = 0.5;

function brl(v: number): string {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function pct(parte: number, total: number): string {
  if (total <= 0) return "—";
  const p = (parte / total) * 100;
  // Arredondar 0,4% para "0%" faria o alerta dizer que o item não existe.
  return p < 1 ? "menos de 1%" : `${Math.round(p)}%`;
}

/**
 * Observações sobre a base, em ordem de utilidade: primeiro o que provavelmente
 * é erro (duplicata), depois o que orienta a conversa (concentração), por
 * último o que é ruído (irrisório).
 *
 * Só entram itens INCLUÍDOS — o que já está desmarcado saiu da base por decisão
 * de alguém e não merece alerta.
 */
export function analisarBase(itens: ItemAnalise[]): AlertaBase[] {
  const validos = itens.filter((i) => i.descricao.trim() !== "");
  if (validos.length === 0) return [];

  const total = validos.reduce((acc, i) => acc + i.totalAno, 0);
  const alertas: AlertaBase[] = [];

  // ── Duplicatas prováveis (cada par citado uma vez só) ──────────────────────
  const jaCitado = new Set<string>();
  for (let i = 0; i < validos.length; i += 1) {
    for (let j = i + 1; j < validos.length; j += 1) {
      const a = validos[i];
      const b = validos[j];
      const par = `${a.key}|${b.key}`;
      if (jaCitado.has(par)) continue;
      if (!pareceMesmoItem(a.descricao, b.descricao)) continue;
      jaCitado.add(par);
      alertas.push({
        tipo: "duplicata",
        keys: [a.key, b.key],
        texto:
          `“${a.descricao.trim()}” e “${b.descricao.trim()}” parecem o mesmo gasto ` +
          `(${brl(a.totalAno)} e ${brl(b.totalAno)} no ano). São itens diferentes?`,
      });
    }
  }

  // ── Concentração ──────────────────────────────────────────────────────────
  if (total > 0 && validos.length > 1) {
    const maior = validos.reduce((m, i) => (i.totalAno > m.totalAno ? i : m), validos[0]);
    if (maior.totalAno / total >= FRACAO_CONCENTRACAO) {
      alertas.push({
        tipo: "concentracao",
        keys: [maior.key],
        texto:
          `“${maior.descricao.trim()}” sozinho é ${pct(maior.totalAno, total)} da categoria ` +
          `(${brl(maior.totalAno)} de ${brl(total)}). Vale começar a conversa por ele.`,
      });
    }
  }

  // ── Itens irrisórios (agrupados num alerta só) ─────────────────────────────
  if (total > 0 && validos.length > 2) {
    const miudos = validos.filter((i) => i.totalAno > 0 && i.totalAno / total < FRACAO_IRRISORIO);
    if (miudos.length > 0) {
      const soma = miudos.reduce((acc, i) => acc + i.totalAno, 0);
      const nomes = miudos.map((i) => `“${i.descricao.trim()}”`).join(", ");
      alertas.push({
        tipo: "irrisorio",
        keys: miudos.map((i) => i.key),
        texto:
          `${miudos.length === 1 ? "Item que não move" : "Itens que não movem"} o total: ${nomes} — ` +
          `${brl(soma)} no ano, ${pct(soma, total)} da categoria. Ainda faz sentido orçar à parte?`,
      });
    }
  }

  const ordem: Record<AlertaBaseTipo, number> = { duplicata: 0, concentracao: 1, irrisorio: 2 };
  return alertas.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]);
}
