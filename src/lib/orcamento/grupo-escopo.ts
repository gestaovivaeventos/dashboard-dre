// =============================================================================
// Gravação do ESCOPO de grupo (`orcamento_grupo_escopo`) sem duplicar.
//
// ── Por que não dá para usar `upsert({ ignoreDuplicates: true })` ──────────
// Duas razões independentes, e cada uma sozinha já quebra:
//
//  1. A tabela NÃO TEM primary key. O PostgREST, sem `on_conflict`, usa a PK
//     como alvo do `ON CONFLICT` — sem PK não há alvo, e o lote inteiro morre
//     com 23505 assim que UMA linha já existe.
//  2. Nem passar `onConflict` resolveria: a chave é um índice por EXPRESSÃO
//     (`COALESCE(setor_id, '000…')`, porque setor nulo é valor legítimo), e
//     `ON CONFLICT (colunas)` não casa com índice de expressão.
//
// O efeito era silencioso e confuso: replicar/copiar/importar funcionava na
// PRIMEIRA vez (destino vazio) e falhava em todas as seguintes, porque o lote
// passava a incluir o que já havia sido gravado antes. Quem usava via "o botão
// não faz nada" — inclusive para os itens novos do lote, que iam junto.
//
// A dedupe é por LEITURA: busca o que já existe no escopo daquela empresa ×
// ano e insere só a diferença. Reexecutar continua sendo no-op, que é o
// comportamento que as três telas prometem (replicar, copiar de outra empresa
// e importar planilha).
// =============================================================================

// Import de TIPO apenas: as funções puras acima continuam sem dependência de
// servidor, e o client vem sempre de quem chama.
import type { SupabaseClient } from "@supabase/supabase-js";

/** O bastante para identificar uma linha de escopo. */
export interface EscopoChave {
  grupo_id: string;
  company_id: string;
  year: number;
  category_code: string;
  setor_id: string | null;
}

/**
 * Chave de comparação, espelhando o índice único do banco.
 *
 * O `?? ""` no setor corresponde ao `COALESCE(setor_id, '000…')` do índice:
 * setor nulo é UM valor, não "qualquer valor". Sem isso, dois escopos amplos
 * do mesmo grupo passariam como distintos aqui e colidiriam no banco.
 */
export function chaveEscopo(linha: EscopoChave): string {
  return [
    linha.grupo_id,
    linha.company_id,
    linha.year,
    linha.category_code,
    linha.setor_id ?? "",
  ].join("|");
}

/**
 * As linhas de `desejados` que ainda não existem, sem repetição interna.
 *
 * Deduplicar o próprio lote importa tanto quanto comparar com o banco: a
 * planilha pode trazer a mesma linha duas vezes, e a replicação monta o
 * produto (destinos × grupos) — dois caminhos que geram duplicata dentro do
 * mesmo INSERT, que falharia igual.
 */
export function escoposFaltantes<T extends EscopoChave>(
  desejados: readonly T[],
  existentes: readonly EscopoChave[],
): T[] {
  const jaTem = new Set(existentes.map(chaveEscopo));
  const saida: T[] = [];
  for (const linha of desejados) {
    const chave = chaveEscopo(linha);
    if (jaTem.has(chave)) continue;
    jaTem.add(chave);
    saida.push(linha);
  }
  return saida;
}

/**
 * Insere no escopo só o que falta, e devolve quantas linhas entraram de fato.
 *
 * Todas as chamadas do sistema gravam numa única (empresa, ano), então a
 * leitura do que já existe é um filtro simples — sem `in()` de centenas de
 * ids na querystring.
 */
export async function inserirEscoposFaltantes<T extends EscopoChave>(
  supabase: SupabaseClient,
  companyId: string,
  year: number,
  desejados: readonly T[],
): Promise<{ inseridos: number; error?: string }> {
  if (desejados.length === 0) return { inseridos: 0 };

  const { data, error: lerErr } = await supabase
    .from("orcamento_grupo_escopo")
    .select("grupo_id, company_id, year, category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (lerErr) return { inseridos: 0, error: lerErr.message };

  const existentes = ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
    grupo_id: r.grupo_id as string,
    company_id: r.company_id as string,
    year: Number(r.year),
    category_code: r.category_code as string,
    setor_id: (r.setor_id as string | null) ?? null,
  }));

  const faltantes = escoposFaltantes(desejados, existentes);
  if (faltantes.length === 0) return { inseridos: 0 };

  const { error } = await supabase.from("orcamento_grupo_escopo").insert(faltantes);
  if (error) return { inseridos: 0, error: error.message };
  return { inseridos: faltantes.length };
}
