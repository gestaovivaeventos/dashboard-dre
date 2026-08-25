"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClientIfAvailable } from "@/lib/supabase/admin";
import { getOrcamentoAdmin } from "@/lib/orcamento/auth";
import { isSchemaMissing } from "@/lib/orcamento/errors";
import { isValidBudgetYear } from "@/lib/orcamento/years";
import { SETOR_TODOS } from "@/lib/orcamento/setor-filtro";
import {
  buildDashboardRows,
  loadScopedDreAccounts,
  type DashboardRow,
} from "@/lib/dashboard/dre";
import { projetarMedia } from "@/lib/orcamento/media-calc";
import { fetchRealizados } from "@/lib/orcamento/media-realizado";
import { projetarValorFixoSerie } from "@/lib/orcamento/valor-fixo-calc";
import { getPrevia } from "@/lib/orcamento/actions/pessoal";
import { rotuloOrcamento } from "@/lib/orcamento/previa-budget-labels";
import { INDICES, type IndiceKey, type IndiceUnit } from "@/lib/orcamento/indices";

/** Unidade de cada índice (percent × brl), para o valor fixo corrigir certo. */
const INDICE_UNIT = new Map<string, IndiceUnit>(INDICES.map((i) => [i.key, i.unit]));

// =============================================================================
// Prévia do Orçamento — a DRE da empresa preenchida com os valores ORÇADOS.
//
// É uma VIEW CALCULADA AO VIVO: lê direto as fontes de cada método (média,
// pessoal, …), resolve cada valor para a linha da DRE e reusa o MESMO motor do
// Dashboard (`buildDashboardRows`) para somar folhas, avaliar as fórmulas das
// linhas calculadas (4/6/8/11) e produzir a estrutura inteira. Não há "publicar"
// nem tabela: mudou o valor num método, abriu a prévia, já reflete.
//
// Duas chaves diferentes desembocam na mesma linha da DRE:
//  - MÉDIA: category_code → category_mapping → dre_account_id (o mesmo
//    mapeamento categoria→conta do Financeiro), corrigido pelo índice.
//  - PESSOAL: rótulo "Pessoal — X" → budget_account_mappings → dre_account_id
//    (o mesmo mapeamento "Linhas do Orçamento" que o envio ao Budget já usa).
//
// Todo dre_account_id lido passa por `translateToScopedId` (casa por code), que
// funciona tanto para id do plano global quanto do plano custom da empresa.
//
// Receita ainda não tem método de orçamento (Método por categoria só lista
// despesa), então as linhas de receita saem zeradas — decisão consciente; o
// aviso na tela deixa isso explícito.
// =============================================================================

/** Uma linha da estrutura DRE com os 12 meses orçados + total do ano. */
export interface PreviaDreLinha {
  id: string;
  code: string;
  name: string;
  level: number;
  /** 'receita' | 'despesa' | 'calculado' | 'misto'. */
  type: string;
  isSummary: boolean;
  isCalculado: boolean;
  isReceita: boolean;
  hasChildren: boolean;
  meses: number[];
  totalAno: number;
}

/** Valores que não conseguiram cair numa linha da DRE (ficam visíveis). */
export interface PreviaOrfao {
  chave: string;
  meses: number[];
  totalAno: number;
}

export interface PreviaOrcamentoData {
  linhas: PreviaDreLinha[];
  /** Rótulos do pessoal sem conta em "Linhas do Orçamento". */
  pessoalNaoClassificado: PreviaOrfao[];
  /** Categorias por média com valor, mas sem mapeamento categoria→DRE. */
  categoriasNaoMapeadas: PreviaOrfao[];
  /** Diagnóstico para a tela. */
  resumo: {
    temReceita: boolean;
    mediaCategorias: number;
    mediaSemValor: number;
    valorFixoCategorias: number;
    valorFixoSemValor: number;
    planejamentoCategorias: number;
    planejamentoSemValor: number;
    totalDespesa: number;
    totalReceita: number;
  };
}

interface CategoriaMetodoRow {
  category_code: string;
  category_name: string | null;
}
interface MediaSnapshotRow {
  category_code: string;
  media_valor: number | string | null;
  indice_key: string | null;
}
interface ValorFixoSnapshotRow {
  category_code: string;
  valor_base: number | string | null;
  indice_key: string | null;
  mes_reajuste: number | string | null;
}
interface PlanejamentoSnapshotRow {
  category_code: string;
  /** jsonb: array de 12 números (jan..dez), ou null. */
  valores: unknown;
}
interface CategoryMappingRow {
  omie_category_code: string;
  dre_account_id: string | null;
  company_id: string | null;
}

function db() {
  return createAdminClientIfAvailable();
}

