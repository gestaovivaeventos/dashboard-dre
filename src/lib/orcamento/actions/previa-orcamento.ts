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
import {
  apenasCanonicas,
  categoriaSerie,
  periodicidadeLabel,
  serieItem,
  toPeriodicidade,
  type Periodicidade,
} from "@/lib/orcamento/planejamento-calc";
import { getPrevia } from "@/lib/orcamento/actions/pessoal";
import { rotuloOrcamento } from "@/lib/orcamento/previa-budget-labels";
import { vinculoLabel } from "@/lib/orcamento/vinculos";
import { metodoLabel, type OrcamentoMetodo } from "@/lib/orcamento/metodos";
import { workspaceTabHref } from "@/lib/orcamento/workspace-tabs";
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

/**
 * De onde veio um pedaço do valor de uma linha — o drilldown da Prévia.
 *
 * A Prévia soma tudo num acumulador por conta; sem isto, o número final não
 * conta de qual categoria/método ele veio. Guardamos a contribuição de cada
 * origem em paralelo à soma, com o link para a tela que a produziu.
 */
/**
 * 2º nível do drilldown: o que compõe UMA origem. Cada método tem a sua
 * granularidade natural — o item que o gestor planejou, o contrato de valor
 * fixo, o colaborador da folha.
 */
export interface PreviaFonteItem {
  nome: string;
  /** Complemento curto (periodicidade, vínculo, índice…). */
  detalhe?: string;
  meses: number[];
  totalAno: number;
}

export interface PreviaFonte {
  /** Chave do método (metodos.ts) — também é o slug da aba do workspace. */
  metodo: string;
  metodoLabel: string;
  /** Nome da categoria, ou o rótulo da linha no caso do pessoal. */
  chave: string;
  meses: number[];
  totalAno: number;
  /** Rota da tela de origem, para abrir em nova aba. */
  href: string;
  /** Abertura da origem. Vazio quando o método não tem nível abaixo. */
  itens: PreviaFonteItem[];
}

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
  /** Origens que compõem esta linha (vazio em linha calculada por fórmula). */
  fontes: PreviaFonte[];
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
  /**
   * Propostas de categorias gêmeas "(*)" que NÃO entram no orçamento porque a
   * canônica de mesmo nome também é planejada — o card é um só. Ficam visíveis
   * para que um planejamento feito ali não desapareça em silêncio.
   */
  planejamentoGemeaIgnorada: PreviaOrfao[];
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
  /** Rótulo do contrato — só preenchido quando a categoria tem 2+. */
  descricao: string | null;
}
interface CategoryMappingRow {
  omie_category_code: string;
  dre_account_id: string | null;
  company_id: string | null;
}

