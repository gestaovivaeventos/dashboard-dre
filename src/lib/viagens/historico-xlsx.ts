import { lerMes } from "@/lib/viagens/plano";

// =============================================================================
// Leitura da planilha de HISTÓRICO DE VIAGENS REALIZADAS.
//
// Formato (uma linha por viagem que aconteceu):
//   Cidade | Mês | Pessoas | Noites | Pessoas por quarto | Modal
//          | Passagem | Hospedagem | Alimentação | Observação
//
// A ordem das colunas é livre e o cabeçalho é procurado nas primeiras linhas —
// planilha real tem título e linhas em branco antes dele. Mesma convenção dos
// grupos de despesa e do plano de cargos, de propósito: quem já importou um sabe
// importar o outro.
//
// ── PESSOAS é obrigatório, e isso não é rigor gratuito ───────────────────
// Todo o valor do histórico está em virar custo UNITÁRIO. Assumir 1 pessoa numa
// viagem de 4 multiplicaria a referência por quatro — um erro que sai plausível e
// que ninguém pegaria olhando o orçamento. Linha sem pessoas é recusada com o
// motivo, nunca completada por padrão.
//
// ── Falha POR LINHA, nunca pelo arquivo ──────────────────────────────────
// Uma linha torta no meio de 200 não pode custar as 199 certas, e a recusada
// volta com o número da linha.
//
// Módulo PURO (sem I/O): recebe a matriz de células.
// =============================================================================

export interface HistoricoXlsxRow {
  /** Linha na planilha (1-based), para apontar o problema ao usuário. */
  linha: number;
  cidade: string;
  mes: number | null;
  pessoas: number;
  noites: number;
  pessoasPorQuarto: number | null;
  modal: string | null;
  custoPassagem: number | null;
  custoHospedagem: number | null;
  custoAlimentacao: number | null;
  observacao: string | null;
}

export interface HistoricoXlsxParse {
  rows: HistoricoXlsxRow[];
  /** Linhas descartadas ou com ressalva, já com o motivo. */
  problemas: string[];
}

/** Comparação tolerante de cabeçalho: sem acento, sem caixa, sem espaço duplo. */
export function chaveCabecalho(valor: unknown): string {
  return String(valor ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Lê dinheiro de uma célula: número, "1.180,00", "R$ 1.180,00", "1180.00".
 *
 * É uma cópia da regra que o DP usa na tabela salarial, e de propósito: o DP é
 * módulo sigiloso e isolado, e importar dele para o Orçamento acoplaria os dois
 * por causa de oito linhas. Tem contrato próprio e teste próprio.
 */
export function lerDinheiro(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v ?? "")
    .replace(/R\$/i, "")
    .replace(/\s/g, "");
  if (!s) return null;
  // Com vírgula, ela é o decimal e o ponto é milhar; sem vírgula, o ponto decide.
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  if (!/^-?\d+(\.\d+)?$/.test(normal)) return null;
  const n = Number(normal);
  return Number.isFinite(n) ? n : null;
}

function lerInteiro(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s.replace(",", "."));
  return Number.isFinite(n) ? Math.round(n) : null;
}

const MODAIS: Record<string, string> = {
  aviao: "aviao",
  aviao_: "aviao",
  aereo: "aviao",
  avião: "aviao",
  voo: "aviao",
  onibus: "onibus",
  rodoviario: "onibus",
  bus: "onibus",
  carro: "carro",
  "carro proprio": "carro",
  veiculo: "carro",
  van: "van",
  fretado: "van",
  outro: "outro",
};

/** Normaliza o modal escrito à mão. Desconhecido vira null, nunca um chute. */
export function lerModal(v: unknown): string | null {
  const k = chaveCabecalho(v).replace(/-/g, " ");
  if (!k) return null;
  return MODAIS[k] ?? MODAIS[k.replace(/\s/g, "")] ?? null;
}

type Campo =
  | "cidade"
  | "mes"
  | "pessoas"
  | "noites"
  | "pessoasPorQuarto"
  | "modal"
  | "passagem"
  | "hospedagem"
  | "alimentacao"
  | "observacao";

const ALIAS: Record<Campo, string[]> = {
  cidade: ["cidade", "destino", "cidades", "destinos", "local"],
  mes: ["mes", "mês", "mes da viagem", "periodo", "período"],
  pessoas: ["pessoas", "qtd pessoas", "quantidade de pessoas", "pax", "viajantes", "n pessoas"],
  noites: ["noites", "qtd noites", "pernoites", "diarias", "diárias", "n noites"],
  pessoasPorQuarto: [
    "pessoas por quarto",
    "por quarto",
    "pessoas quarto",
    "ocupacao",
    "ocupação",
  ],
  modal: ["modal", "transporte", "meio de transporte", "como foi", "via"],
  passagem: ["passagem", "passagens", "passagem total", "aereo", "aéreo", "transporte intercidades"],
  hospedagem: ["hospedagem", "hotel", "hospedagem total", "hoteis", "hotéis"],
  alimentacao: ["alimentacao", "alimentação", "refeicoes", "refeições", "alimentacao total"],
  observacao: ["observacao", "observação", "obs", "observacoes", "observações", "nota"],
};

