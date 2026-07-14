import type { SupabaseClient } from "@supabase/supabase-js";

import { omieCall } from "@/lib/omie/client";
import { decryptSecret } from "@/lib/security/encryption";

// Fonte dos dados: Movimentos Financeiros (mf/ListarMovimentos). É a ÚNICA
// listagem da Omie que expõe o SALDO EM ABERTO por título (resumo.nValAberto) —
// o `contareceber/ListarContasReceber` só traz o valor do documento (cheio),
// então não enxerga recebimentos parciais nem distingue aberto de recebido.
const MF_URL = "https://app.omie.com.br/api/v1/financas/mf/";
const CLIENTES_URL = "https://app.omie.com.br/api/v1/geral/clientes/";
const CATEGORIAS_URL = "https://app.omie.com.br/api/v1/geral/categorias/";
const PROJETOS_URL = "https://app.omie.com.br/api/v1/geral/projetos/";
// O saldo em aberto vem do MF; o PROJETO só existe no contareceber. Casamos os
// dois pelo código do título (mf.detalhes.nCodTitulo == codigo_lancamento_omie).
const CONTARECEBER_URL = "https://app.omie.com.br/api/v1/financas/contareceber/";

// Poucos clientes na tela do BI (visão executiva). O gestor vê a lista completa
// pela planilha exportada (botão "Exportar detalhamento").
const MAX_CLIENTES_VISUAIS = 5;

// Teto de segurança de páginas do MF (500 registros/página).
const MF_MAX_PAGINAS = 400;

// Faixas de atraso (aging) na ordem de leitura. `min`/`max` em dias de atraso
// (inclusivos); "A vencer" é o balde dos títulos ainda não vencidos.
const AGING_BUCKETS: Array<{ faixa: string; min: number; max: number }> = [
  { faixa: "1 a 30 dias", min: 1, max: 30 },
  { faixa: "31 a 60 dias", min: 31, max: 60 },
  { faixa: "61 a 90 dias", min: 61, max: 90 },
  { faixa: "Acima de 90 dias", min: 91, max: Number.MAX_SAFE_INTEGER },
];
const AGING_A_VENCER = "A vencer";

interface CompanyConfig {
  id: string;
  name: string;
  omie_app_key: string | null;
  omie_app_secret: string | null;
  has_department_apportionment: boolean;
}

interface DepartmentRow {
  omie_code: string;
  included: boolean;
  // Quando preenchido, o departamento é ROTEADO para outra empresa (ex.: SIRENA
  // dentro da Feat vai para a empresa Sirena). Seus dados NÃO são da Feat.
  routed_to_company_id: string | null;
}

// Parte de rateio de departamento de um título (da distribuicao do contareceber).
interface DepartmentPart {
  code: string;
  percentual: number; // fração 0..1
}

// Dados do título que só o contareceber expõe (o MF não tem): projeto + rateio
// de departamento (distribuicao).
interface TituloExtra {
  projetoCode: string | null;
  deptParts: DepartmentPart[];
}

// ─── Saída ──────────────────────────────────────────────────────────────────

export interface FeatAgingBucket {
  faixa: string;
  valor: number;
  titulos: number;
}

export interface FeatClienteReceberAberto {
  cliente: string;
  valorEmAberto: number;
  valorEmAtraso: number;
  diasAtrasoMax: number;
  titulos: number;
  titulosEmAtraso: number;
}

// Um título individual (linha do detalhamento exportável). É o que compõe os
// totais — usado só na planilha de export, não vai para a IA.
export interface FeatContaReceberDetalhe {
  cliente: string; // nome fantasia (fallback: razão social)
  projeto: string;
  categoria: string;
  dataVencimento: string | null;
  dataPrevisao: string | null;
  status: "Em atraso" | "A vencer";
  diasAtraso: number;
  valorEmAberto: number;
}