/** Soma um vetor de 12 meses inteiro no acumulador. */
function pushMeses(acc: Map<string, number[]>, key: string, meses: number[]) {
  const arr = acc.get(key) ?? Array<number>(12).fill(0);
  for (let m = 0; m < 12; m += 1) arr[m] += meses[m] ?? 0;
  acc.set(key, arr);
}
function somar(meses: number[]): number {
  return meses.reduce((a, b) => a + b, 0);
}

export async function getPreviaOrcamento(
  companyId: string,
  year: number,
): Promise<{ data?: PreviaOrcamentoData; error?: string; needsMigration?: boolean }> {
  const admin = await getOrcamentoAdmin();
  if (!admin) return { error: "Acesso restrito a administradores." };
  if (!companyId) return { error: "Selecione uma empresa." };
  if (!isValidBudgetYear(year)) return { error: "Ano do orçamento inválido." };

  const supabase = db() ?? (await createClient());

  // ── Estrutura DRE da empresa (plano custom ou global) ──────────────────────
  let scope;
  try {
    scope = await loadScopedDreAccounts(supabase, [companyId]);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Falha ao carregar a estrutura DRE." };
  }

  // Acumulador de valores por FOLHA (scoped dre_account_id) × 12 meses.
  const leafByScopedId = new Map<string, number[]>();
  const pessoalNaoClassificado: PreviaOrfao[] = [];
  const categoriasNaoMapeadas: PreviaOrfao[] = [];

  // Ids das contas que a prévia REALMENTE renderiza (core = top-level 1..19).
  // `translateToScopedId` casa contra o plano COMPLETO (`scopedAccounts`), que
  // inclui contas fora da faixa core (ex.: grupo Financeiras em planos que o
  // colocam ≥20, ou linhas auxiliares). Um valor mapeado para uma conta fora
  // desse conjunto não teria linha onde pousar e sumiria em silêncio — então
  // só aceitamos o pouso quando o id está em `coreAccounts`; senão vira órfão
  // visível no aviso "Valores fora da DRE".
  const coreIds = new Set(scope.coreAccounts.map((a) => a.id));

  // ── MÉTODOS POR CATEGORIA (média + valor fixo) ──────────────────────────────
  // Ambos ligam na DRE pela mesma chave (category_code → category_mapping) e
  // usam os mesmos índices do ano; só a ORIGEM do valor difere (realizado médio
  // vs. valor base digitado). Uma consulta pega os dois métodos; índice e
  // mapeamento são resolvidos uma vez e compartilhados.
  let mediaCategorias = 0;
  let mediaSemValor = 0;
  let valorFixoCategorias = 0;
  let valorFixoSemValor = 0;
  let planejamentoCategorias = 0;
  let planejamentoSemValor = 0;
  const { data: metodoRows, error: metodoErr } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name, metodo")
    .eq("company_id", companyId)
    .eq("year", year)
    .in("metodo", ["media", "valor_fixo", "planejamento_socios"]);
  if (metodoErr) {
    if (isSchemaMissing(metodoErr.message)) return { needsMigration: true };
    return { error: metodoErr.message };
  }
  const metodoCats = (metodoRows ?? []) as (CategoriaMetodoRow & { metodo: string })[];
  const mediaCats = metodoCats.filter((c) => c.metodo === "media");
  const vfCats = metodoCats.filter((c) => c.metodo === "valor_fixo");
  const psCats = metodoCats.filter((c) => c.metodo === "planejamento_socios");
  mediaCategorias = mediaCats.length;
  valorFixoCategorias = vfCats.length;
  planejamentoCategorias = psCats.length;

  if (metodoCats.length > 0) {
    const allCodes = Array.from(new Set(metodoCats.map((c) => c.category_code)));

    // Índices percentuais do ano (compartilhado pelos dois métodos).
    const { data: indiceRowRaw } = await supabase
      .from("orcamento_indices")
      .select("*")
      .eq("year", year)
      .maybeSingle();
    const indiceRow = (indiceRowRaw ?? null) as Record<string, number | null> | null;
    const indicePercent = (key: string | null): number | null => {
      if (!key) return null;
      const v = indiceRow?.[key as IndiceKey];
      return v == null ? null : Number(v);
    };

    // Mapeamento categoria→conta (override da empresa > global), uma vez só.
    const { data: mapRows, error: mapErr } = await supabase
      .from("category_mapping")
      .select("omie_category_code, dre_account_id, company_id")
      .in("omie_category_code", allCodes)
      .or(`company_id.eq.${companyId},company_id.is.null`);
    if (mapErr) return { error: mapErr.message };
    const mapByCode = new Map<string, string | null>();
    for (const r of (mapRows ?? []) as CategoryMappingRow[]) {
      // Override da empresa tem prioridade: sobrescreve o global.
      if (r.company_id === companyId) mapByCode.set(r.omie_category_code, r.dre_account_id);
      else if (!mapByCode.has(r.omie_category_code)) mapByCode.set(r.omie_category_code, r.dre_account_id);
    }

    // Resolve o code para a folha escopada; empurra os 12 meses ou registra o órfão.
    const aplicar = (code: string, chave: string, meses: number[]) => {
      const rawAccountId = mapByCode.get(code) ?? null;
      const scopedId = rawAccountId ? scope.translateToScopedId(rawAccountId) : null;
      // Sem conta mapeada, ou mapeada para fora da faixa renderizada (coreIds):
      // fica órfão visível, nunca descartado.
      if (!scopedId || !coreIds.has(scopedId)) {
        categoriasNaoMapeadas.push({ chave, meses, totalAno: somar(meses) });
        return;
      }
      pushMeses(leafByScopedId, scopedId, meses);
    };

    // MÉDIA — valor mensal médio, igual nos 12 meses.
    if (mediaCats.length > 0) {
      const { data: snapRows, error: snapErr } = await supabase
        .from("orcamento_media_categorias")
        .select("category_code, media_valor, indice_key")
        .eq("company_id", companyId)
        .eq("year", year);
      if (snapErr) {
        if (isSchemaMissing(snapErr.message)) return { needsMigration: true };
        return { error: snapErr.message };
      }
      const snapByCode = new Map<string, MediaSnapshotRow>(
        ((snapRows ?? []) as MediaSnapshotRow[]).map((r) => [r.category_code, r]),
      );
      // Realizado do ano-base AO VIVO — mesmo cálculo da tela de Média. A prévia
      // lia só o snapshot salvo, mas a tela mostra `mediaValor ?? realizado.media`
      // (sugestão viva antes de "Recalcular p/ salvar"): categoria com valor
      // vivo mas sem snapshot aparecia zerada aqui. Usamos o MESMO efetivo.
      const mediaCodes = mediaCats.map((c) => c.category_code);
      const realizados = await fetchRealizados(supabase, companyId, year - 1, mediaCodes);
      for (const cat of mediaCats) {
        const snap = snapByCode.get(cat.category_code);
        // Efetiva = snapshot salvo; sem ele, a média viva do realizado.
        const bruto =
          snap?.media_valor != null
            ? Number(snap.media_valor)
            : realizados.get(cat.category_code)?.media ?? null;
        const projetado = projetarMedia(bruto, indicePercent(snap?.indice_key ?? null));
        if (projetado == null || projetado === 0) {
          mediaSemValor += 1;
          continue;
        }
        aplicar(cat.category_code, cat.category_name ?? cat.category_code, Array<number>(12).fill(projetado));
      }
    }

    // VALOR FIXO — valor base + índice, com o degrau do mês de reajuste.
    if (vfCats.length > 0) {
      const { data: vfRows, error: vfErr } = await supabase
        .from("orcamento_valor_fixo_categorias")
        .select("category_code, valor_base, indice_key, mes_reajuste")
        .eq("company_id", companyId)
        .eq("year", year);
      if (vfErr) {
        if (isSchemaMissing(vfErr.message)) return { needsMigration: true };
        return { error: vfErr.message };
      }
      // Uma categoria pode ter N contratos (linhas) — agrupa por código e SOMA
      // as séries de cada contrato antes de aplicar na linha da DRE.
      const vfByCode = new Map<string, ValorFixoSnapshotRow[]>();
      for (const r of (vfRows ?? []) as ValorFixoSnapshotRow[]) {
        if (!vfByCode.has(r.category_code)) vfByCode.set(r.category_code, []);
        vfByCode.get(r.category_code)!.push(r);
      }
      for (const cat of vfCats) {
        const contratos = vfByCode.get(cat.category_code) ?? [];
        const meses = Array<number>(12).fill(0);
        for (const snap of contratos) {
          const base = snap.valor_base == null ? null : Number(snap.valor_base);
          if (base == null) continue;
          const mes = snap.mes_reajuste == null ? null : Number(snap.mes_reajuste);
          // O salário mínimo corrige por valor absoluto (unit 'brl'); os demais, %.
          const unit = INDICE_UNIT.get(snap.indice_key ?? "") ?? "percent";
          const serie = projetarValorFixoSerie(base, indicePercent(snap.indice_key ?? null), mes, unit);
          for (let m = 0; m < 12; m += 1) meses[m] += serie[m] ?? 0;
        }
        // "Sem valor" quando nenhum contrato tem base (a soma zera).
        if (somar(meses) === 0) {
          valorFixoSemValor += 1;
          continue;
        }
        aplicar(cat.category_code, cat.category_name ?? cat.category_code, meses);
      }
    }

    // PLANEJAMENTO DOS SÓCIOS — os 12 valores mensais DECIDIDOS na entrevista com
    // a IA (já congelados na tabela; nada é recalculado aqui). Cai na linha da DRE
    // pela mesma chave category_code → category_mapping dos outros métodos.
    if (psCats.length > 0) {
      const { data: psRows, error: psErr } = await supabase
        .from("orcamento_planejamento_socios")
        .select("category_code, valores")
        .eq("company_id", companyId)
        .eq("year", year);
      // Migration ainda não aplicada: não bloqueia a Prévia inteira (os demais
      // métodos continuam) — essas categorias só contam como "sem valor".
      if (psErr && !isSchemaMissing(psErr.message)) return { error: psErr.message };
      const psByCode = new Map<string, PlanejamentoSnapshotRow>();
      ((psRows ?? []) as PlanejamentoSnapshotRow[]).forEach((r) => psByCode.set(r.category_code, r));
      for (const cat of psCats) {
        const row = psByCode.get(cat.category_code);
        const arr = Array.isArray(row?.valores) ? (row!.valores as unknown[]) : null;
        const meses = Array<number>(12).fill(0);
        if (arr) {
          for (let m = 0; m < 12; m += 1) {
            const n = Number(arr[m]);
            meses[m] = Number.isFinite(n) && n > 0 ? n : 0;
          }
        }
        if (somar(meses) === 0) {
          planejamentoSemValor += 1;
          continue;
        }
        aplicar(cat.category_code, cat.category_name ?? cat.category_code, meses);
      }
    }
  }

  // ── PESSOAL ─────────────────────────────────────────────────────────────────
  // A empresa inteira (SETOR_TODOS) — é o número que vai para a DRE.
  const previaRes = await getPrevia(companyId, year, { setorId: SETOR_TODOS });
  if (previaRes.needsMigration) return { needsMigration: true };
  if (previaRes.payload && previaRes.payload.totalColaboradores > 0) {
    // Mapeamento rótulo → conta (as "Linhas do Orçamento").
    const { data: labelRows, error: labelErr } = await supabase
      .from("budget_account_mappings")
      .select("label, dre_account_id")
      .eq("company_id", companyId);
    if (labelErr) return { error: labelErr.message };
    const accountByLabel = new Map<string, string | null>(
      (labelRows ?? []).map((r) => [r.label as string, (r.dre_account_id as string | null) ?? null]),
    );

    for (const linha of previaRes.payload.previa.linhas) {
      const rotulo = rotuloOrcamento(linha.label);
      const rawAccountId = accountByLabel.get(rotulo) ?? null;
      const scopedId = rawAccountId ? scope.translateToScopedId(rawAccountId) : null;
      // Mesma guarda da média/valor fixo: sem conta, ou fora da faixa core → órfão.
      if (!scopedId || !coreIds.has(scopedId)) {
        pessoalNaoClassificado.push({
          chave: linha.label,
          meses: linha.meses,
          totalAno: somar(linha.meses),
        });
        continue;
      }
      pushMeses(leafByScopedId, scopedId, linha.meses);
    }
  }

  // ── Monta a DRE mês a mês reusando o motor do Dashboard ─────────────────────
  // Fórmulas são lineares (só +/-), então avaliar por mês e somar = avaliar
  // sobre o total do ano. Rodamos 12 vezes para ter a coluna de cada mês.
  const perMonthRows: DashboardRow[][] = [];
  for (let m = 0; m < 12; m += 1) {
    const amounts = new Map<string, number>();
    leafByScopedId.forEach((arr, id) => {
      if (arr[m] !== 0) amounts.set(id, arr[m]);
    });
    perMonthRows.push(buildDashboardRows(scope.coreAccounts, amounts).rows);
  }

  const base = perMonthRows[0] ?? [];
  const linhas: PreviaDreLinha[] = base.map((row, i) => {
    const meses = perMonthRows.map((rows) => rows[i]?.value ?? 0);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      level: row.level,
      type: row.type,
      isSummary: row.is_summary,
      isCalculado: row.type === "calculado",
      isReceita: row.type === "receita",
      hasChildren: row.hasChildren,
      meses,
      totalAno: somar(meses),
    };
  });

  const temReceita = linhas.some((l) => l.isReceita);
  const totalDespesa = linhas
    .filter((l) => l.type === "despesa" && !l.hasChildren)
    .reduce((s, l) => s + l.totalAno, 0);
  const totalReceita = linhas
    .filter((l) => l.isReceita && !l.hasChildren)
    .reduce((s, l) => s + l.totalAno, 0);

  return {
    data: {
      linhas,
      pessoalNaoClassificado,
      categoriasNaoMapeadas,
      resumo: {
        temReceita,
        mediaCategorias,
        mediaSemValor,
        valorFixoCategorias,
        valorFixoSemValor,
        planejamentoCategorias,
        planejamentoSemValor,
        totalDespesa,
        totalReceita,
      },
    },
  };
}
