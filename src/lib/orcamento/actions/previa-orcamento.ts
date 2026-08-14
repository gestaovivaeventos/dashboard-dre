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
import { getPrevia } from "@/lib/orcamento/actions/pessoal";
import { rotuloOrcamento } from "@/lib/orcamento/previa-budget-labels";
import type { IndiceKey } from "@/lib/orcamento/indices";

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

  // ── MÉDIA ──────────────────────────────────────────────────────────────────
  // Categorias marcadas 'media' + snapshot do valor + índice do ano.
  let mediaCategorias = 0;
  let mediaSemValor = 0;
  const { data: metodoRows, error: metodoErr } = await supabase
    .from("orcamento_categoria_metodo")
    .select("category_code, category_name")
    .eq("company_id", companyId)
    .eq("year", year)
    .eq("metodo", "media");
  if (metodoErr) {
    if (isSchemaMissing(metodoErr.message)) return { needsMigration: true };
    return { error: metodoErr.message };
  }
  const mediaCats = (metodoRows ?? []) as CategoriaMetodoRow[];
  mediaCategorias = mediaCats.length;

  if (mediaCats.length > 0) {
    const codes = mediaCats.map((c) => c.category_code);

    // Snapshots salvos (valor + índice).
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

    // Índices percentuais do ano do orçamento.
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

    // Mapeamento categoria→conta (override da empresa > global).
    const { data: mapRows, error: mapErr } = await supabase
      .from("category_mapping")
      .select("omie_category_code, dre_account_id, company_id")
      .in("omie_category_code", codes)
      .or(`company_id.eq.${companyId},company_id.is.null`);
    if (mapErr) return { error: mapErr.message };
    const mapByCode = new Map<string, string | null>();
    for (const r of (mapRows ?? []) as CategoryMappingRow[]) {
      // Override da empresa tem prioridade: sobrescreve o global.
      if (r.company_id === companyId) mapByCode.set(r.omie_category_code, r.dre_account_id);
      else if (!mapByCode.has(r.omie_category_code)) mapByCode.set(r.omie_category_code, r.dre_account_id);
    }

    for (const cat of mediaCats) {
      const snap = snapByCode.get(cat.category_code);
      const bruto = snap?.media_valor == null ? null : Number(snap.media_valor);
      const projetado = projetarMedia(bruto, indicePercent(snap?.indice_key ?? null));
      if (projetado == null || projetado === 0) {
        mediaSemValor += 1;
        continue;
      }
      // A média é um valor MENSAL: entra igual nos 12 meses.
      const meses = Array<number>(12).fill(projetado);
      const rawAccountId = mapByCode.get(cat.category_code) ?? null;
      const scopedId = rawAccountId ? scope.translateToScopedId(rawAccountId) : null;
      if (!scopedId) {
        categoriasNaoMapeadas.push({
          chave: cat.category_name ?? cat.category_code,
          meses,
          totalAno: somar(meses),
        });
        continue;
      }
      pushMeses(leafByScopedId, scopedId, meses);
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
      if (!scopedId) {
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
        totalDespesa,
        totalReceita,
      },
    },
  };
}