export interface FeatContasReceberAbertoPayload {
  referenciaLabel: string;
  totalEmAberto: number;
  totalEmAtraso: number;
  // Parcela dos totais acima que vem da categoria "Patrocínio" (detalhamento
  // gerencial pedido pela Feat). Exibida abaixo de cada total.
  patrocinioEmAberto: number;
  patrocinioEmAtraso: number;
  percentualEmAtraso: number;
  titulosEmAberto: number;
  titulosEmAtraso: number;
  clientesEmAberto: number;
  clientesEmAtraso: number;
  aging: FeatAgingBucket[];
  clientes: FeatClienteReceberAberto[];
  clientesExibidos: number;
  clientesTotais: number;
  restanteValor: number;
  // Detalhamento título a título (todos os que compõem os totais), para o
  // gestor exportar em planilha. Ordenado: em atraso primeiro, maior atraso.
  detalhes: FeatContaReceberDetalhe[];
}

export interface FeatContasReceberAbertoResumoIA {
  referencia: string;
  total_em_aberto: number;
  total_em_atraso: number;
  patrocinio_em_aberto: number;
  patrocinio_em_atraso: number;
  percentual_em_atraso: number;
  titulos_em_aberto: number;
  titulos_em_atraso: number;
  clientes_em_aberto: number;
  clientes_em_atraso: number;
  aging: Array<{ faixa: string; valor: number; titulos: number }>;
  principais_clientes: Array<{
    cliente: string;
    valor_em_aberto: number;
    valor_em_atraso: number;
    dias_atraso_max: number;
    titulos: number;
    titulos_em_atraso: number;
  }>;
}

export interface FeatContasReceberAbertoResult {
  payload: FeatContasReceberAbertoPayload;
  resumoIA: FeatContasReceberAbertoResumoIA;
}

// ─── Helpers genéricos ────────────────────────────────────────────────────────

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function isFeatProducoes(name: string): boolean {
  const n = normalizeName(name);
  return n.includes("feat") && n.includes("produ");
}

