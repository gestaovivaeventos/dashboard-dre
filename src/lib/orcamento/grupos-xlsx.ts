// Leitura da planilha de GRUPOS DE DESPESA.
//
// Formato esperado (uma linha por grupo em cada ponto da árvore):
//   Setor | Categoria | Grupo
//
// A ordem das colunas é livre e o cabeçalho é procurado nas primeiras linhas —
// planilha real costuma ter título e linhas em branco antes dele. Mesma
// convenção do Plano de Cargos, de propósito: quem já importou um sabe importar
// o outro.
//
// SETOR VAZIO é um valor legítimo, não um erro: significa "esta categoria em
// QUALQUER setor". É o escopo com `setor_id` nulo (ver a migration
// 20260927120000) e o atalho para quem quer o mesmo grupo em toda a empresa
// sem repetir a linha por setor.
//
// Módulo puro (sem I/O): recebe a matriz de células e devolve as linhas, para
// o parsing poder ser conferido sem banco.

export interface GrupoXlsxRow {
  /** Linha na planilha (1-based), para apontar o problema ao usuário. */
  linha: number;
  /** Vazio = vale para qualquer setor. */
  setor: string;
  categoria: string;
  grupo: string;
}

export interface GruposXlsxParse {
  rows: GrupoXlsxRow[];
  /** Linhas descartadas na leitura, já com o motivo. */
  problemas: string[];
}

/** Comparação tolerante: sem acento, sem caixa, sem espaço duplicado. */
export function normalizarChave(valor: unknown): string {
  return String(valor ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

const ALIAS: Record<keyof Omit<GrupoXlsxRow, "linha">, string[]> = {
  setor: ["setor", "setores", "area", "área", "departamento"],
  categoria: ["categoria", "categorias", "categoria de despesa", "conta"],
  grupo: ["grupo", "grupos", "grupo de despesa", "grupo de despesas", "subgrupo", "tipo"],
};

interface Cabecalho {
  linha: number;
  cols: { setor: number; categoria: number; grupo: number };
}

/**
 * Procura o cabeçalho nas primeiras 20 linhas.
 *
 * Categoria e Grupo são obrigatórias; Setor é opcional — planilha sem essa
 * coluna cadastra tudo como "qualquer setor", que é o comportamento amplo.
 */
function acharCabecalho(data: unknown[][]): Cabecalho | null {
  const limite = Math.min(data.length, 20);
  for (let i = 0; i < limite; i += 1) {
    const row = data[i] ?? [];
    const cols = { setor: -1, categoria: -1, grupo: -1 };
    row.forEach((celula, idx) => {
      const chave = normalizarChave(celula);
      if (!chave) return;
      (Object.keys(ALIAS) as (keyof typeof ALIAS)[]).forEach((campo) => {
        if (cols[campo] === -1 && ALIAS[campo].includes(chave)) cols[campo] = idx;
      });
    });
    if (cols.categoria >= 0 && cols.grupo >= 0) return { linha: i, cols };
  }
  return null;
}

export function parseGruposXlsx(
  data: unknown[][],
): { parse: GruposXlsxParse } | { erro: string } {
  const cabecalho = acharCabecalho(data);
  if (!cabecalho) {
    return {
      erro:
        "Não encontrei o cabeçalho da planilha. Ela precisa ter as colunas Categoria e Grupo (Setor é opcional).",
    };
  }

  const { linha: headerIdx, cols } = cabecalho;
  const rows: GrupoXlsxRow[] = [];
  const problemas: string[] = [];
  // Repetir a mesma linha não é erro — planilha montada à mão repete —, mas
  // gravar duas vezes o mesmo escopo é ruído. Some em silêncio.
  const vistos = new Set<string>();

  for (let i = headerIdx + 1; i < data.length; i += 1) {
    const row = data[i] ?? [];
    const numeroLinha = i + 1;

    const setor = cols.setor >= 0 ? String(row[cols.setor] ?? "").trim() : "";
    const categoria = String(row[cols.categoria] ?? "").trim();
    const grupo = String(row[cols.grupo] ?? "").trim();

    // Linha totalmente vazia é separador, não erro.
    if (!setor && !categoria && !grupo) continue;

    if (!categoria) {
      problemas.push(`Linha ${numeroLinha}: sem categoria.`);
      continue;
    }
    if (!grupo) {
      problemas.push(`Linha ${numeroLinha}: sem grupo.`);
      continue;
    }

    const chave = `${normalizarChave(setor)}|${normalizarChave(categoria)}|${normalizarChave(grupo)}`;
    if (vistos.has(chave)) continue;
    vistos.add(chave);

    rows.push({ linha: numeroLinha, setor, categoria, grupo });
  }

  return { parse: { rows, problemas } };
}

// ─── Casamento com o cadastro ────────────────────────────────────────────────

export interface RefSetor {
  id: string;
  name: string;
}

/** Categoria do mapeamento: casa por NOME ou por CÓDIGO. */
export interface RefCategoria {
  categoryCode: string;
  categoryName: string;
}

/** Uma linha da planilha já resolvida contra o cadastro. */
export interface GrupoResolvido {
  linha: number;
  /** Nulo = vale para qualquer setor (coluna Setor vazia). */
  setorId: string | null;
  setorNome: string;
  categoryCode: string;
  categoryName: string;
  grupo: string;
}

export interface ResolucaoGrupos {
  resolvidas: GrupoResolvido[];
  /** Linhas que não casaram, com o motivo — a planilha não é rejeitada por elas. */
  problemas: string[];
}

/**
 * Resolve setor e categoria contra o cadastro da empresa.
 *
 * Falha por LINHA, não pela planilha inteira: um setor escrito errado no meio
 * de 200 linhas não pode impedir as 199 corretas de entrar. As que falham
 * voltam descritas, para o admin corrigir e reenviar só elas.
 */
export function resolverGrupos(
  rows: readonly GrupoXlsxRow[],
  setores: readonly RefSetor[],
  categorias: readonly RefCategoria[],
): ResolucaoGrupos {
  const porNomeSetor = new Map(setores.map((s) => [normalizarChave(s.name), s]));
  const porNomeCategoria = new Map(categorias.map((c) => [normalizarChave(c.categoryName), c]));
  const porCodigoCategoria = new Map(categorias.map((c) => [normalizarChave(c.categoryCode), c]));

  const resolvidas: GrupoResolvido[] = [];
  const problemas: string[] = [];

  rows.forEach((r) => {
    let setorId: string | null = null;
    let setorNome = "";
    if (r.setor) {
      const achado = porNomeSetor.get(normalizarChave(r.setor));
      if (!achado) {
        problemas.push(`Linha ${r.linha}: setor "${r.setor}" não existe nesta empresa e ano.`);
        return;
      }
      setorId = achado.id;
      setorNome = achado.name;
    }

    const chaveCat = normalizarChave(r.categoria);
    const cat = porNomeCategoria.get(chaveCat) ?? porCodigoCategoria.get(chaveCat);
    if (!cat) {
      problemas.push(
        `Linha ${r.linha}: categoria "${r.categoria}" não encontrada (use o nome ou o código).`,
      );
      return;
    }

    resolvidas.push({
      linha: r.linha,
      setorId,
      setorNome,
      categoryCode: cat.categoryCode,
      categoryName: cat.categoryName,
      grupo: r.grupo,
    });
  });

  return { resolvidas, problemas };
}
