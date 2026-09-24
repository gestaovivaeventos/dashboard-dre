"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { autorizarLeitura, setoresDeEscrita } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { orcaPorSetor } from "@/lib/orcamento/setor-gravacao";
import { getCategoriaMetodo } from "@/lib/orcamento/actions/categoria-metodo";
import {
  apenasCanonicas,
  categoriaTotal,
  codigosIrmaos,
  toPeriodicidade,
} from "@/lib/orcamento/planejamento-calc";
import { fetchRealizados, totalGastoAno } from "@/lib/orcamento/media-realizado";

// =============================================================================
// Planejamento dos gestores — LISTA (a primeira tela do método).
//
// O caminho é: escolher os SETORES → ver as CATEGORIAS que podem ser orçadas
// por esta via → entrar numa delas para montar o orçamento.
//
// Duas regras de desenho que valem a pena lembrar antes de mexer:
//
//  - O card é POR CATEGORIA, não por categoria × setor (decisão do dono do
//    projeto em 23/09/2026). Com vários setores selecionados, a mesma
//    "Marketing" aparece UMA vez, somando os setores escolhidos; o setor de
//    cada despesa é escolhido dentro da tela de montagem.
//
//  - O escopo de leitura é o do MÓDULO, não desta tela: `autorizarLeitura`
//    devolve `setores = null` para quem alcança todos (admin, diretoria,
//    Gerente Sócio) e a lista dos setores vinculados para o Gerente. Um gerente
//    sem a ponte `ctrl_sector_id` preenchida vê NADA, nunca tudo — falhar
//    escondendo é deliberado (ver auth.ts).
// =============================================================================

/** Setor oferecido no filtro do topo. */
export interface PlanejamentoSetorOption {
  id: string;
  name: string;
  /** O usuário pode GRAVAR neste setor (ou só olhar)? */
  podeEscrever: boolean;
}

export interface PlanejamentoSetoresResult {
  /** Empresa orça por setor neste ano? Falso = o filtro nem aparece. */
  orcaPorSetor: boolean;
  items: PlanejamentoSetorOption[];
  error?: string;
  needsMigration?: boolean;
}

/** Presença de uma categoria num setor selecionado (o rodapé do card). */
export interface PlanejamentoCardSetor {
  setorId: string | null;
  setorNome: string;
  /** Base do ano anterior finalizada pelo admin neste setor. */
  baseSalva: boolean;
  despesas: number;
  total: number;
}

export interface PlanejamentoCategoriaCard {
  categoryCode: string;
  categoryName: string;
  dreLineCode: string;
  dreLineName: string;
  /** Soma das despesas ATIVAS (não canceladas) dos setores selecionados. */
  totalOrcado: number;
  despesas: number;
  /** Total gasto no ano anterior, já somando as categorias irmãs "(*)". */
  realizadoAnterior: number | null;
  /** Setores (entre os selecionados) em que esta categoria está atribuída. */
  setores: PlanejamentoCardSetor[];
  /** Base finalizada em TODOS os setores onde a categoria existe. */
  basePronta: boolean;
}

/**
 * Setores do filtro. Lista só os ATIVOS: o filtro é para trabalhar, e setor
 * inativo não recebe orçamento novo. Quem alcança tudo vê todos; o Gerente vê
 * os dele.
 */
export async function getPlanejamentoSetores(
  companyId: string,
  year: number,
): Promise<PlanejamentoSetoresResult> {
  if (!companyId) return { orcaPorSetor: false, items: [] };
  if (!isValidBudgetYear(year)) {
    return { orcaPorSetor: false, items: [], error: "Ano do orçamento inválido." };
  }

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { orcaPorSetor: false, items: [], error: auth.error };

  const porSetor = await orcaPorSetor(supabase, companyId, year);
  if (!porSetor) return { orcaPorSetor: false, items: [] };

  const { data, error } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("active", true)
    .order("name");
  if (error) {
    if (isSchemaMissing(error.message)) return { orcaPorSetor: true, items: [], needsMigration: true };
    return { orcaPorSetor: true, items: [], error: error.message };
  }

  const visiveis = auth.setores === null ? (data ?? []) : (data ?? []).filter((r) => auth.setores!.includes(r.id as string));
  const escrita = await setoresDeEscrita(supabase, auth.user, companyId, year);

  return {
    orcaPorSetor: true,
    items: visiveis.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      podeEscrever: escrita === null || escrita.includes(r.id as string),
    })),
  };
}