function getString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function getNumber(record: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim()) {
      const normalized = value.replace(/\./g, "").replace(",", ".");
      const n = Number(normalized);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

function extractArray(response: Record<string, unknown>): Record<string, unknown>[] {
  for (const value of Object.values(response)) {
    if (Array.isArray(value)) return value as Record<string, unknown>[];
  }
  return [];
}

function parsePtBrDate(value: string | null): Date | null {
  if (!value) return null;
  const normalized = value.replace(/-/g, "/");
  const [dd, mm, yyyy] = normalized.split("/");
  if (!dd || !mm || !yyyy) return null;
  const date = new Date(Number(yyyy), Number(mm) - 1, Number(dd));
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayStart(): Date {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

// Dias de atraso a partir da data de vencimento. 0 quando não vencido ou sem
// data válida.
function diasEmAtraso(dueDate: Date | null): number {
  if (!dueDate) return 0;
  const diff = todayStart().getTime() - dueDate.getTime();
  if (diff <= 0) return 0;
  return Math.floor(diff / 86_400_000);
}

function agingFaixa(emAtraso: boolean, dias: number): string {
  if (!emAtraso) return AGING_A_VENCER;
  const bucket = AGING_BUCKETS.find((b) => dias >= b.min && dias <= b.max);
  return bucket?.faixa ?? AGING_BUCKETS[0].faixa;
}

// Categorias de SISTEMA da Omie terminam em "(*)" (ex.: "Entrada de
// Transferência (*)") e representam transferências internas entre contas —
// NÃO são recebíveis de clientes. Ficam de fora desta visão.
function isCategoriaSistema(categoria: string): boolean {
  return /\(\s*\*\s*\)\s*$/.test(categoria);
}

// Detalhamento pedido pelo gestor da Feat: dentro dos totais em aberto/atraso,
// quanto vem da categoria "Patrocínio". Casamento por NOME normalizado (sem
// acento, minúsculo) para tolerar variações de cadastro ("Patrocínios",
// "Receita de Patrocínio" etc.).
function isPatrocinio(categoria: string): boolean {
  return normalizeName(categoria).includes("patrocinio");
}

// ─── Leitura da Omie ──────────────────────────────────────────────────────────

interface MovimentoReceber {
  tituloCode: string | null;
  clienteCode: string | null;
  categoriaCode: string | null;
  dataVencimento: string | null;
  dataPrevisao: string | null;
  valorEmAberto: number;
}

// Percorre mf/ListarMovimentos filtrando natureza "R" (receita) e STATUS
// "EMABERTO" e devolve só os títulos de CONTA A RECEBER com saldo em aberto.
// O filtro cStatus=EMABERTO é decisivo para performance: traz só os ~100 títulos
// abertos (2 páginas) em vez de varrer TODOS os ~50k movimentos históricos. O
// "EMABERTO" da Omie já engloba a vencer, atrasados e recebimentos parciais, e o
// saldo (resumo.nValAberto) já é líquido dos recebimentos parciais.
async function fetchMovimentosReceberAbertos(
  appKey: string,
  appSecret: string,
): Promise<MovimentoReceber[]> {
  const out: MovimentoReceber[] = [];
  let pagina = 1;
  let totalPaginas = 1;

  while (pagina <= totalPaginas && pagina <= MF_MAX_PAGINAS) {
    const { data, notFound } = await omieCall(MF_URL, "ListarMovimentos", appKey, appSecret, {
      nPagina: pagina,
      nRegPorPagina: 500,
      cNatureza: "R",
      cStatus: "EMABERTO",
    });
    if (notFound) break;

    const movimentos = (data.movimentos as Array<Record<string, unknown>> | undefined) ?? [];
    for (const mov of movimentos) {
      const detalhes = (mov.detalhes as Record<string, unknown> | undefined) ?? {};
      const resumo = (mov.resumo as Record<string, unknown> | undefined) ?? {};

      // Só contas a receber (exclui adiantamentos/transferências de natureza R).
      const grupo = getString(detalhes, ["cGrupo"]);
      if (grupo && grupo !== "CONTA_A_RECEBER") continue;

      const valorEmAberto = getNumber(resumo, ["nValAberto"]) ?? 0;
      if (valorEmAberto <= 0) continue; // recebido/liquidado — sem saldo aberto

      out.push({
        tituloCode: getString(detalhes, ["nCodTitulo"]),
        clienteCode: getString(detalhes, ["nCodCliente"]),
        categoriaCode: getString(detalhes, ["cCodCateg"]),
        dataVencimento: getString(detalhes, ["dDtVenc"]),
        dataPrevisao: getString(detalhes, ["dDtPrevisao"]),
        valorEmAberto: round2(valorEmAberto),
      });
    }

    totalPaginas = Number(getString(data, ["nTotPaginas", "total_de_paginas"]) ?? "1");
    if (!Number.isFinite(totalPaginas) || totalPaginas < 1) totalPaginas = pagina;
    pagina += 1;
  }

  return out;
}

interface ClienteNome {
  // Nome oficial (razão social) — usado na tela, no ranking por cliente.
  razao: string;
  // Nome fantasia — usado na planilha exportada. Cai para a razão quando vazio.
  fantasia: string;
}

async function fetchClientNames(
  appKey: string,
  appSecret: string,
): Promise<Map<string, ClienteNome>> {
  const byCode = new Map<string, ClienteNome>();
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    try {
      const { data, notFound } = await omieCall(
        CLIENTES_URL,
        "ListarClientesResumido",
        appKey,
        appSecret,
        { pagina, registros_por_pagina: 500 },
      );
      if (notFound) break;
      for (const record of extractArray(data)) {
        const code = getString(record, ["codigo_cliente", "codigo_cliente_omie", "nCodCliente"]);
        // razao: nome oficial (mesmo critério do mapCadastro validado em
        // src/lib/omie/clientes.ts). fantasia: nome fantasia com fallback p/ razão.
        const razao = getString(record, ["razao_social", "nome_fantasia", "fantasia", "nome"]);
        const fantasia = getString(record, ["nome_fantasia", "fantasia", "razao_social", "nome"]);
        if (code && razao) byCode.set(code, { razao, fantasia: fantasia ?? razao });
      }
      totalPaginas = Number(getString(data, ["total_de_paginas", "nTotPaginas"]) ?? "1");
      if (!Number.isFinite(totalPaginas) || totalPaginas < 1) totalPaginas = pagina;
      pagina += 1;
    } catch {
      break;
    }
  }
  return byCode;
}

function collectCategories(records: Record<string, unknown>[], result: Map<string, string>) {
  for (const record of records) {
    const code = getString(record, ["codigo", "codigo_categoria"]);
    const name = getString(record, ["descricao", "descricao_padrao", "nome"]);
    if (code && name) result.set(code, name);
    const children = record.categorias ?? record.categoria_cadastro;
    if (Array.isArray(children)) {
      collectCategories(children as Record<string, unknown>[], result);
    }
  }
}

async function fetchCategoryNames(appKey: string, appSecret: string): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    try {
      const { data, notFound } = await omieCall(CATEGORIAS_URL, "ListarCategorias", appKey, appSecret, {
        pagina,
        registros_por_pagina: 500,
      });
      if (notFound) break;
      collectCategories(extractArray(data), byCode);
      totalPaginas = Number(
        getString(data, ["total_de_paginas", "total_paginas", "nTotPaginas"]) ?? "1",
      );
      if (!Number.isFinite(totalPaginas) || totalPaginas < 1) totalPaginas = pagina;
      pagina += 1;
    } catch {
      break;
    }
  }
  return byCode;
}