interface Cabecalho {
  linha: number;
  cols: Record<Campo, number>;
}

function colsVazias(): Record<Campo, number> {
  return {
    cidade: -1,
    mes: -1,
    pessoas: -1,
    noites: -1,
    pessoasPorQuarto: -1,
    modal: -1,
    passagem: -1,
    hospedagem: -1,
    alimentacao: -1,
    observacao: -1,
  };
}

/**
 * Procura o cabeçalho nas primeiras 20 linhas.
 *
 * O mínimo é CIDADE + PESSOAS: sem os dois não há como normalizar nada, e aceitar
 * a planilha para depois recusar todas as linhas seria pior do que dizer logo o
 * que falta.
 */
function acharCabecalho(data: unknown[][]): Cabecalho | null {
  const limite = Math.min(data.length, 20);
  for (let i = 0; i < limite; i += 1) {
    const row = data[i] ?? [];
    const cols = colsVazias();
    row.forEach((celula, idx) => {
      const chave = chaveCabecalho(celula);
      if (!chave) return;
      (Object.keys(ALIAS) as Campo[]).forEach((campo) => {
        if (cols[campo] === -1 && ALIAS[campo].includes(chave)) cols[campo] = idx;
      });
    });
    if (cols.cidade >= 0 && cols.pessoas >= 0) return { linha: i, cols };
  }
  return null;
}

export function parseHistoricoXlsx(
  data: unknown[][],
): { parse: HistoricoXlsxParse } | { erro: string } {
  const cabecalho = acharCabecalho(data);
  if (!cabecalho) {
    return {
      erro:
        "Não encontrei o cabeçalho da planilha. Ela precisa ter, no mínimo, as colunas Cidade e Pessoas.",
    };
  }

  const { linha: headerIdx, cols } = cabecalho;
  const rows: HistoricoXlsxRow[] = [];
  const problemas: string[] = [];

  const celula = (row: unknown[], campo: Campo): unknown =>
    cols[campo] >= 0 ? row[cols[campo]] : undefined;

  for (let i = headerIdx + 1; i < data.length; i += 1) {
    const row = data[i] ?? [];
    const numeroLinha = i + 1;

    const cidade = String(celula(row, "cidade") ?? "").trim();
    const passagem = lerDinheiro(celula(row, "passagem"));
    const hospedagem = lerDinheiro(celula(row, "hospedagem"));
    const alimentacao = lerDinheiro(celula(row, "alimentacao"));
    const pessoas = lerInteiro(celula(row, "pessoas"));
    const noites = lerInteiro(celula(row, "noites"));

    const vazia =
      !cidade &&
      pessoas == null &&
      noites == null &&
      passagem == null &&
      hospedagem == null &&
      alimentacao == null;
    // Linha totalmente vazia é separador, não erro.
    if (vazia) continue;

    if (!cidade) {
      problemas.push(`Linha ${numeroLinha}: sem cidade.`);
      continue;
    }
    // Sem pessoas não há custo unitário, e assumir 1 multiplicaria a referência
    // pelo tamanho do grupo — erro plausível e invisível.
    if (pessoas == null || pessoas < 1) {
      problemas.push(`Linha ${numeroLinha} (${cidade}): sem o número de pessoas.`);
      continue;
    }
    if ((passagem ?? 0) <= 0 && (hospedagem ?? 0) <= 0 && (alimentacao ?? 0) <= 0) {
      problemas.push(`Linha ${numeroLinha} (${cidade}): sem nenhum custo informado.`);
      continue;
    }

    const noitesOk = noites == null || noites < 0 ? 0 : noites;
    if ((hospedagem ?? 0) > 0 && noitesOk === 0) {
      // Não descarta a linha: a passagem dela continua valendo. Mas avisa, porque
      // diária por noite com zero noite não existe e a hospedagem fica de fora.
      problemas.push(
        `Linha ${numeroLinha} (${cidade}): hospedagem informada com 0 noites — a diária dessa linha não entra.`,
      );
    }

    rows.push({
      linha: numeroLinha,
      cidade,
      mes: lerMes(celula(row, "mes")),
      pessoas,
      noites: noitesOk,
      pessoasPorQuarto: lerInteiro(celula(row, "pessoasPorQuarto")),
      modal: lerModal(celula(row, "modal")),
      custoPassagem: (passagem ?? 0) > 0 ? passagem : null,
      custoHospedagem: (hospedagem ?? 0) > 0 ? hospedagem : null,
      custoAlimentacao: (alimentacao ?? 0) > 0 ? alimentacao : null,
      observacao: String(celula(row, "observacao") ?? "").trim() || null,
    });
  }

  return { parse: { rows, problemas } };
}