/**
 * Categorias orçáveis por esta via, nos setores selecionados.
 *
 * `setorIds` vazio significa "nenhum setor escolhido" e devolve lista vazia —
 * NÃO "todos". É a mesma convenção do filtro do Caixa: conflar vazio com tudo
 * faz a tela mostrar o consolidado no momento em que o usuário desmarca a
 * última caixa, que é o oposto do que ele pediu. Empresa que não orça por setor
 * ignora o parâmetro (não há setor para escolher).
 */
export async function getPlanejamentoCategorias(
  companyId: string,
  year: number,
  setorIds: string[],
): Promise<{ items?: PlanejamentoCategoriaCard[]; error?: string; needsMigration?: boolean }> {
  if (!companyId) return { items: [] };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = createAdminClientIfAvailable() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };

  const porSetor = await orcaPorSetor(supabase, companyId, year);
  // Recorte final: a interseção entre o que ele pediu e o que ele alcança. Sem
  // isto, um setorId digitado na URL passaria por cima do escopo do papel.
  const escopo =
    auth.setores === null ? setorIds : setorIds.filter((id) => auth.setores!.includes(id));
  if (porSetor && escopo.length === 0) return { items: [] };

  // ── Categorias marcadas com o método ──────────────────────────────────────
  const cats = await getCategoriaMetodo(companyId, year);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const doMetodo = apenasCanonicas(
    (cats.items ?? []).filter((c) => c.metodo === "planejamento_socios"),
  );
  if (doMetodo.length === 0) return { items: [] };

  // ── Quais categorias estão atribuídas a cada setor selecionado ────────────
  // `orcamento_categoria_setores` é o que impede "toda categoria × todo setor"
  // virar card. Empresa sem orçar por setor não tem atribuição: tudo vale.
  const presencaPorCategoria = new Map<string, Set<string>>();
  const nomeSetor = new Map<string, string>();
  if (porSetor) {
    const { data: atrib, error: atribErr } = await supabase
      .from("orcamento_categoria_setores")
      .select("category_code, setor_id")
      .eq("company_id", companyId)
      .eq("year", year)
      .in("setor_id", escopo);
    if (atribErr && !isSchemaMissing(atribErr.message)) return { error: atribErr.message };
    (atrib ?? []).forEach((r) => {
      const code = r.category_code as string;
      const setor = r.setor_id as string;
      if (!presencaPorCategoria.has(code)) presencaPorCategoria.set(code, new Set());
      presencaPorCategoria.get(code)!.add(setor);
    });

    const { data: setoresRows } = await supabase
      .from("orcamento_setores")
      .select("id, name")
      .in("id", escopo);
    (setoresRows ?? []).forEach((r) => nomeSetor.set(r.id as string, r.name as string));
  }

  const categorias = porSetor
    ? doMetodo.filter((c) => (presencaPorCategoria.get(c.categoryCode)?.size ?? 0) > 0)
    : doMetodo;
  if (categorias.length === 0) return { items: [] };

  // ── Despesas já orçadas ───────────────────────────────────────────────────
  const codes = categorias.map((c) => c.categoryCode);
  let despQuery = supabase
    .from("orcamento_planejamento_despesas")
    .select("category_code, setor_id, valor, periodicidade, mes_inicio, mes_fim, cancelado")
    .eq("company_id", companyId)
    .eq("year", year)
    .in("category_code", codes);
  if (porSetor) despQuery = despQuery.in("setor_id", escopo);
  const { data: despRows, error: despErr } = await despQuery;
  if (despErr) {
    if (isSchemaMissing(despErr.message)) return { needsMigration: true };
    return { error: despErr.message };
  }

  // Chave categoria|setor → despesas ativas. Cancelada pela diretoria continua
  // visível na tela de montagem, mas não entra em número nenhum.
  const porChave = new Map<
    string,
    { valorMensal: number; mesInicio: number; mesFim: number | null; periodicidade: ReturnType<typeof toPeriodicidade> }[]
  >();
  const contagem = new Map<string, number>();
  (despRows ?? []).forEach((r) => {
    if (r.cancelado === true) return;
    const chave = `${r.category_code as string}|${(r.setor_id as string | null) ?? ""}`;
    if (!porChave.has(chave)) porChave.set(chave, []);
    porChave.get(chave)!.push({
      valorMensal: Number(r.valor) || 0,
      mesInicio: Number(r.mes_inicio) || 1,
      mesFim: r.mes_fim == null ? null : Number(r.mes_fim),
      periodicidade: toPeriodicidade(r.periodicidade),
    });
    contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
  });

  // ── Estado da base (curadoria do admin), por categoria × setor ────────────
  let entrevQuery = supabase
    .from("orcamento_planejamento_entrevistas")
    .select("category_code, setor_id, base_salva")
    .eq("company_id", companyId)
    .eq("year", year)
    .in("category_code", codes);
  if (porSetor) entrevQuery = entrevQuery.in("setor_id", escopo);
  const { data: entrevRows } = await entrevQuery;
  const baseSalvaPorChave = new Set<string>();
  (entrevRows ?? []).forEach((r) => {
    if (r.base_salva === true) {
      baseSalvaPorChave.add(`${r.category_code as string}|${(r.setor_id as string | null) ?? ""}`);
    }
  });

  // ── Realizado do ano anterior, somando as irmãs "(*)" ─────────────────────
  const irmaosPorCat = new Map<string, string[]>();
  const todosCodigos = new Set<string>();
  categorias.forEach((c) => {
    const irmaos = codigosIrmaos(cats.items ?? [], c.categoryCode, c.categoryName);
    irmaosPorCat.set(c.categoryCode, irmaos);
    irmaos.forEach((code) => todosCodigos.add(code));
  });
  const realizados = await fetchRealizados(
    supabase,
    companyId,
    year - 1,
    Array.from(todosCodigos),
  );

  const items: PlanejamentoCategoriaCard[] = categorias.map((c) => {
    const setoresDaCategoria = porSetor
      ? Array.from(presencaPorCategoria.get(c.categoryCode) ?? [])
      : [""];

    const linhas: PlanejamentoCardSetor[] = setoresDaCategoria
      .map((setorId) => {
        const chave = `${c.categoryCode}|${setorId}`;
        const itens = porChave.get(chave) ?? [];
        return {
          setorId: setorId || null,
          setorNome: setorId ? (nomeSetor.get(setorId) ?? "Setor") : "",
          baseSalva: baseSalvaPorChave.has(chave),
          despesas: contagem.get(chave) ?? 0,
          total: categoriaTotal(itens),
        };
      })
      .sort((a, b) => a.setorNome.localeCompare(b.setorNome, "pt-BR", { sensitivity: "base" }));

    const irmaos = irmaosPorCat.get(c.categoryCode) ?? [c.categoryCode];
    // Total do ANO inteiro (não o dos meses fechados, que é o numerador da
    // Média): é o "quanto saiu no ano passado" que o gestor espera ver.
    const gastoAnterior = totalGastoAno(realizados, irmaos);

    return {
      categoryCode: c.categoryCode,
      categoryName: c.categoryName,
      dreLineCode: c.dreLineCode,
      dreLineName: c.dreLineName,
      totalOrcado: linhas.reduce((a, l) => a + l.total, 0),
      despesas: linhas.reduce((a, l) => a + l.despesas, 0),
      realizadoAnterior: gastoAnterior > 0 ? gastoAnterior : null,
      setores: linhas,
      basePronta: linhas.length > 0 && linhas.every((l) => l.baseSalva),
    };
  });

  items.sort((a, b) =>
    a.categoryName.localeCompare(b.categoryName, "pt-BR", { sensitivity: "base" }),
  );
  return { items };
}