async function fetchProjectNames(appKey: string, appSecret: string): Promise<Map<string, string>> {
  const byCode = new Map<string, string>();
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    try {
      const { data, notFound } = await omieCall(PROJETOS_URL, "ListarProjetos", appKey, appSecret, {
        pagina,
        registros_por_pagina: 500,
      });
      if (notFound) break;
      for (const record of extractArray(data)) {
        const name = getString(record, ["cNome", "nome", "cNomeProjeto", "nome_projeto"]);
        if (!name) continue;
        for (const key of ["nCodProj", "codigo", "nCodProjeto", "codInt", "cCodIntProj"]) {
          const code = getString(record, [key]);
          if (code) byCode.set(code, name);
        }
      }
      totalPaginas = Number(
        getString(data, ["total_de_paginas", "total_paginas", "nTotPaginas"]) ?? "1",
      );
      if (!Number.isFinite(totalPaginas) || totalPaginas < 1) totalPaginas = pagina;
      pagina += 1;
    } catch {
      break;
    }
  }
  return byCode;
}

// Extrai o rateio de departamento da `distribuicao` do título (contareceber).
// Cada item: { cCodDep, cDesDep, nPerDep, nValDep }. Normaliza para frações que
// somam 1. Título sem distribuição → [] (tratado como "sem departamento").
function parseDeptParts(titulo: Record<string, unknown>): DepartmentPart[] {
  const dist = titulo.distribuicao;
  if (!Array.isArray(dist) || dist.length === 0) return [];
  const parts = dist
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const obj = item as Record<string, unknown>;
      const code = getString(obj, ["cCodDep", "codigo_departamento", "cCodDepartamento"]);
      if (!code) return null;
      const weight = getNumber(obj, ["nValDep", "nPerDep", "valor", "percentual"]) ?? 0;
      return { code, weight };
    })
    .filter((p): p is { code: string; weight: number } => p !== null);
  if (parts.length === 0) return [];
  const total = parts.reduce((sum, p) => sum + p.weight, 0);
  if (total <= 0) {
    const eq = 1 / parts.length;
    return parts.map((p) => ({ code: p.code, percentual: eq }));
  }
  return parts.map((p) => ({ code: p.code, percentual: p.weight / total }));
}

