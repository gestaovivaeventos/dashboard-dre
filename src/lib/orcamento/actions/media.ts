"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { registrarAlteracao } from "@/lib/orcamento/actions/trilha";
import { travaDaValidacao } from "@/lib/orcamento/actions/validacao-diretoria";
import { estadoDaLinha, lerDecisoes } from "@/lib/orcamento/decisoes-linha";
import { podeDecidir, type ValidacaoEstado } from "@/lib/orcamento/validacao-diretoria";
import { chaveMedia } from "@/lib/orcamento/validacao-diretoria";
import {
  autorizarEscrita,
  autorizarLeitura,
  podeEscreverNoSetor,
  SEM_ACESSO_SETOR,
  SEM_EDICAO_METODO,
} from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { podeEditarMetodo } from "@/lib/orcamento/metodos";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { setorEspecifico } from "@/lib/orcamento/setor-filtro";
import { orcaPorSetor, setorParaGravar } from "@/lib/orcamento/setor-gravacao";
import { INDICES, type IndiceKey } from "@/lib/orcamento/indices";
import { getCategoriasOrcamento } from "@/lib/orcamento/actions/categoria-metodo";
import {
  combinarRealizados,
  fetchRealizados,
  type MediaRealizado,
} from "@/lib/orcamento/media-realizado";

const PATH = "/orcamento/despesas/media";

// ─── Tipos ────────────────────────────────────────────────────────────────────

// MediaRealizado + o cálculo do realizado (meses fechados, média) vivem em
// `@/lib/orcamento/media-realizado` (fonte única, compartilhada com a Prévia).
export type { MediaRealizado };

export interface MediaCategoriaItem {
  categoryCode: string;
  categoryName: string;
  /** Setor DESTA linha. Uma categoria pode ter uma linha por setor, e é este
   * campo (não o filtro da tela) que diz para onde a edição vai. */
  setorId: string | null;
  setorNome: string | null;
  /** Média efetiva salva (snapshot). null = ainda não calculada/salva. */
  mediaValor: number | null;
  /** true = valor editado à mão (≠ recalculado da Omie). */
  manual: boolean;
  /** Índice de correção escolhido (null = sem correção). */
  indiceKey: IndiceKey | null;
  baseYear: number | null;
  mesesConsiderados: number | null;
  calculadoEm: string | null;
  /** Realizado do ano-base recalculado ao vivo (para sugestão e detalhe). */
  realizado: MediaRealizado;
  /**
   * Alvo da decisão desta linha — calculado AQUI, e não na tela, porque a
   * regra tem uma pegadinha: a média sem linha gravada é ancorada em
   * (categoria, ∅), e a primeira gravação é que resolve o setor. Montar a
   * chave no cliente faria a decisão cair num alvo que a Prévia não lê, e ela
   * sumiria de lá sem erro nenhum. Ver `travaDaLinhaDeMedia`.
   */
  alvoId: string;
  /** Decisão da diretoria sobre esta linha. */
  estado: ValidacaoEstado;
  /** O que o diretor pediu que mude — só no 'revisar'. */
  comentario: string | null;
  /** Fechada para o construtor (aprovada ou reprovada). DERIVA do status. */
  travado: boolean;
}

/** Índice de correção disponível, com o valor (%) do ano do orçamento. */
export interface IndiceOption {
  key: IndiceKey;
  label: string;
  /** Percentual cadastrado para o ano do orçamento. null = não cadastrado. */
  value: number | null;
}

