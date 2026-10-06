import { GRUPOS_COTACAO, type GrupoCotacao, type ValoresCotacao } from "@/lib/viagens/fluxo";

// =============================================================================
// Leitura da planilha de COTAÇÃO (06/10/2026).
//
// O arquivo é o mesmo que saiu do sistema, com as colunas de valor preenchidas por
// quem cotou (a Controladoria, com IA no cowork).
//
// ── O casamento é por ID, nunca por nome ─────────────────────────────────
// Duas idas a São Paulo em março colidiriam no nome, e casamento por nome já se
// queimou neste projeto mais de uma vez. A coluna ID sai no arquivo com o aviso de
// não apagá-la; linha sem ID volta recusada, com o número da linha.
//
// ── Em branco ≠ zero ─────────────────────────────────────────────────────
// Em branco é "não cotei este grupo"; zero é "cotei e não há este custo". Conflar os
// dois faria "não sei" entrar na conta como se fosse de graça.
//
// Módulo PURO e testado.
// =============================================================================

export interface CotacaoXlsxRow {
  /** Linha na planilha (1-based), para apontar o problema ao usuário. */
  linha: number;
  id: string;
  valores: ValoresCotacao;
  dataBase: string | null;
  observacao: string | null;
}

export interface CotacaoXlsxParse {
  rows: CotacaoXlsxRow[];
  /** Linhas descartadas, já com o motivo. */
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

/** Lê dinheiro: número, "1.180,00", "R$ 1.180,00", "1180.00". */
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

/** Aceita data do Excel (número de série), ISO e DD/MM/AAAA. */
export function lerData(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    // Serial do Excel: dias desde 30/12/1899 (o sistema de 1900, com o bug do ano
    // bissexto já embutido na época zero).
    const ms = Math.round(v) * 86_400_000 + Date.UTC(1899, 11, 30);
    return new Date(ms).toISOString().slice(0, 10);
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const br = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  return null;
}

/**
 * Como cada grupo é reconhecido no cabeçalho.
 *
 * O arquivo sai do sistema com os rótulos longos do motor ("Passagem / deslocamento
 * entre cidades"), mas a pessoa pode renomear a coluna ou montar a planilha à mão —
 * então o casamento é por palavra-chave, não por igualdade.
 */
const PISTAS: Record<GrupoCotacao, string[]> = {
  passagem: ["passagem", "aereo", "aerea", "deslocamento entre cidades"],
  translado: ["translado"],
  transporte_local: ["transporte local", "uber", "taxi", "local no destino"],
  hospedagem: ["hospedagem", "hotel"],
  alimentacao: ["alimentacao", "refeicao", "refeicoes"],
  outros: ["outros"],
};

interface Cabecalho {
  linha: number;
  id: number;
  grupos: Partial<Record<GrupoCotacao, number>>;
  dataBase: number;
  observacao: number;
}

function acharCabecalho(data: unknown[][]): Cabecalho | null {
  const limite = Math.min(data.length, 20);
  for (let i = 0; i < limite; i += 1) {
    const row = data[i] ?? [];
    let id = -1;
    let dataBase = -1;
    let observacao = -1;
    const grupos: Partial<Record<GrupoCotacao, number>> = {};

    row.forEach((celula, idx) => {
      const k = chaveCabecalho(celula);
      if (!k) return;
      if (id === -1 && /^id\b|^id$|^id \(/.test(k)) id = idx;
      if (dataBase === -1 && k.includes("data-base")) dataBase = idx;
      if (dataBase === -1 && k.includes("data base")) dataBase = idx;
      if (observacao === -1 && (k.includes("fonte") || k.startsWith("observa"))) observacao = idx;
      for (const g of GRUPOS_COTACAO) {
        if (grupos[g] != null) continue;
        // `transporte local` contém "local", e `passagem` aparece em
        // "passagem / deslocamento": a primeira pista que casar define a coluna, e
        // a ordem de GRUPOS_COTACAO garante que passagem seja testada antes.
        if (PISTAS[g].some((pista) => k.includes(pista))) grupos[g] = idx;
      }
    });

    const temAlgumGrupo = GRUPOS_COTACAO.some((g) => grupos[g] != null);
    if (id >= 0 && temAlgumGrupo) return { linha: i, id, grupos, dataBase, observacao };
  }
  return null;
}

export function parseCotacaoXlsx(
  data: unknown[][],
): { parse: CotacaoXlsxParse } | { erro: string } {
  const cab = acharCabecalho(data);
  if (!cab) {
    return {
      erro:
        "Não encontrei o cabeçalho. A planilha precisa da coluna ID e de ao menos uma coluna de valor (Passagem, Hospedagem…). Baixe o modelo pelo botão da tela.",
    };
  }

  const rows: CotacaoXlsxRow[] = [];
  const problemas: string[] = [];
  const vistos = new Set<string>();

  for (let i = cab.linha + 1; i < data.length; i += 1) {
    const row = data[i] ?? [];
    const numeroLinha = i + 1;
    const id = String(row[cab.id] ?? "").trim();

    const valores: ValoresCotacao = {};
    let algumValor = false;
    for (const g of GRUPOS_COTACAO) {
      const col = cab.grupos[g];
      if (col == null) {
        valores[g] = null;
        continue;
      }
      const bruto = row[col];
      const vazio = bruto === "" || bruto === null || bruto === undefined;
      if (vazio) {
        valores[g] = null;
        continue;
      }
      const n = lerDinheiro(bruto);
      if (n == null) {
        problemas.push(`Linha ${numeroLinha}: valor ilegível em "${g}" (${String(bruto)}).`);
        valores[g] = null;
        continue;
      }
      valores[g] = n;
      algumValor = true;
    }

    if (!id) {
      // Linha inteiramente vazia é separador, não erro.
      if (!algumValor) continue;
      problemas.push(`Linha ${numeroLinha}: tem valores mas está sem o ID da viagem.`);
      continue;
    }
    if (vistos.has(id)) {
      problemas.push(`Linha ${numeroLinha}: o ID aparece mais de uma vez na planilha.`);
      continue;
    }
    vistos.add(id);

    const negativo = GRUPOS_COTACAO.some((g) => {
      const v = valores[g];
      return typeof v === "number" && v < 0;
    });
    if (negativo) {
      problemas.push(`Linha ${numeroLinha}: valor negativo.`);
      continue;
    }

    rows.push({
      linha: numeroLinha,
      id,
      valores,
      dataBase: cab.dataBase >= 0 ? lerData(row[cab.dataBase]) : null,
      observacao:
        cab.observacao >= 0 ? String(row[cab.observacao] ?? "").trim() || null : null,
    });
  }

  return { parse: { rows, problemas } };
}