// Fração do título que cai em departamentos INCLUÍDOS (selecionados na tela).
// Sem rateio na empresa → 1 (não filtra). Título sem departamento → conta como
// "__none__". 0 = título todo em departamento excluído (ex.: SIRENA) → descartado.
function departmentIncludedPercent(
  deptParts: DepartmentPart[],
  hasApportionment: boolean,
  included: Set<string>,
): number {
  if (!hasApportionment) return 1;
  if (deptParts.length === 0) return included.has("__none__") ? 1 : 0;
  return deptParts.reduce((sum, p) => sum + (included.has(p.code) ? p.percentual : 0), 0);
}

// Mapa códigoDoTítulo → { projeto, rateio de departamento }, lido do
// contareceber/ListarContasReceber (o MF não expõe projeto nem departamento).
// Barato: filtro "apenas em aberto" cabe em poucas páginas. A Omie OMITE
// codigo_projeto quando é 0.
async function fetchTituloExtraByTitulo(
  appKey: string,
  appSecret: string,
): Promise<Map<string, TituloExtra>> {
  const byTitulo = new Map<string, TituloExtra>();
  let pagina = 1;
  let totalPaginas = 1;
  while (pagina <= totalPaginas) {
    try {
      const { data, notFound } = await omieCall(
        CONTARECEBER_URL,
        "ListarContasReceber",
        appKey,
        appSecret,
        { pagina, registros_por_pagina: 200, filtrar_apenas_titulos_em_aberto: "S" },
      );
      if (notFound) break;
      const arr = (data.conta_receber_cadastro as Array<Record<string, unknown>> | undefined) ?? [];
      for (const titulo of arr) {
        const tituloCode = getString(titulo, ["codigo_lancamento_omie"]);
        if (!tituloCode) continue;
        const projetoCodeNum = getNumber(titulo, ["codigo_projeto"]) ?? 0;
        byTitulo.set(tituloCode, {
          projetoCode: projetoCodeNum > 0 ? String(projetoCodeNum) : null,
          deptParts: parseDeptParts(titulo),
        });
      }
      totalPaginas = Number(
        getString(data, ["total_de_paginas", "total_paginas", "nTotPaginas"]) ?? "1",
      );
      if (!Number.isFinite(totalPaginas) || totalPaginas < 1) totalPaginas = pagina;
      pagina += 1;
    } catch {
      break;
    }
  }
  return byTitulo;
}

// ─── Cache de dados de referência ─────────────────────────────────────────────
//
// Nomes de clientes, categorias e projetos são DADOS DE REFERÊNCIA — mudam pouco
// e custam caro (o endpoint de clientes devolve só 100/página → ~16 páginas). Já
// os VALORES/STATUS dos recebíveis (MF + contareceber) são SEMPRE lidos ao vivo.
// Cacheamos só os mapas de nomes por empresa, com TTL curto: gerações repetidas
// na mesma instância pulam ~20 chamadas sem deixar os valores desatualizados.

interface ReferenceData {
  clientes: Map<string, ClienteNome>;
  categorias: Map<string, string>;
  projetos: Map<string, string>;
}

const REFERENCE_TTL_MS = 15 * 60 * 1000; // 15 min
const referenceCache = new Map<string, { at: number; data: ReferenceData }>();

async function getReferenceData(
  companyId: string,
  appKey: string,
  appSecret: string,
): Promise<ReferenceData> {
  const cached = referenceCache.get(companyId);
  if (cached && Date.now() - cached.at < REFERENCE_TTL_MS) return cached.data;

  // Sequencial de propósito: o omieCall tem rate-limit global de 350ms.
  const clientes = await fetchClientNames(appKey, appSecret);
  const categorias = await fetchCategoryNames(appKey, appSecret);
  const projetos = await fetchProjectNames(appKey, appSecret);

  const data: ReferenceData = { clientes, categorias, projetos };
  referenceCache.set(companyId, { at: Date.now(), data });
  return data;
}

// ─── Normalização + resultado ─────────────────────────────────────────────────

interface TituloNormalizado {
  clienteKey: string;
  cliente: string; // razão social (tela / ranking)
  clienteFantasia: string; // nome fantasia (planilha)
  projeto: string;
  categoria: string;
  dataVencimento: string | null;
  dataPrevisao: string | null;
  valorEmAberto: number;
  emAtraso: boolean;
  diasAtraso: number;
}