export interface MediaSetup {
  items: MediaCategoriaItem[];
  /** Ano-base da média (ano do orçamento − 1). */
  baseYear: number;
  /** Índices percentuais disponíveis para correção, com o valor do ano. */
  indices: IndiceOption[];
  /** Quem está vendo decide? A tela só mostra ✓ / ✗ / comentario quando sim. */
  podeValidar: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function db() {
  return createAdminClientIfAvailable();
}

/** Só os índices percentuais servem para correção (salário mínimo é valor R$). */
const INDICES_PERCENT = INDICES.filter((i) => i.unit === "percent");
const INDICE_KEYS = new Set<string>(INDICES_PERCENT.map((i) => i.key));

function isIndiceKey(value: unknown): value is IndiceKey {
  return typeof value === "string" && INDICE_KEYS.has(value);
}

/** Códigos + nomes das categorias marcadas com o método 'media' na empresa/ano. */
/**
 * Categorias por média, restritas ao SETOR quando ele é informado.
 *
 * A categoria só aparece no setor a que foi atribuída (tela Método por
 * categoria). Sem isso, toda categoria apareceria em todos os setores e o
 * mesmo gasto seria orçado várias vezes.
 */
async function fetchCategoriasMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  year: number,
  setorId: string | null,
): Promise<{
  codes: Map<string, string>;
  /** Setores atribuídos a cada categoria (para montar uma linha por par). */
  setoresPorCodigo: Map<string, string[]>;
  needsMigration?: boolean;
  error?: string;
}> {
  const { data, error } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", "media");
  if (error) {
    if (isSchemaMissing(error.message)) return { codes: new Map(), setoresPorCodigo: new Map(), needsMigration: true };
    return { codes: new Map(), setoresPorCodigo: new Map(), error: error.message };
  }

  // Atribuição categoria -> setores. Com um setor escolhido, filtra por ele;
  // em "Todos os setores", traz tudo para montar uma linha por par.
  const especifico = setorEspecifico(setorId);
  let atribQuery = supabase
    .from("orcamento_categoria_setores")
    .select("category_code, setor_id")
    .eq("company_id", companyId)
    .eq("year", year);
  if (especifico) atribQuery = atribQuery.eq("setor_id", especifico);
  const setoresPorCodigo = new Map<string, string[]>();
  let permitidas: Set<string> | null = null;
  if (setorId) {
    const { data: atrib, error: atribErr } = await atribQuery;
    if (atribErr) {
      if (isSchemaMissing(atribErr.message)) return { codes: new Map(), setoresPorCodigo: new Map(), needsMigration: true };
      return { codes: new Map(), setoresPorCodigo: new Map(), error: atribErr.message };
    }
    permitidas = new Set((atrib ?? []).map((r) => r.category_code as string));
    for (const r of atrib ?? []) {
      const code = r.category_code as string;
      const lista = setoresPorCodigo.get(code) ?? [];
      lista.push(r.setor_id as string);
      setoresPorCodigo.set(code, lista);
    }
  }

  const codes = new Map<string, string>();
  for (const r of data ?? []) {
    const code = r.category_code as string;
    if (permitidas && !permitidas.has(code)) continue;
    codes.set(code, (r.category_name as string) ?? code);
  }
  return { codes, setoresPorCodigo };
}

/**
 * Código canônico → todos os códigos que ele representa (ele e as gêmeas "(*)").
 *
 * A Média lê as categorias direto de `orcamento_categoria_metodo`, que só tem
 * as que têm método — a gêmea, que não tem, não está lá. Sem este mapa o
 * realizado de "Marketing (*)" se perdia em silêncio quando só "Marketing"
 * estava marcado como média.
 */
async function mapaDeIrmas(companyId: string, year: number): Promise<Map<string, string[]>> {
  const cats = await getCategoriasOrcamento(companyId, year);
  return new Map((cats.items ?? []).map((c) => [c.categoryCode, c.codigos]));
}

// ─── Leitura ────────────────────────────────────────────────────────────────