const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Moeda curta para o texto de detalhe do item (sem centavos quando redondo). */
function formatBRLSimples(v: number): string {
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: v % 1 === 0 ? 0 : 2,
  });
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
  // Origens que compõem cada folha, na mesma ordem em que são somadas — é o
  // que permite o drilldown sem recalcular nada.
  const fontesByScopedId = new Map<string, PreviaFonte[]>();
  const pushFonte = (scopedId: string, fonte: PreviaFonte) => {
    const lista = fontesByScopedId.get(scopedId) ?? [];
    lista.push(fonte);
    fontesByScopedId.set(scopedId, lista);
  };
  const pessoalNaoClassificado: PreviaOrfao[] = [];
  const categoriasNaoMapeadas: PreviaOrfao[] = [];
  const planejamentoGemeaIgnorada: PreviaOrfao[] = [];

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
  // A gêmea "(*)" não vira card próprio no Planejamento quando a canônica de
  // mesmo nome também é planejada (o card é um só, e o realizado dele já soma
  // as duas). A Prévia tem de orçar exatamente o que a tela mostra, senão soma
  // uma proposta que ninguém consegue abrir nem editar.
  const psCatsTodas = metodoCats.filter((c) => c.metodo === "planejamento_socios");
  const psCats = apenasCanonicas(
    psCatsTodas.map((c) => ({ ...c, categoryName: c.category_name ?? c.category_code })),
  );
  const psGemeasIgnoradas = psCatsTodas.filter(
    (c) => !psCats.some((k) => k.category_code === c.category_code),
  );
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
    const aplicar = (
      code: string,
      chave: string,
      meses: number[],
      metodo: string,
      itens: PreviaFonteItem[] = [],
    ) => {
      const rawAccountId = mapByCode.get(code) ?? null;
      const scopedId = rawAccountId ? scope.translateToScopedId(rawAccountId) : null;
      // Sem conta mapeada, ou mapeada para fora da faixa renderizada (coreIds):
      // fica órfão visível, nunca descartado.
      if (!scopedId || !coreIds.has(scopedId)) {
        categoriasNaoMapeadas.push({ chave, meses, totalAno: somar(meses) });
        return;
      }
      pushMeses(leafByScopedId, scopedId, meses);
      pushFonte(scopedId, {
        metodo,
        metodoLabel: metodoLabel(metodo as OrcamentoMetodo),
        chave,
        meses,
        totalAno: somar(meses),
        href: workspaceTabHref(companyId, year, metodo),
        itens,
      });
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
      // Uma linha POR SETOR: a categoria pode ser orçada pelo Comercial e pelo
      // Produto. Agrupa em lista e soma — um Map por código perderia setores.
      const snapsByCode = new Map<string, MediaSnapshotRow[]>();
      for (const r of (snapRows ?? []) as MediaSnapshotRow[]) {
        const lista = snapsByCode.get(r.category_code) ?? [];
        lista.push(r);
        snapsByCode.set(r.category_code, lista);
      }
      // Realizado do ano-base AO VIVO — mesmo cálculo da tela de Média. A prévia
      // lia só o snapshot salvo, mas a tela mostra `mediaValor ?? realizado.media`
      // (sugestão viva antes de "Recalcular p/ salvar"): categoria com valor
      // vivo mas sem snapshot aparecia zerada aqui. Usamos o MESMO efetivo.
      const mediaCodes = mediaCats.map((c) => c.category_code);
      const realizados = await fetchRealizados(supabase, companyId, year - 1, mediaCodes);
      for (const cat of mediaCats) {
        const snaps = snapsByCode.get(cat.category_code) ?? [];
        // Sem nenhuma linha gravada, vale a média VIVA do realizado (é o que a
        // tela mostra antes de "Recalcular p/ salvar"). Com linhas, soma-se o
        // projetado de cada setor.
        const parcelas = snaps.length > 0 ? snaps : [null];
        let projetado = 0;
        let bruto: number | null = null;
        let snap: MediaSnapshotRow | null = null;
        for (const s of parcelas) {
          const brutoParcela =
            s?.media_valor != null
              ? Number(s.media_valor)
              : realizados.get(cat.category_code)?.media ?? null;
          const proj = projetarMedia(brutoParcela, indicePercent(s?.indice_key ?? null));
          if (proj == null) continue;
          projetado += proj;
          // Guarda a maior parcela só para o texto do drilldown.
          if (bruto == null || (brutoParcela ?? 0) > bruto) {
            bruto = brutoParcela;
            snap = s;
          }
        }
        if (projetado === 0) {
          mediaSemValor += 1;
          continue;
        }
        // A média não tem sublinhas: o item único explica de onde saiu o
        // número (média do realizado do ano-base + índice aplicado).
        const indiceNome = snap?.indice_key
          ? INDICES.find((i) => i.key === snap.indice_key)?.label ?? snap.indice_key
          : null;
        const detalheMedia = [
          bruto != null ? `média ${formatBRLSimples(bruto)}/mês em ${year - 1}` : null,
          indiceNome ? `corrigida por ${indiceNome}` : "sem correção",
        ]
          .filter(Boolean)
          .join(" · ");
        aplicar(
          cat.category_code,
          cat.category_name ?? cat.category_code,
          Array<number>(12).fill(projetado),
          "media",
          [
            {
              nome: cat.category_name ?? cat.category_code,
              detalhe: detalheMedia,
              meses: Array<number>(12).fill(projetado),
              totalAno: projetado * 12,
            },
          ],
        );
      }
    }

    // VALOR FIXO — valor base + índice, com o degrau do mês de reajuste.
    if (vfCats.length > 0) {
      const { data: vfRows, error: vfErr } = await supabase
        .from("orcamento_valor_fixo_categorias")
        .select("category_code, valor_base, indice_key, mes_reajuste, descricao")
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
        const itensVf: PreviaFonteItem[] = [];
        for (const snap of contratos) {
          const base = snap.valor_base == null ? null : Number(snap.valor_base);
          if (base == null) continue;
          const mes = snap.mes_reajuste == null ? null : Number(snap.mes_reajuste);
          // O salário mínimo corrige por valor absoluto (unit 'brl'); os demais, %.
          const unit = INDICE_UNIT.get(snap.indice_key ?? "") ?? "percent";
          const serie = projetarValorFixoSerie(base, indicePercent(snap.indice_key ?? null), mes, unit);
          for (let m = 0; m < 12; m += 1) meses[m] += serie[m] ?? 0;
          const indiceNome = snap.indice_key
            ? INDICES.find((i) => i.key === snap.indice_key)?.label ?? snap.indice_key
            : null;
          itensVf.push({
            // Contrato único costuma vir sem descrição — cai no nome da categoria.
            nome: snap.descricao?.trim() || (cat.category_name ?? cat.category_code),
            detalhe: [
              `base ${formatBRLSimples(base)}`,
              indiceNome ? `${indiceNome}${mes ? ` em ${MESES_CURTO[mes - 1]}` : ""}` : "sem correção",
            ].join(" · "),
            meses: serie.slice(0, 12),
            totalAno: serie.reduce((a, b) => a + b, 0),
          });
        }
        // "Sem valor" quando nenhum contrato tem base (a soma zera).
        if (somar(meses) === 0) {
          valorFixoSemValor += 1;
          continue;
        }
        aplicar(cat.category_code, cat.category_name ?? cat.category_code, meses, "valor_fixo", itensVf);
      }
    }

    // PLANEJAMENTO DOS SÓCIOS — só a PROPOSTA CONFIRMADA (Etapa 3, saída da
    // entrevista) entra na Prévia. Ela vive na coluna jsonb `proposta` da
    // categoria; a base (o que a IA considera) NÃO é orçamento. Cada item tem
    // valor + mês + periodicidade; o orçado = SOMA das séries; cai na linha da
    // DRE pela mesma chave category_code → category_mapping.
    if (psCats.length > 0) {
      const { data: psRows, error: psErr } = await supabase
        .from("orcamento_planejamento_socios")
        .select("category_code, proposta, proposta_confirmada")
        .eq("company_id", companyId)
        .eq("year", year);
      // Migration ainda não aplicada: não bloqueia a Prévia inteira (os demais
      // métodos continuam) — essas categorias só contam como "sem valor".
      if (psErr && !isSchemaMissing(psErr.message)) return { error: psErr.message };
      const psByCode = new Map<
        string,
        {
          descricao: string;
          valorMensal: number;
          mesInicio: number;
          mesFim: number | null;
          periodicidade: Periodicidade;
        }[]
      >();
      ((psRows ?? []) as { category_code: string; proposta: unknown; proposta_confirmada: boolean | null }[]).forEach(
        (r) => {
          if (r.proposta_confirmada !== true) return; // só a proposta CONFIRMADA
          const p = r.proposta as { itens?: unknown } | null;
          const itens = Array.isArray(p?.itens) ? (p!.itens as Record<string, unknown>[]) : [];
          const arr = itens.map((it) => {
            const valor = Number(it.valorMensal ?? it.valor_mensal ?? 0);
            const mes = Number(it.mesInicio ?? it.mes_inicio ?? 1);
            const fimRaw = it.mesFim ?? it.mes_fim;
            const fim = fimRaw == null ? null : Number(fimRaw);
            // toPeriodicidade cobre as 5 opções (mensal..anual) e cai em mensal
            // quando o valor gravado é desconhecido.
            const periodicidade = toPeriodicidade(it.periodicidade);
            return {
              descricao: typeof it.descricao === "string" && it.descricao.trim() !== ""
                ? it.descricao.trim()
                : "Item sem descrição",
              valorMensal: Number.isFinite(valor) && valor > 0 ? valor : 0,
              mesInicio: Number.isFinite(mes) ? Math.min(12, Math.max(1, Math.round(mes))) : 1,
              mesFim: fim != null && Number.isFinite(fim) && fim >= 1 && fim <= 12 ? Math.round(fim) : null,
              periodicidade,
            };
          });
          // ACUMULA: a categoria pode ter uma proposta POR SETOR, e o orçado da
          // categoria é a soma de todas. Sobrescrever perderia setores.
          if (arr.length > 0) {
            const acumulado = psByCode.get(r.category_code) ?? [];
            acumulado.push(...arr);
            psByCode.set(r.category_code, acumulado);
          }
        },
      );
      for (const cat of psCats) {
        const itensProposta = psByCode.get(cat.category_code) ?? [];
        const meses = categoriaSerie(itensProposta);
        if (somar(meses) === 0) {
          planejamentoSemValor += 1;
          continue;
        }
        // Cada item que o gestor planejou vira uma linha do drilldown, com a
        // própria série (a periodicidade muda em quais meses ele cai).
        const itensPs: PreviaFonteItem[] = itensProposta
          .map((it) => {
            const serie = serieItem(it.valorMensal, it.mesInicio, it.periodicidade, it.mesFim);
            const ate =
              it.periodicidade !== "anual" && it.mesFim != null && it.mesFim < 12
                ? ` até ${MESES_CURTO[it.mesFim - 1]}`
                : "";
            return {
              nome: it.descricao,
              detalhe: `${formatBRLSimples(it.valorMensal)} ${periodicidadeLabel(it.periodicidade)} · a partir de ${MESES_CURTO[it.mesInicio - 1]}${ate}`,
              meses: serie,
              totalAno: serie.reduce((a, b) => a + b, 0),
            };
          })
          .filter((i) => i.totalAno !== 0)
          .sort((a, b) => b.totalAno - a.totalAno);
        aplicar(
          cat.category_code,
          cat.category_name ?? cat.category_code,
          meses,
          "planejamento_socios",
          itensPs,
        );
      }

      // Proposta gravada numa gêmea "(*)" que o card canônico substituiu: não
      // entra no orçamento, mas é reportada para o planejamento não sumir calado.
      for (const cat of psGemeasIgnoradas) {
        const meses = categoriaSerie(psByCode.get(cat.category_code) ?? []);
        if (somar(meses) === 0) continue;
        planejamentoGemeaIgnorada.push({
          chave: cat.category_name ?? cat.category_code,
          meses,
          totalAno: somar(meses),
        });
      }
    }
  }

  // ── PESSOAL ─────────────────────────────────────────────────────────────────
  // A empresa inteira (SETOR_TODOS) — é o número que vai para a DRE.
  const previaRes = await getPrevia(companyId, year, {
    setorId: SETOR_TODOS,
    detalharColaboradores: true,
  });
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
      // Abertura: quanto cada colaborador contribui NESTA linha (o salário
      // dele, o INSS dele…). Só quem tem valor na linha entra.
      const itensPessoal: PreviaFonteItem[] = (previaRes.payload.porColaborador ?? [])
        .map((colab): PreviaFonteItem | null => {
          const dele = colab.linhas.find((l) => l.key === linha.key);
          if (!dele || dele.totalAno === 0) return null;
          return {
            nome: colab.nome?.trim() || "Sem nome",
            detalhe: vinculoLabel(colab.vinculo),
            meses: dele.meses,
            totalAno: dele.totalAno,
          };
        })
        .filter((x): x is PreviaFonteItem => x != null)
        .sort((a, b) => b.totalAno - a.totalAno);
      pushFonte(scopedId, {
        metodo: "pessoal",
        metodoLabel: metodoLabel("pessoal"),
        chave: linha.label,
        meses: linha.meses,
        totalAno: somar(linha.meses),
        href: workspaceTabHref(companyId, year, "pessoal"),
        itens: itensPessoal,
      });
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

  // ── Fontes por linha ───────────────────────────────────────────────────────
  // A folha tem as suas; a totalizadora herda as dos descendentes, para o
  // drilldown funcionar também num nível agregado. Linha CALCULADA (fórmula)
  // fica de fora: ela combina outras linhas com sinais, e listar origens ali
  // sugeriria uma soma simples que não é o que a fórmula faz.
  const filhosPorPai = new Map<string, string[]>();
  for (const conta of scope.coreAccounts) {
    if (!conta.parent_id) continue;
    const lista = filhosPorPai.get(conta.parent_id) ?? [];
    lista.push(conta.id);
    filhosPorPai.set(conta.parent_id, lista);
  }
  const fontesMemo = new Map<string, PreviaFonte[]>();
  const coletarFontes = (id: string): PreviaFonte[] => {
    const pronto = fontesMemo.get(id);
    if (pronto) return pronto;
    const acc = [...(fontesByScopedId.get(id) ?? [])];
    for (const filho of filhosPorPai.get(id) ?? []) acc.push(...coletarFontes(filho));
    // Maior contribuição primeiro: é o que o leitor quer ver de cara.
    acc.sort((a, b) => b.totalAno - a.totalAno);
    fontesMemo.set(id, acc);
    return acc;
  };

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
      fontes: row.type === "calculado" ? [] : coletarFontes(row.id),
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
      planejamentoGemeaIgnorada,
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