function emptyResult(referenciaLabel: string): FeatContasReceberAbertoResult {
  const aging: FeatAgingBucket[] = [
    { faixa: AGING_A_VENCER, valor: 0, titulos: 0 },
    ...AGING_BUCKETS.map((b) => ({ faixa: b.faixa, valor: 0, titulos: 0 })),
  ];
  return {
    payload: {
      referenciaLabel,
      totalEmAberto: 0,
      totalEmAtraso: 0,
      patrocinioEmAberto: 0,
      patrocinioEmAtraso: 0,
      percentualEmAtraso: 0,
      titulosEmAberto: 0,
      titulosEmAtraso: 0,
      clientesEmAberto: 0,
      clientesEmAtraso: 0,
      aging,
      clientes: [],
      clientesExibidos: 0,
      clientesTotais: 0,
      restanteValor: 0,
      detalhes: [],
    },
    resumoIA: {
      referencia: referenciaLabel,
      total_em_aberto: 0,
      total_em_atraso: 0,
      patrocinio_em_aberto: 0,
      patrocinio_em_atraso: 0,
      percentual_em_atraso: 0,
      titulos_em_aberto: 0,
      titulos_em_atraso: 0,
      clientes_em_aberto: 0,
      clientes_em_atraso: 0,
      aging: aging.map((b) => ({ faixa: b.faixa, valor: b.valor, titulos: b.titulos })),
      principais_clientes: [],
    },
  };
}