export async function getMediaCategorias(
  companyId: string,
  year: number,
  /** Setor da tela. As categorias e os valores são os DESTE setor. */
  setorId: string | null = null,
): Promise<{ setup?: MediaSetup; error?: string; needsMigration?: boolean }> {
  if (!companyId) {
    return { setup: { items: [], baseYear: year - 1, indices: [], podeValidar: false } };
  }
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarLeitura(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  const baseYear = year - 1;

  // Índices percentuais do ano do orçamento (para o seletor de correção).
  const { data: indiceRowRaw } = await supabase
    .from("orcamento_indices")
    .select("*")
    .eq("year", year)
    .maybeSingle();
  const indiceRow = (indiceRowRaw ?? null) as Record<string, number | null> | null;
  const indices: IndiceOption[] = INDICES_PERCENT.map((meta) => {
    const v = indiceRow?.[meta.key];
    return {
      key: meta.key,
      label: meta.label,
      value: v == null ? null : Number(v),
    };
  });

  // Categorias marcadas como 'media'.
  const cats = await fetchCategoriasMedia(supabase, companyId, year, setorId);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const codes = Array.from(cats.codes.keys());
  if (codes.length === 0) {
    return { setup: { items: [], baseYear, indices, podeValidar: podeDecidir(auth.user.papel) } };
  }

  // Snapshots salvos. A chave é (categoria, setor): a mesma categoria pode ter
  // uma linha em cada setor, e ler só por código faria os dois setores
  // mostrarem o mesmo valor.
  const { data: saved, error: savedError } = await supabase
    .from("orcamento_media_categorias")
    .select(
      "category_code, setor_id, media_valor, manual, indice_key, base_year, meses_considerados, calculado_em, updated_at",
    )
    .eq("company_id", companyId)
    .eq("year", year);
  if (savedError) {
    if (isSchemaMissing(savedError.message)) return { needsMigration: true };
    return { error: savedError.message };
  }
  const chave = (code: string, sid: string | null) => `${code}|${sid ?? "-"}`;
  const savedByKey = new Map(
    (saved ?? []).map((r) => [chave(r.category_code as string, (r.setor_id as string) ?? null), r]),
  );

  // Empresa sem "Orçar por setor": a categoria tem UMA linha, e o setor dela é
  // só o balde onde ficou gravada (a chave única do banco exige um). Casar por
  // setor aqui faria o valor salvo sumir da tela, porque a tela manda setor
  // nulo. Então, com a chave desligada, casa-se só pela categoria.
  const porSetor = await orcaPorSetor(supabase, companyId, year);
  const savedByCode = new Map<string, NonNullable<typeof saved>[number]>();
  if (!porSetor) {
    for (const r of saved ?? []) {
      const code = r.category_code as string;
      if (!savedByCode.has(code)) savedByCode.set(code, r);
    }
  }

  // Nomes dos setores, para rotular as linhas na visão "Todos os setores".
  const { data: setoresRows } = await supabase
    .from("orcamento_setores")
    .select("id, name")
    .eq("company_id", companyId)
    .eq("year", year);
  const nomeSetor = new Map(
    (setoresRows ?? []).map((r) => [r.id as string, r.name as string]),
  );

  // Realizado do ano-base ao vivo (sugestão + detalhe mensal), SOMANDO as
  // gêmeas "(*)": na construção do orçamento é tudo Marketing.
  const irmas = await mapaDeIrmas(companyId, year);
  const todosCodigos = Array.from(new Set(codes.flatMap((c) => irmas.get(c) ?? [c])));
  const realizados = await fetchRealizados(supabase, companyId, baseYear, todosCodigos);

  // Uma linha por (categoria × setor atribuído). Com um setor selecionado, é
  // uma linha por categoria; em "Todos os setores", a categoria orçada por dois
  // setores aparece duas vezes, cada uma com o seu valor.
  const pares: { code: string; setorId: string | null }[] = [];
  for (const code of codes) {
    // Sem orçar por setor: uma linha por categoria, no setor em que ela já está
    // gravada (ou nenhum, se ainda não existir — a gravação resolve o balde).
    if (!porSetor) {
      pares.push({ code, setorId: (savedByCode.get(code)?.setor_id as string) ?? null });
      continue;
    }
    const doCode = cats.setoresPorCodigo?.get(code);
    if (doCode && doCode.length > 0) {
      for (const sid of doCode) pares.push({ code, setorId: sid });
    } else {
      pares.push({ code, setorId: setorEspecifico(setorId) });
    }
  }

  // O alvo da decisão é o MESMO que a Prévia usa: (categoria, setor DA LINHA
  // GRAVADA) — e (categoria, ∅) enquanto não há linha, porque a média "viva"
  // do realizado não tem setor a apontar. Montar essa chave na tela faria a
  // decisão cair num alvo que a Prévia não lê, e ela sumiria de lá sem erro.
  const linhas = pares.map(({ code, setorId: sid }) => {
    const row = porSetor ? savedByKey.get(chave(code, sid)) : savedByCode.get(code);
    return {
      code,
      sid,
      row,
      alvoId: chaveMedia(code, row ? ((row.setor_id as string) ?? null) : null),
    };
  });
  const decisoes = await lerDecisoes(
    supabase,
    companyId,
    year,
    "media_linha",
    linhas.map((l) => l.alvoId),
  );

  const items: MediaCategoriaItem[] = linhas.map(({ code, sid, row, alvoId }) => {
    const indiceKey = isIndiceKey(row?.indice_key) ? (row!.indice_key as IndiceKey) : null;
    return {
      alvoId,
      ...estadoDaLinha(
        decisoes.get(alvoId),
        (row?.updated_at as string | null) ?? null,
        auth.user.papel,
      ),
      categoryCode: code,
      categoryName: cats.codes.get(code) ?? code,
      setorId: sid,
      setorNome: sid ? nomeSetor.get(sid) ?? null : null,
      mediaValor: row?.media_valor == null ? null : Number(row.media_valor),
      manual: Boolean(row?.manual),
      indiceKey,
      baseYear: row?.base_year == null ? null : Number(row.base_year),
      mesesConsiderados: row?.meses_considerados == null ? null : Number(row.meses_considerados),
      calculadoEm: (row?.calculado_em as string) ?? null,
      realizado: combinarRealizados(realizados, irmas.get(code) ?? [code], baseYear),
    };
  });

  items.sort(
    (a, b) =>
      a.categoryName.localeCompare(b.categoryName, "pt-BR") ||
      (a.setorNome ?? "").localeCompare(b.setorNome ?? "", "pt-BR"),
  );

  // Recorte do construtor restrito ("Gerente"): mesmo escolhendo "Todos os
  // setores" na tela, ele só enxerga as linhas dos setores dele. Sem isto, a
  // visão consolidada seria uma porta aberta para o orçamento dos colegas.
  // `auth.setores === null` = vê tudo (admin, diretoria, Gerente Sócio).
  const visiveis =
    auth.setores === null
      ? items
      : items.filter((i) => i.setorId !== null && auth.setores!.includes(i.setorId));

  return {
    setup: { items: visiveis, baseYear, indices, podeValidar: podeDecidir(auth.user.papel) },
  };
}

// ─── Cálculo / edição ─────────────────────────────────────────────────────────

/** Recalcula a média de UMA categoria a partir da Omie e grava como snapshot
 * (manual = false). É o botão "Recalcular pela Omie" da linha. */
export async function calcularMedia(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  /** Setor da tela — a linha do orçamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; item?: MediaCategoriaItem; error?: string; needsMigration?: boolean }> {
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  // GERENTE E GERENTE SÓCIO NÃO EDITAM este método (regra de 29/09/2026): ele
  // parte de um número que o gestor não define e é mantido pela administração.
  // Eles continuam LENDO a tela — precisam do conjunto do setor — e construindo
  // Pessoal e Planejamento. Ver `podeEditarMetodo` em metodos.ts.
  if (!podeEditarMetodo(auth.user.papel, "media")) return { error: SEM_EDICAO_METODO };
  const admin = { userId: auth.user.userId };
  const baseYear = year - 1;
  const irmasUma = await mapaDeIrmas(companyId, year);
  const codigosDaCategoria = irmasUma.get(categoryCode) ?? [categoryCode];
  const realizados = await fetchRealizados(supabase, companyId, baseYear, codigosDaCategoria);
  const realizado = combinarRealizados(realizados, codigosDaCategoria, baseYear);
  const calculadoEm = new Date().toISOString();

  // O upsert casa por (empresa, ano, categoria, setor): setor NULL nunca
  // encontra a linha anterior e duplicaria a categoria a cada gravação.
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  if (alvo.error) return { error: alvo.error };
  // O destino só é conhecido aqui: "Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum.
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };

  const { error } = await supabase.from("orcamento_media_categorias").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      setor_id: alvo.id,
      media_valor: realizado.media,
      manual: false,
      base_year: baseYear,
      meses_considerados: realizado.mesesConsiderados,
      calculado_em: calculadoEm,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  revalidatePath(PATH);
  return {
    ok: true,
    item: {
      categoryCode,
      categoryName,
      setorId,
      setorNome: null,
      mediaValor: realizado.media,
      manual: false,
      indiceKey: null, // preservado no banco; a tela recarrega o índice do estado local
      baseYear,
      mesesConsiderados: realizado.mesesConsiderados,
      calculadoEm,
      realizado,
      // A linha acabou de ser gravada, e a EDIÇÃO VENCE A DECISÃO: qualquer
      // decisão anterior sobre ela voltou a ser pendente. O alvo usa o setor
      // REALMENTE gravado (`alvo.id`), não o da tela.
      alvoId: chaveMedia(categoryCode, alvo.id),
      estado: "pendente" as const,
      comentario: null,
      travado: false,
    },
  };
}

/** Recalcula a média de TODAS as categorias 'media' da empresa/ano. */
export async function recalcularTodasMedias(
  companyId: string,
  year: number,
  setorId: string | null = null,
): Promise<{ ok?: true; atualizadas?: number; error?: string; needsMigration?: boolean }> {
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  // GERENTE E GERENTE SÓCIO NÃO EDITAM este método (regra de 29/09/2026): ele
  // parte de um número que o gestor não define e é mantido pela administração.
  // Eles continuam LENDO a tela — precisam do conjunto do setor — e construindo
  // Pessoal e Planejamento. Ver `podeEditarMetodo` em metodos.ts.
  if (!podeEditarMetodo(auth.user.papel, "media")) return { error: SEM_EDICAO_METODO };
  const admin = { userId: auth.user.userId };
  const cats = await fetchCategoriasMedia(supabase, companyId, year, setorId);
  if (cats.needsMigration) return { needsMigration: true };
  if (cats.error) return { error: cats.error };
  const codes = Array.from(cats.codes.keys());
  if (codes.length === 0) return { ok: true, atualizadas: 0 };

  const baseYear = year - 1;
  const irmasTodas = await mapaDeIrmas(companyId, year);
  const codigosTodos = Array.from(new Set(codes.flatMap((c) => irmasTodas.get(c) ?? [c])));
  const realizados = await fetchRealizados(supabase, companyId, baseYear, codigosTodos);
  const calculadoEm = new Date().toISOString();

  // O upsert casa por (empresa, ano, categoria, setor): setor NULL nunca
  // encontra a linha anterior e duplicaria a categoria a cada gravação.
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  if (alvo.error) return { error: alvo.error };
  // O destino só é conhecido aqui: "Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum.
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };

  const rows = codes.map((code) => {
    const realizado = combinarRealizados(realizados, irmasTodas.get(code) ?? [code], baseYear);
    return {
      company_id: companyId,
      year,
      category_code: code,
      category_name: cats.codes.get(code) ?? code,
      setor_id: alvo.id,
      media_valor: realizado.media,
      manual: false,
      base_year: baseYear,
      meses_considerados: realizado.mesesConsiderados,
      calculado_em: calculadoEm,
      updated_by: admin.userId,
    };
  });

  const { error } = await supabase
    .from("orcamento_media_categorias")
    .upsert(rows, { onConflict: "company_id,year,category_code,setor_id" });
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  // UMA entrada agregada: o recálculo em lote é um ato do usuário ("recalculei
  // tudo"), não N alterações. Uma linha por categoria afogaria a trilha e
  // esconderia as alterações que importam no retorno.
  await registrarAlteracao({
    companyId,
    year,
    setorId: alvo.id,
    metodo: "media",
    alvoTipo: "media_linha",
    alvoRotulo: `Recálculo de ${rows.length} categoria(s) por média`,
    acao: "alterou",
    depois: { categorias: rows.length, base_year: baseYear },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true, atualizadas: rows.length };
}

/** Edição manual do valor da média (manual = true). null limpa o valor. */
/**
 * A linha da média está travada pela diretoria para ESTE usuário?
 *
 * A média não tem id próprio na tela — a linha pode nem existir ainda quando
 * o valor é o "vivo" do realizado —, então o alvo da decisão é a chave
 * (categoria, setor). Dois caminhos de escrita (valor e índice) usam isto.
 */
async function travaDaLinhaDeMedia(
  supabase: Awaited<ReturnType<typeof createClient>>,
  companyId: string,
  year: number,
  categoryCode: string,
  setorId: string | null,
  papel: string,
): Promise<string | null> {
  let q = supabase
    .from("orcamento_media_categorias")
    .select("updated_at")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("category_code", categoryCode);
  // `.eq(col, null)` vira `eq.null` no PostgREST e não casa com nada.
  q = setorId ? q.eq("setor_id", setorId) : q.is("setor_id", null);
  const { data } = await q.maybeSingle();
  const atualizadoEm = (data?.updated_at as string | null) ?? null;

  const travado = await travaDaValidacao({
    companyId,
    year,
    alvoTipo: "media_linha",
    alvoId: chaveMedia(categoryCode, setorId),
    atualizadoEm,
    papel,
  });
  if (travado || !setorId) return travado;

  // A CHAVE SEM SETOR também trava. Enquanto não há linha gravada, a Prévia
  // mostra a média "viva" do realizado e a ancora em (categoria, ∅) — não há
  // setor a apontar. A primeira gravação resolve o setor (`setorParaGravar`) e
  // passaria a procurar (categoria, setor), que não existe: a decisão tomada
  // sobre a média viva seria contornada em silêncio pela própria gravação que
  // ela deveria barrar.
  return travaDaValidacao({
    companyId,
    year,
    alvoTipo: "media_linha",
    alvoId: chaveMedia(categoryCode, null),
    atualizadoEm,
    papel,
  });
}

export async function setMediaValor(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  valor: number | null,
  /** Setor da tela — a linha do orçamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (valor != null && (!Number.isFinite(valor) || valor < 0)) {
    return { error: "Valor da média inválido." };
  }

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  // GERENTE E GERENTE SÓCIO NÃO EDITAM este método (regra de 29/09/2026): ele
  // parte de um número que o gestor não define e é mantido pela administração.
  // Eles continuam LENDO a tela — precisam do conjunto do setor — e construindo
  // Pessoal e Planejamento. Ver `podeEditarMetodo` em metodos.ts.
  if (!podeEditarMetodo(auth.user.papel, "media")) return { error: SEM_EDICAO_METODO };
  const admin = { userId: auth.user.userId };
  // O upsert casa por (empresa, ano, categoria, setor): setor NULL nunca
  // encontra a linha anterior e duplicaria a categoria a cada gravação.
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  if (alvo.error) return { error: alvo.error };
  // O destino só é conhecido aqui: "Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum.
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  // TRAVA DA VALIDAÇÃO: linha aprovada ou reprovada pela diretoria sai das mãos
  // do gestor — só admin e diretoria mexem. Decisão vencida não trava.
  const travado = await travaDaLinhaDeMedia(
    supabase,
    companyId,
    year,
    categoryCode,
    alvo.id,
    auth.user.papel,
  );
  if (travado) return { error: travado };
  const { error } = await supabase.from("orcamento_media_categorias").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      setor_id: alvo.id,
      media_valor: valor,
      manual: valor != null,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  await registrarAlteracao({
    companyId,
    year,
    categoryCode,
    setorId: alvo.id,
    metodo: "media",
    alvoTipo: "media_linha",
    alvoRotulo: categoryName,
    acao: "alterou",
    depois: { media_valor: valor, manual: valor != null },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true };
}

/** Define (ou remove) o índice de correção aplicado à média. */
export async function setMediaIndice(
  companyId: string,
  year: number,
  categoryCode: string,
  categoryName: string,
  indiceKey: IndiceKey | null,
  /** Setor da tela — a linha do orçamento pertence a ele. */
  setorId: string | null = null,
): Promise<{ ok?: true; error?: string; needsMigration?: boolean }> {
  if (!companyId || !categoryCode) return { error: "Categoria inválida." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };
  if (indiceKey != null && !isIndiceKey(indiceKey)) return { error: "Índice inválido." };

  const supabase = db() ?? (await createClient());
  const auth = await autorizarEscrita(supabase, companyId, year);
  if (!auth.ok) return { error: auth.error };
  // GERENTE E GERENTE SÓCIO NÃO EDITAM este método (regra de 29/09/2026): ele
  // parte de um número que o gestor não define e é mantido pela administração.
  // Eles continuam LENDO a tela — precisam do conjunto do setor — e construindo
  // Pessoal e Planejamento. Ver `podeEditarMetodo` em metodos.ts.
  if (!podeEditarMetodo(auth.user.papel, "media")) return { error: SEM_EDICAO_METODO };
  const admin = { userId: auth.user.userId };
  // O upsert casa por (empresa, ano, categoria, setor): setor NULL nunca
  // encontra a linha anterior e duplicaria a categoria a cada gravação.
  const alvo = await setorParaGravar(supabase, companyId, year, setorId, admin.userId);
  if (alvo.error) return { error: alvo.error };
  // O destino só é conhecido aqui: "Todos os setores" cai no balde "Não
  // atribuído", que não pertence a gerente nenhum.
  if (!podeEscreverNoSetor(auth.setores, alvo.id)) return { error: SEM_ACESSO_SETOR };
  // TRAVA DA VALIDAÇÃO: linha aprovada ou reprovada pela diretoria sai das mãos
  // do gestor — só admin e diretoria mexem. Decisão vencida não trava.
  const travado = await travaDaLinhaDeMedia(
    supabase,
    companyId,
    year,
    categoryCode,
    alvo.id,
    auth.user.papel,
  );
  if (travado) return { error: travado };
  const { error } = await supabase.from("orcamento_media_categorias").upsert(
    {
      company_id: companyId,
      year,
      category_code: categoryCode,
      category_name: categoryName,
      setor_id: alvo.id,
      indice_key: indiceKey,
      updated_by: admin.userId,
    },
    { onConflict: "company_id,year,category_code,setor_id" },
  );
  if (error) {
    if (isSchemaMissing(error.message)) return { needsMigration: true };
    return { error: error.message };
  }
  await registrarAlteracao({
    companyId,
    year,
    categoryCode,
    setorId: alvo.id,
    metodo: "media",
    alvoTipo: "media_linha",
    alvoRotulo: categoryName,
    acao: "alterou",
    depois: { indice_key: indiceKey },
    autorId: auth.user.userId,
    autorPapel: auth.user.papel,
  });
  revalidatePath(PATH);
  return { ok: true };
}