export async function buildFeatContasReceberAberto(
  supabase: SupabaseClient,
  companyId: string,
  referenciaLabel: string,
): Promise<FeatContasReceberAbertoResult | null> {
  const { data: company, error: companyError } = await supabase
    .from("companies")
    .select("id,name,omie_app_key,omie_app_secret,has_department_apportionment")
    .eq("id", companyId)
    .maybeSingle<CompanyConfig>();

  if (companyError || !company || !isFeatProducoes(company.name)) return null;
  if (!company.omie_app_key || !company.omie_app_secret) return null;

  // Departamentos da PRÓPRIA Feat (tela "departamentos"): marcados (included) E
  // NÃO roteados para outra empresa. Um departamento roteado (ex.: SIRENA →
  // empresa Sirena) tem included=true mas pertence ao destino — seus dados são
  // da outra empresa e não podem entrar no BI da Feat.
  const { data: departments } = await supabase
    .from("company_departments")
    .select("omie_code,included,routed_to_company_id")
    .eq("company_id", companyId);
  const includedDepartments = new Set(
    ((departments ?? []) as DepartmentRow[])
      .filter((r) => r.included && !r.routed_to_company_id)
      .map((r) => r.omie_code),
  );

  const appKey = decryptSecret(company.omie_app_key);
  const appSecret = decryptSecret(company.omie_app_secret);

  try {
    // Valores/status dos recebíveis: SEMPRE ao vivo (MF em aberto + projeto e
    // rateio de departamento por título via contareceber). Nomes cacheados.
    const movimentos = await fetchMovimentosReceberAbertos(appKey, appSecret);
    const extraPorTitulo = await fetchTituloExtraByTitulo(appKey, appSecret);
    const { clientes, categorias, projetos } = await getReferenceData(
      companyId,
      appKey,
      appSecret,
    );

    // 1) Normaliza cada título em aberto. Atraso é por DATA DE VENCIMENTO (o
    //    saldo já é o em aberto). Isso inclui os parciais vencidos — que na Omie
    //    figuram com status "RECEBIDO" e por isso ficam de fora do total do
    //    status "ATRASADO", mas têm saldo a receber e devem contar.
    const hoje = todayStart();
    const normalizados: TituloNormalizado[] = [];
    for (const mov of movimentos) {
      const extra = mov.tituloCode ? extraPorTitulo.get(mov.tituloCode) : undefined;

      // Filtro por departamento: mantém só a fração do título que cai em
      // departamentos selecionados na tela. Título 100% em departamento não
      // selecionado (ex.: SIRENA desmarcada) → includedPercent 0 → descartado.
      const includedPercent = departmentIncludedPercent(
        extra?.deptParts ?? [],
        company.has_department_apportionment,
        includedDepartments,
      );
      if (includedPercent <= 0) continue;
      const valorEmAberto = round2(mov.valorEmAberto * includedPercent);
      if (valorEmAberto <= 0) continue;

      const categoria =
        (mov.categoriaCode ? categorias.get(mov.categoriaCode) : null) ??
        mov.categoriaCode ??
        "Sem categoria";
      // Transferências internas (categorias de sistema "(*)") não são recebíveis.
      if (isCategoriaSistema(categoria)) continue;

      const vencimento = parsePtBrDate(mov.dataVencimento ?? mov.dataPrevisao);
      const emAtraso = vencimento ? vencimento < hoje : false;

      const clienteInfo = mov.clienteCode ? clientes.get(mov.clienteCode) : null;
      const cliente = clienteInfo?.razao ?? "Cliente não identificado";

      const projeto =
        (extra?.projetoCode ? projetos.get(extra.projetoCode) : null) ?? "Sem projeto";

      normalizados.push({
        clienteKey: mov.clienteCode ?? cliente,
        cliente,
        clienteFantasia: clienteInfo?.fantasia ?? cliente,
        projeto,
        categoria,
        dataVencimento: mov.dataVencimento,
        dataPrevisao: mov.dataPrevisao,
        valorEmAberto,
        emAtraso,
        diasAtraso: emAtraso ? diasEmAtraso(vencimento) : 0,
      });
    }

    if (normalizados.length === 0) return emptyResult(referenciaLabel);

    // 2) Faixas de aging (valor + nº de títulos por faixa).
    const agingMap = new Map<string, { valor: number; titulos: number }>();
    for (const faixa of [AGING_A_VENCER, ...AGING_BUCKETS.map((b) => b.faixa)]) {
      agingMap.set(faixa, { valor: 0, titulos: 0 });
    }
    for (const t of normalizados) {
      const faixa = agingFaixa(t.emAtraso, t.diasAtraso);
      const acc = agingMap.get(faixa)!;
      acc.valor = round2(acc.valor + t.valorEmAberto);
      acc.titulos += 1;
    }
    const aging: FeatAgingBucket[] = [AGING_A_VENCER, ...AGING_BUCKETS.map((b) => b.faixa)].map(
      (faixa) => ({ faixa, ...agingMap.get(faixa)! }),
    );

    // 3) Consolida por cliente — a visão gerencial (uma linha por cliente).
    const clientesMap = new Map<string, FeatClienteReceberAberto>();
    for (const t of normalizados) {
      const existing = clientesMap.get(t.clienteKey);
      const base =
        existing ??
        ({
          cliente: t.cliente,
          valorEmAberto: 0,
          valorEmAtraso: 0,
          diasAtrasoMax: 0,
          titulos: 0,
          titulosEmAtraso: 0,
        } satisfies FeatClienteReceberAberto);
      base.valorEmAberto = round2(base.valorEmAberto + t.valorEmAberto);
      base.titulos += 1;
      if (t.emAtraso) {
        base.valorEmAtraso = round2(base.valorEmAtraso + t.valorEmAberto);
        base.titulosEmAtraso += 1;
        base.diasAtrasoMax = Math.max(base.diasAtrasoMax, t.diasAtraso);
      }
      clientesMap.set(t.clienteKey, base);
    }

    const clientesOrdenados = Array.from(clientesMap.values()).sort((a, b) => {
      if (b.valorEmAtraso !== a.valorEmAtraso) return b.valorEmAtraso - a.valorEmAtraso;
      return b.valorEmAberto - a.valorEmAberto;
    });

    // 4) Totais.
    const totalEmAberto = round2(normalizados.reduce((sum, t) => sum + t.valorEmAberto, 0));
    const totalEmAtraso = round2(
      normalizados.filter((t) => t.emAtraso).reduce((sum, t) => sum + t.valorEmAberto, 0),
    );
    const titulosEmAtraso = normalizados.filter((t) => t.emAtraso).length;
    const clientesEmAtraso = clientesOrdenados.filter((c) => c.valorEmAtraso > 0).length;
    const percentualEmAtraso =
      totalEmAberto > 0 ? round2((totalEmAtraso / totalEmAberto) * 100) : 0;

    // Detalhamento da categoria "Patrocínio" dentro dos totais (mesma base de
    // títulos que já compõe aberto/atraso — só recorta pela categoria).
    const patrocinioEmAberto = round2(
      normalizados
        .filter((t) => isPatrocinio(t.categoria))
        .reduce((sum, t) => sum + t.valorEmAberto, 0),
    );
    const patrocinioEmAtraso = round2(
      normalizados
        .filter((t) => t.emAtraso && isPatrocinio(t.categoria))
        .reduce((sum, t) => sum + t.valorEmAberto, 0),
    );

    const clientesVisiveis = clientesOrdenados.slice(0, MAX_CLIENTES_VISUAIS);
    const restanteValor = round2(
      clientesOrdenados.slice(MAX_CLIENTES_VISUAIS).reduce((sum, c) => sum + c.valorEmAberto, 0),
    );

    // Detalhamento título a título para exportação — em atraso primeiro, depois
    // maior atraso e maior valor.
    const detalhes: FeatContaReceberDetalhe[] = normalizados
      .slice()
      .sort((a, b) => {
        if (a.emAtraso !== b.emAtraso) return a.emAtraso ? -1 : 1;
        if (b.diasAtraso !== a.diasAtraso) return b.diasAtraso - a.diasAtraso;
        return b.valorEmAberto - a.valorEmAberto;
      })
      .map((t) => ({
        cliente: t.clienteFantasia,
        projeto: t.projeto,
        categoria: t.categoria,
        dataVencimento: t.dataVencimento,
        dataPrevisao: t.dataPrevisao,
        status: t.emAtraso ? "Em atraso" : "A vencer",
        diasAtraso: t.diasAtraso,
        valorEmAberto: t.valorEmAberto,
      }));

    return {
      payload: {
        referenciaLabel,
        totalEmAberto,
        totalEmAtraso,
        patrocinioEmAberto,
        patrocinioEmAtraso,
        percentualEmAtraso,
        titulosEmAberto: normalizados.length,
        titulosEmAtraso,
        clientesEmAberto: clientesOrdenados.length,
        clientesEmAtraso,
        aging,
        clientes: clientesVisiveis,
        clientesExibidos: clientesVisiveis.length,
        clientesTotais: clientesOrdenados.length,
        restanteValor,
        detalhes,
      },
      resumoIA: {
        referencia: referenciaLabel,
        total_em_aberto: totalEmAberto,
        total_em_atraso: totalEmAtraso,
        patrocinio_em_aberto: patrocinioEmAberto,
        patrocinio_em_atraso: patrocinioEmAtraso,
        percentual_em_atraso: percentualEmAtraso,
        titulos_em_aberto: normalizados.length,
        titulos_em_atraso: titulosEmAtraso,
        clientes_em_aberto: clientesOrdenados.length,
        clientes_em_atraso: clientesEmAtraso,
        aging: aging.map((b) => ({ faixa: b.faixa, valor: b.valor, titulos: b.titulos })),
        principais_clientes: clientesVisiveis.map((c) => ({
          cliente: c.cliente,
          valor_em_aberto: c.valorEmAberto,
          valor_em_atraso: c.valorEmAtraso,
          dias_atraso_max: c.diasAtrasoMax,
          titulos: c.titulos,
          titulos_em_atraso: c.titulosEmAtraso,
        })),
      },
    };
  } catch {
    // Leitura auxiliar e controlada: falha na Omie nao deve derrubar o BI validado.
    return null;
  }
}
