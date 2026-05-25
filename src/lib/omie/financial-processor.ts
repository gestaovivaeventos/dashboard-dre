/**
 * PROCESSADOR FINANCEIRO - Camada de Tratamento DRE em Regime de Caixa
 *
 * ============================================================================
 * REGRAS DE NEGOCIO IMPLEMENTADAS:
 * ============================================================================
 *
 * 1. FONTE DE DADOS: API ListarMovimentos da Omie
 * 2. REGRA DO PERIODO: Usa dDtPagamento da baixa real para derivar
 *    ano_pgto e mes_pagamento (regime de caixa).
 * 3. REGRA DO VERIFICADOR_RATEIO: Detecta quantas categorias (1-5) estão
 *    preenchidas no array `categorias` do título-pai.
 * 4. REGRA DO CORRETOR_DUPLICIDADE: Define qual valor usar
 *    (nValPago vs nValLiquido) quando NÃO há baixas separadas.
 * 5. REGRA DAS BAIXAS PARCIAIS (substitui antiga regra de exclusão BAXP):
 *    Movimentos com cOrigem = BAXP/BAXR representam cada baixa individual
 *    de um título (data + valor reais). Quando o título possui registros
 *    BAXP/BAXR no mesmo lote, esses passam a ser a FONTE DE VERDADE para
 *    período e valor — o registro-pai (MANP/RPTP/MANR/RPTR/...) é suprimido
 *    para evitar duplicidade. Isso garante que pagamentos parciais em meses
 *    diferentes apareçam exatamente no mês de cada baixa, em vez de
 *    consolidados na data do último pagamento do título.
 * 6. REGRA DE CONSOLIDAÇÃO: Agrupa por período e categoria da DRE.
 * 7. REGRA DE RATEIO: Quando o pai tem rateio (até 5 categorias), cada
 *    baixa é distribuída proporcionalmente entre as categorias usando
 *    os percentuais do título.
 * 8. DE/PARA: Mapeia categorias Omie para contas DRE.
 * 9. FILTRO DE PERÍODO: Aplica tratativas antes de consolidar.
 * 10. AUDITORIA: Registra decisões de processamento.
 * 11. INTEGRIDADE: Valida inconsistências entre categoria e valor rateado.
 *
 * ============================================================================
 */

export interface RawOmieMovimento {
  // Campos de identificação
  nCodTitulo?: string | number;
  cNumTitulo?: string;
  cNumParcela?: string;
  cOrigem?: string;
  cGrupo?: string;
  cNatureza?: string;

  // Data de pagamento (regime de caixa)
  dDtPagamento?: string;

  // Valores
  nValPago?: string | number;
  nValLiquido?: string | number;
  nValorMovCC?: string | number; // valor da baixa em conta corrente (BAXP/BAXR)
  nCodBaixa?: string | number; // id único da baixa (BAXP/BAXR)

  // Categoria simples (sem rateio)
  cCodCateg?: string;
  cDescricao?: string;

  // Rateio: array "categorias" na RAIZ do registro da API
  // Cada item: { cCodCateg, nDistrPercentual, nDistrValor, nValorFixo }
  categorias?: Array<{
    cCodCateg?: string;
    nDistrPercentual?: number;
    nDistrValor?: number;
    nValorFixo?: string;
  }>;

  // Dados complementares
  cNomeCliente?: string;
  cNomeFornecedor?: string;
  cNumDocFiscal?: string;
  cObs?: string;

  // Subestrutura Omie (flatten para acesso)
  detalhes?: Record<string, unknown>;
  resumo?: Record<string, unknown>;
}

export interface ProcessedFinancialEntry {
  // Identificação único
  omie_id: string;
  company_id: string;

  // Dados base
  type: "receita" | "despesa";
  description: string;
  supplier_customer: string | null;
  document_number: string | null;

  // Valores
  value: number;

  // Data de pagamento (regime de caixa)
  payment_date: string;
  ano_pgto: number;
  mes_pagamento: number;

  // Categoria
  category_code: string | null;
  category_name?: string | null;

  // Departamento Omie (rateio por unidade de negocio). Null quando o
  // lancamento nao esta vinculado a nenhum departamento. O filtro da DRE
  // por departamento (configurado por empresa) usa esse campo.
  department_code: string | null;

  // Rastreabilidade e auditoria
  raw_json: Record<string, unknown>;

  // Metadados de processamento
  processing_metadata: {
    regra_baxp_aplicada: boolean;
    regra_periodo_aplicada: boolean;
    verificador_rateio: number; // 1-5 = numero de categorias rateadas, 0 = sem rateio
    // Quantidade de departamentos no rateio (>= 2 quando o titulo distribui
    // o valor entre departamentos diferentes). 0/undefined = sem rateio dept.
    // Cada combinacao categoria x departamento gera uma entry independente.
    verificador_rateio_dept?: number;
    corretor_duplicidade: number; // 0 = rateio, 1 = valor unico
    source_field_value?: "nValPago" | "nValLiquido" | "nValorMovCC"; // qual valor foi usado
    // Ajuste de cash (desconto/juros/multa). Quando diferente de zero,
    // o valor da entry foi recalculado a partir do bruto da Omie.
    adjusted_for_cash?: boolean;
    gross_value?: number; // valor bruto antes de desconto/juros/multa
    discount_value?: number;
    juros_value?: number;
    multa_value?: number;
  };
}

export interface ProcessingAuditLog {
  movimento_index: number;
  omie_id_source: string;
  status: "aceito" | "rejeitado_baxp" | "rejeitado_sem_data" | "erro";
  razao: string;
  entries_gerados: number;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function getString(
  obj: Record<string, unknown> | undefined,
  keys: string[]
): string | null {
  if (!obj) return null;
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return null;
}

function parseDate(input: unknown): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const trimmed = input.trim();

  // Formato ISO YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // Formato DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(trimmed)) {
    const [day, month, year] = trimmed.split("/");
    return `${year}-${month}-${day}`;
  }

  // Tenta parse como Date
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return null;
}

function parseNumber(input: unknown): number {
  if (typeof input === "number" && Number.isFinite(input)) return input;
  if (typeof input === "string") {
    const normalized = input.replace(/\./g, "").replace(",", ".");
    const parsed = Number(normalized);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function flattenMovimento(raw: RawOmieMovimento): RawOmieMovimento {
  const result: RawOmieMovimento = { ...raw };

  // Se tem detalhes, merge com prioridade para o nível raiz
  if (raw.detalhes && typeof raw.detalhes === "object") {
    const detalhes = raw.detalhes as Record<string, unknown>;
    for (const [key, value] of Object.entries(detalhes)) {
      if (!(key in result) || result[key as keyof RawOmieMovimento] === undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }

  // Se tem resumo, uso como fallback
  if (raw.resumo && typeof raw.resumo === "object") {
    const resumo = raw.resumo as Record<string, unknown>;
    for (const [key, value] of Object.entries(resumo)) {
      if (!(key in result) || result[key as keyof RawOmieMovimento] === undefined) {
        (result as Record<string, unknown>)[key] = value;
      }
    }
  }

  return result;
}

// ============================================================================
// REGRA 3: VERIFICADOR_RATEIO
// ============================================================================
// Identifica quantas categorias rateadas existem verificando o array "categorias"
// que a API ListarMovimentos retorna na RAIZ do registro (ao lado de detalhes/resumo).
// Retorna:
//   0 = sem rateio (array não existe ou vazio)
//   N = número de categorias rateadas (1 a 5)
// ============================================================================
function detectVerificadorRateio(record: RawOmieMovimento): number {
  const categorias = record.categorias;
  if (!Array.isArray(categorias) || categorias.length === 0) return 0;
  return categorias.length;
}

// ============================================================================
// EXTRAcaO DE DEPARTAMENTO (com suporte a rateio)
// ============================================================================
// Quando o sync chama ListarMovimentos com cExibirDepartamentos=S, a Omie
// retorna o vinculo de departamento de duas formas (depende do tipo do
// movimento e do plano da empresa):
//
//   1. Array `departamentos` na raiz (analogo a `categorias`), com itens no
//      formato { cCodDepartamento, nDistrPercentual, nDistrValor }. Quando
//      o titulo possui rateio entre 2+ departamentos (caso comum em empresas
//      com unidades de negocio compartilhadas), cada item carrega o
//      percentual e o valor distribuido para aquele departamento.
//   2. Campo escalar `cCodDepartamento` em `detalhes` — usado quando ha
//      apenas 1 departamento e a Omie nao expoe o array.
//
// Empresas como Hero/Viva Go (mesmo aplicativo Omie) usam rateio entre 2+
// departamentos para dividir despesas administrativas — ex.: aluguel total
// 2.304 distribuido como HERO 1.000 (43.40%) + VIVA GO 1.304 (56.60%).
// Para a DRE refletir corretamente essa partilha, precisamos gerar uma
// `financial_entries` por (categoria x departamento), cada uma com o seu
// valor proporcional. O filtro `company_departments.included` aplicado
// nas RPCs separa o que entra na DRE de cada empresa.
// ============================================================================

// Retorna a lista completa de departamentos com o percentual de cada um
// (somando 1.0). Lista vazia quando o registro nao traz array `departamentos`
// (nesse caso o caller deve cair no `extractDepartmentScalar`).
function extractDepartmentRateio(
  record: RawOmieMovimento
): Array<{ code: string; percentual: number; posicao: number }> {
  const r = record as Record<string, unknown>;
  const arrayKeys = ["departamentos", "distribuicao", "dist_dep", "dep", "departments"];

  for (const key of arrayKeys) {
    const arr = r[key];
    if (!Array.isArray(arr) || arr.length === 0) continue;

    const items: Array<{ code: string; weight: number; posicao: number }> = [];
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const code = getString(obj, [
        "cCodDepartamento",
        "codigo_departamento",
        "codigo",
        "codDep",
        "cCodDep",
        "id_departamento",
      ]);
      if (!code) continue;
      // Pesos: priorizamos `nDistrValor` (mais preciso que percentual, que
      // vem com arredondamento). Fallback para `nDistrPercentual` quando o
      // valor nao vier (alguns endpoints so expoem percentual).
      const valor = parseNumber(obj.nDistrValor);
      const percentual = parseNumber(obj.nDistrPercentual);
      const weight = valor > 0 ? valor : percentual;
      items.push({ code, weight, posicao: i + 1 });
    }
    if (items.length === 0) continue;

    const totalWeight = items.reduce((s, p) => s + p.weight, 0);
    if (totalWeight <= 0) {
      // Caso extremo: array com codigos mas sem valores/percentuais. Distribui
      // igualmente para nao perder o vinculo.
      const eqp = 1 / items.length;
      return items.map((p) => ({ code: p.code, percentual: eqp, posicao: p.posicao }));
    }
    return items.map((p) => ({
      code: p.code,
      percentual: p.weight / totalWeight,
      posicao: p.posicao,
    }));
  }

  return [];
}

// Fallback escalar: usado quando o registro nao tem array `departamentos`.
function extractDepartmentScalar(record: RawOmieMovimento): string | null {
  const r = record as Record<string, unknown>;
  return getString(r, [
    "cCodDepartamento",
    "cDepartamento",
    "codigo_departamento",
    "codDep",
    "cCodDep",
    "id_departamento",
    "departamento",
  ]);
}

// Resolve a forma de vinculo: rateio (>=2), single (1) ou none.
type DepartmentResolution =
  | { mode: "none" }
  | { mode: "single"; code: string }
  | { mode: "rateio"; items: Array<{ code: string; percentual: number; posicao: number }> };

function resolveDepartments(record: RawOmieMovimento): DepartmentResolution {
  const items = extractDepartmentRateio(record);
  if (items.length >= 2) return { mode: "rateio", items };
  if (items.length === 1) return { mode: "single", code: items[0].code };
  const scalar = extractDepartmentScalar(record);
  if (scalar) return { mode: "single", code: scalar };
  return { mode: "none" };
}

// Distribui `valorAlvo` entre N departamentos preservando a soma exata.
// Residuo de centavos vai para a ultima parcela (mesmo padrao usado no
// rateio por categoria — ver `extrairRateioParcelas`).
function distribuirPorDepartamentos(
  pcts: Array<{ code: string; percentual: number; posicao: number }>,
  valorAlvo: number
): Array<{ code: string; valor: number; posicao: number }> {
  if (pcts.length === 0) return [];
  const out: Array<{ code: string; valor: number; posicao: number }> = [];
  let consumido = 0;
  for (let i = 0; i < pcts.length; i++) {
    const p = pcts[i];
    const isLast = i === pcts.length - 1;
    const portion = isLast
      ? Number((valorAlvo - consumido).toFixed(2))
      : Number((valorAlvo * p.percentual).toFixed(2));
    consumido += portion;
    out.push({ code: p.code, valor: portion, posicao: p.posicao });
  }
  return out;
}

// ============================================================================
// REGRA 4: CORRETOR_DUPLICIDADE + Seleção de Valor
// ============================================================================
// Define qual valor usar:
//   - Com rateio: corretor = 0, usa nDistrValor de cada item
//   - Sem rateio (CC PAG/REC): corretor = 1, usa nValPago
//   - Sem rateio (outros): corretor = 1, usa nValLiquido
// ============================================================================
function selectValueByCorretor(
  record: RawOmieMovimento,
  verificadorRateio: number,
): {
  value: number;
  corretor_duplicidade: number;
  source_field_value: "nValPago" | "nValLiquido";
} {
  // Com rateio: corretor_duplicidade = 0
  if (verificadorRateio > 0) {
    return {
      value: 0, // Valor não será usado; cada item do rateio terá nDistrValor
      corretor_duplicidade: 0,
      source_field_value: "nValPago", // placeholder
    };
  }

  // Sem rateio: verificar cGrupo
  const cGrupo = getString(record as Record<string, unknown>, ["cGrupo"])?.toUpperCase() ?? "";
  const isContaCorrentePagRec =
    cGrupo === "CONTA_CORRENTE_PAG" || cGrupo === "CONTA_CORRENTE_REC";

  if (isContaCorrentePagRec) {
    const valPago = parseNumber(record.nValPago);
    // Regime de caixa: quando o titulo tem desconto/juros/multa, o cash real
    // difere de nValPago bruto. Aplica formula tanto para receita quanto
    // despesa. Guarda `valPago > 0` evita valor negativo em lancamentos-sombra
    // (nValPago=0 + nDesconto>0).
    if (valPago > 0) {
      const adj = extractCashAdjustment(record);
      if (adj.hasAdjustment) {
        const cashReal = Number(
          (valPago - adj.desconto + adj.juros + adj.multa).toFixed(2),
        );
        return {
          value: cashReal,
          corretor_duplicidade: 1,
          source_field_value: "nValLiquido",
        };
      }
    }
    return {
      value: valPago,
      corretor_duplicidade: 1,
      source_field_value: "nValPago",
    };
  } else {
    const valLiquido = parseNumber(record.nValLiquido);
    if (valLiquido !== 0) {
      return {
        value: valLiquido,
        corretor_duplicidade: 1,
        source_field_value: "nValLiquido",
      };
    }
    // nValLiquido = 0: pode ser (a) titulo sem dado, ou (b) titulo onde
    // desconto/juros/multa zeram o cash real (caso classico: desconto >=
    // nValPago). Aplica a formula (nValPago - desconto + juros + multa)
    // para receita E despesa — regime de caixa exige que o cash real
    // entre na DRE, nao o bruto. Guarda `valPago > 0` evita entries
    // negativas em lancamentos-sombra (nValPago=0 + nDesconto>0,
    // tipicamente "Pagamento gerado automaticamente" via conciliacao).
    const valPago = parseNumber(record.nValPago);
    if (valPago > 0) {
      const adj = extractCashAdjustment(record);
      if (adj.hasAdjustment) {
        const cashReal = Number(
          (valPago - adj.desconto + adj.juros + adj.multa).toFixed(2),
        );
        return {
          value: cashReal,
          corretor_duplicidade: 1,
          source_field_value: "nValLiquido",
        };
      }
    }
    return {
      value: valPago,
      corretor_duplicidade: 1,
      source_field_value: valPago !== 0 ? "nValPago" : "nValLiquido",
    };
  }
}

// ============================================================================
// AJUSTE DE CAIXA: DESCONTO / JUROS / MULTA
// ============================================================================
// A API da Omie expoe os campos `nDesconto`, `nJuros` e `nMulta` em
// `detalhes` e/ou `resumo`. O valor bruto do titulo (nValorTitulo) e a
// soma dos `nDistrValor` do rateio nao refletem o cash real que entrou
// ou saiu da conta corrente — esses precisam ser ajustados.
//
// Para registros-pai (MANP/RPTP/EXTP/BARP/MANR/RPTR/EXTR/BARR), o cash
// efetivo pode ser lido em `resumo.nValLiquido` (quando disponivel) ou
// recalculado como `nValPago - nDesconto + nJuros + nMulta`.
//
// Para baixas (BAXP/BAXR), `nValorMovCC` ja reflete o movimento real
// na conta corrente; mas como salvaguarda, tambem aplicamos a mesma
// formula caso `nValorMovCC` nao venha.
// ============================================================================
interface CashAdjustment {
  desconto: number;
  juros: number;
  multa: number;
  hasAdjustment: boolean;
}

function extractCashAdjustment(record: RawOmieMovimento): CashAdjustment {
  const r = record as Record<string, unknown>;
  const desconto = parseNumber(r.nDesconto);
  const juros = parseNumber(r.nJuros);
  const multa = parseNumber(r.nMulta);
  return {
    desconto,
    juros,
    multa,
    hasAdjustment: desconto > 0 || juros > 0 || multa > 0,
  };
}

// Calcula o valor de cash efetivo de um registro-pai a partir de
// nValLiquido (preferencial) ou nValPago - desconto + juros + multa.
// Retorna null quando nao da para inferir (campos zerados).
function computeParentCashValue(
  record: RawOmieMovimento,
  adj: CashAdjustment
): number | null {
  const r = record as Record<string, unknown>;
  const valLiquido = parseNumber(r.nValLiquido);
  if (valLiquido > 0) return valLiquido;
  const valPago = parseNumber(r.nValPago);
  if (valPago > 0) {
    return Number((valPago - adj.desconto + adj.juros + adj.multa).toFixed(2));
  }
  return null;
}

// ============================================================================
// REGRA 7: QUEBRA DE RATEIO
// ============================================================================
// Para lançamentos com rateio, quebra em parcelas usando o array "categorias"
// da API. Cada item do array possui:
//   - cCodCateg (código da categoria)
//   - nDistrValor (valor distribuído para esta categoria)
//   - nDistrPercentual (percentual)
//   - nValorFixo ("S"/"N")
//
// Quando `valorAlvo` é informado e difere do somatório de `nDistrValor`
// (caso típico: pai com desconto/juros/multa), as parcelas são reescaladas
// proporcionalmente — usando os próprios `nDistrValor` como pesos
// (mais preciso que `nDistrPercentual`, que vem com arredondamento).
// O resíduo de centavos é absorvido pela última parcela para garantir
// que o somatório bata exatamente com `valorAlvo`.
// ============================================================================
interface RateioParcela {
  categoria: string;
  valor: number;
  posicao: number; // 1-based
}

function extrairRateioParcelas(
  record: RawOmieMovimento,
  valorAlvo?: number
): RateioParcela[] {
  const raw: RateioParcela[] = [];
  const categorias = record.categorias;
  if (!Array.isArray(categorias)) return raw;

  for (let i = 0; i < categorias.length; i++) {
    const item = categorias[i];
    const categoria = item.cCodCateg;
    if (!categoria || (typeof categoria === "string" && !categoria.trim())) continue;
    const valor = parseNumber(item.nDistrValor);
    raw.push({
      categoria: typeof categoria === "string" ? categoria.trim() : String(categoria),
      valor,
      posicao: i + 1,
    });
  }

  if (valorAlvo === undefined || raw.length === 0) return raw;

  const brutoTotal = raw.reduce((sum, p) => sum + p.valor, 0);
  // Sem rescale necessário: valorAlvo casa com o bruto (tolerância 1 centavo).
  if (brutoTotal <= 0 || Math.abs(brutoTotal - valorAlvo) < 0.01) return raw;

  const parcelas: RateioParcela[] = [];
  let consumido = 0;
  for (let i = 0; i < raw.length; i++) {
    const p = raw[i];
    const isLast = i === raw.length - 1;
    const portion = isLast
      ? Number((valorAlvo - consumido).toFixed(2))
      : Number(((p.valor * valorAlvo) / brutoTotal).toFixed(2));
    consumido += portion;
    parcelas.push({ categoria: p.categoria, valor: portion, posicao: p.posicao });
  }
  return parcelas;
}

// ============================================================================
// PROCESSAMENTO PRINCIPAL
// ============================================================================

export interface FinancialProcessorOptions {
  companyId: string;
  batchIndex: number;
}

interface ProcessingResult {
  entries: ProcessedFinancialEntry[];
  auditLog: ProcessingAuditLog;
}

export function processMovimento(
  rawRecord: Record<string, unknown>,
  options: FinancialProcessorOptions
): ProcessingResult {
  const movimento = rawRecord as RawOmieMovimento;
  const { companyId, batchIndex } = options;
  const auditLog: ProcessingAuditLog = {
    movimento_index: batchIndex,
    omie_id_source: "",
    status: "aceito",
    razao: "",
    entries_gerados: 0,
  };

  try {
    // Flatten para aceitar tanto raiz quanto detalhes/resumo
    const record = flattenMovimento(movimento);

    // ====================================================================
    // REGRA 5: VERIFICADOR_BAXP - Exclui BAXP e BAXR
    // ====================================================================
    const cOrigem = getString(record as Record<string, unknown>, ["cOrigem"])?.toUpperCase() ?? "";
    if (cOrigem === "BAXP" || cOrigem === "BAXR") {
      auditLog.status = "rejeitado_baxp";
      auditLog.razao = `Lançamento com cOrigem=${cOrigem} (BAXP/BAXR) descartado`;
      return { entries: [], auditLog };
    }

    // ====================================================================
    // REGRA 2: REGRA DO PERÍODO - Valida dDtPagamento (regime de caixa)
    // ====================================================================
    const paymentDate = parseDate(
      getString(record as Record<string, unknown>, ["dDtPagamento"])
    );
    if (!paymentDate) {
      auditLog.status = "rejeitado_sem_data";
      auditLog.razao = "Sem dDtPagamento válida (regime caixa exige data de pagamento)";
      return { entries: [], auditLog };
    }

    const [year, month] = paymentDate.split("-").map(Number);
    const ano_pgto = year;
    const mes_pagamento = month;

    // ====================================================================
    // Identificação
    // ====================================================================
    const nCodTitulo = getString(record as Record<string, unknown>, ["nCodTitulo"]) ?? "0";
    const cNumTitulo = getString(record as Record<string, unknown>, ["cNumTitulo"]) ?? "";
    const cNumParcela = getString(record as Record<string, unknown>, ["cNumParcela"]) ?? "";
    const cNatureza = getString(record as Record<string, unknown>, ["cNatureza"])?.toUpperCase() ?? "";
    const cGrupo = getString(record as Record<string, unknown>, ["cGrupo"])?.toUpperCase() ?? "";

    // Tipo: receita ou despesa
    const type: "receita" | "despesa" =
      cNatureza === "R" || cGrupo.includes("RECEBER") || cGrupo.includes("_REC")
        ? "receita"
        : "despesa";

    // Dados complementares
    const description =
      getString(record as Record<string, unknown>, [
        "cDescricao",
        "descricao",
        "cObs",
        "observacao",
      ]) ?? (type === "receita" ? "Receita Omie" : "Despesa Omie");

    const supplier_customer = getString(record as Record<string, unknown>, [
      "cNomeCliente",
      "nome_cliente",
      "nome_fornecedor",
      "cNomeFornecedor",
    ]);

    const document_number = getString(record as Record<string, unknown>, [
      "cNumDocFiscal",
      "cNumDocumento",
      "cNumParcela",
      "numero_documento",
    ]);

    // ====================================================================
    // REGRA 3: VERIFICADOR_RATEIO
    // ====================================================================
    const verificadorRateio = detectVerificadorRateio(record);
    const temRateio = verificadorRateio > 0;

    // ====================================================================
    // Helper: Gera omie_id unico e DETERMINISTICO (estavel entre syncs).
    //
    // Estrategia: usar `nCodMovCC` como chave PRIMARIA quando ele existe.
    // O nCodMovCC e o ID da movimentacao bancaria (conta corrente) e e o
    // identificador mais granular e estavel que a Omie expoe — UMA
    // movimentacao real == UM nCodMovCC. Diferentes "views" do mesmo
    // lancamento (parent EXTP, baixa BAXP, conciliacao COMP, etc.) que
    // a API as vezes devolve em registros separados compartilham o
    // mesmo nCodMovCC, e portanto colapsam em um unico omie_id no
    // upsert — eliminando duplicatas estruturais.
    //
    // IMPORTANTE: cOrigem foi REMOVIDO da chave quando ha nCodMovCC.
    // Versoes anteriores incluiam cOrigem para diferenciar parent vs.
    // baixa, mas como nCodMovCC ja identifica unicamente o movimento,
    // manter cOrigem so reintroduzia o bug de duplicacao.
    //
    // Fallbacks (sem nCodMovCC):
    //   - nCodTitulo presente: chave por (nCodTitulo, cNumParcela, cOrigem)
    //     — funciona para titulos abertos (sem baixa ainda).
    //   - cNumTitulo: chave por (cNumTitulo, cOrigem, paymentDate, value).
    //   - Ultimo recurso: (paymentDate, cOrigem, value) — pode colidir
    //     em casos raros mas e o melhor possivel sem ID estavel.
    // ====================================================================
    const nCodMovCC = getString(record as Record<string, unknown>, ["nCodMovCC"]);
    const valueKey = (val: number) => val.toFixed(2);
    const makeOmieId = (suffix: string, valueForKey: number): string => {
      let base: string;
      if (nCodMovCC) {
        base = `cc:${nCodMovCC}`;
      } else if (nCodTitulo !== "0" && nCodTitulo !== "") {
        base = `${nCodTitulo}:${cNumParcela}:${cOrigem}`;
      } else if (cNumTitulo) {
        base = `0:${cNumTitulo}:${cOrigem}:${paymentDate}:${valueKey(valueForKey)}`;
      } else {
        base = `0:${paymentDate}:${cOrigem}:${valueKey(valueForKey)}`;
      }
      return `mov:${base}${suffix}`;
    };

    auditLog.omie_id_source = makeOmieId("", 0);

    const entries: ProcessedFinancialEntry[] = [];

    // ====================================================================
    // REGRA 7: RATEIO - Quebra em ate 5 parcelas (categoria) x N depts
    // Quando ha desconto/juros/multa no titulo, o cash real difere da
    // soma dos `nDistrValor`. Recalculamos o `valorAlvo` (cash efetivo)
    // e reescalamos o rateio proporcionalmente.
    //
    // Quando ha tambem rateio por departamento (>=2 depts), cada parcela
    // de categoria e distribuida entre os depts proporcionalmente —
    // gerando entries por (categoria x departamento). Cada entry mantem
    // apenas UM department_code (escolhido pelo rateio) para que o filtro
    // `company_departments.included` nas RPCs continue funcionando como
    // selecao por linha.
    // ====================================================================
    const deptResolution = resolveDepartments(record);
    const singleDeptCode =
      deptResolution.mode === "single"
        ? deptResolution.code
        : deptResolution.mode === "rateio"
          ? null
          : null;
    const verificadorRateioDept =
      deptResolution.mode === "rateio" ? deptResolution.items.length : undefined;

    if (temRateio) {
      const adj = extractCashAdjustment(record);
      const valorAlvo = adj.hasAdjustment
        ? computeParentCashValue(record, adj) ?? undefined
        : undefined;
      const parcelas = extrairRateioParcelas(record, valorAlvo);
      const grossSum = parcelas.reduce((sum, p) => sum + p.valor, 0);

      const baseMetadata = {
        regra_baxp_aplicada: false,
        regra_periodo_aplicada: true,
        verificador_rateio: verificadorRateio,
        verificador_rateio_dept: verificadorRateioDept,
        corretor_duplicidade: 0, // Com rateio, sempre 0
        source_field_value: (valorAlvo !== undefined ? "nValLiquido" : "nValPago") as
          | "nValLiquido"
          | "nValPago",
        adjusted_for_cash: valorAlvo !== undefined,
        gross_value: valorAlvo !== undefined ? grossSum : undefined,
        discount_value: adj.desconto || undefined,
        juros_value: adj.juros || undefined,
        multa_value: adj.multa || undefined,
      };

      for (const parcela of parcelas) {
        if (deptResolution.mode === "rateio") {
          const deptParts = distribuirPorDepartamentos(
            deptResolution.items,
            parcela.valor
          );
          for (const dp of deptParts) {
            if (dp.valor === 0) continue;
            entries.push({
              omie_id: makeOmieId(`:r${parcela.posicao}:d${dp.posicao}`, dp.valor),
              company_id: companyId,
              type,
              description,
              supplier_customer,
              document_number,
              value: dp.valor,
              payment_date: paymentDate,
              ano_pgto,
              mes_pagamento,
              category_code: parcela.categoria,
              department_code: dp.code,
              raw_json: rawRecord,
              processing_metadata: { ...baseMetadata },
            });
          }
        } else {
          entries.push({
            omie_id: makeOmieId(`:r${parcela.posicao}`, parcela.valor),
            company_id: companyId,
            type,
            description,
            supplier_customer,
            document_number,
            value: parcela.valor,
            payment_date: paymentDate,
            ano_pgto,
            mes_pagamento,
            category_code: parcela.categoria,
            department_code: singleDeptCode,
            raw_json: rawRecord,
            processing_metadata: { ...baseMetadata },
          });
        }
      }

      if (valorAlvo !== undefined) {
        auditLog.razao = `Rateio reescalado de bruto p/ cash (desc=${adj.desconto}, juros=${adj.juros}, multa=${adj.multa}, alvo=${valorAlvo}).`;
      }
      if (deptResolution.mode === "rateio") {
        auditLog.razao = `${auditLog.razao ? auditLog.razao + " " : ""}Rateio por departamento aplicado (${deptResolution.items.length} depts).`;
      }
      auditLog.entries_gerados = entries.length;
      return { entries, auditLog };
    }

    // ====================================================================
    // REGRA 4: CORRETOR_DUPLICIDADE (sem rateio de categoria)
    // ====================================================================
    const { value, corretor_duplicidade, source_field_value } = selectValueByCorretor(
      record,
      verificadorRateio,
    );

    const categoryCode = getString(record as Record<string, unknown>, ["cCodCateg"]);
    const adjNoRateio = extractCashAdjustment(record);

    const baseMetadataNoRateio = {
      regra_baxp_aplicada: false,
      regra_periodo_aplicada: true,
      verificador_rateio: verificadorRateio,
      verificador_rateio_dept: verificadorRateioDept,
      corretor_duplicidade,
      source_field_value,
      adjusted_for_cash: adjNoRateio.hasAdjustment && source_field_value === "nValLiquido",
      discount_value: adjNoRateio.desconto || undefined,
      juros_value: adjNoRateio.juros || undefined,
      multa_value: adjNoRateio.multa || undefined,
    };

    if (deptResolution.mode === "rateio") {
      // Sem rateio de categoria, mas com rateio de departamento: explode o
      // valor da entry entre os depts (uma entry por departamento).
      const deptParts = distribuirPorDepartamentos(deptResolution.items, value);
      for (const dp of deptParts) {
        if (dp.valor === 0) continue;
        entries.push({
          omie_id: makeOmieId(`:d${dp.posicao}`, dp.valor),
          company_id: companyId,
          type,
          description,
          supplier_customer,
          document_number,
          value: dp.valor,
          payment_date: paymentDate,
          ano_pgto,
          mes_pagamento,
          category_code: categoryCode,
          department_code: dp.code,
          raw_json: rawRecord,
          processing_metadata: { ...baseMetadataNoRateio },
        });
      }
      auditLog.razao = `Rateio por departamento aplicado (${deptResolution.items.length} depts).`;
      auditLog.entries_gerados = entries.length;
      return { entries, auditLog };
    }

    entries.push({
      omie_id: makeOmieId("", value),
      company_id: companyId,
      type,
      description,
      supplier_customer,
      document_number,
      value,
      payment_date: paymentDate,
      ano_pgto,
      mes_pagamento,
      category_code: categoryCode,
      department_code: singleDeptCode,
      raw_json: rawRecord,
      processing_metadata: { ...baseMetadataNoRateio },
    });
    auditLog.entries_gerados = 1;
    return { entries, auditLog };
  } catch (error) {
    auditLog.status = "erro";
    auditLog.razao =
      error instanceof Error ? error.message : "Erro desconhecido no processamento";
    return { entries: [], auditLog };
  }
}

// ============================================================================
// REGRA 5 (NOVA): BAIXAS PARCIAIS COMO FONTE DE VERDADE
// ============================================================================
// Quando um título possui registros BAXP/BAXR (uma baixa por linha),
// usamos esses registros como autoridade para período e valor — cada baixa
// vira uma financial_entry com a data REAL daquela baixa.
//
// Isso resolve o caso de pagamentos parciais em meses diferentes:
// um título de R$ 2.948,96 quitado com R$ 428,57 em 17/04/2025 e
// R$ 2.520,39 em 06/01/2026 antes era consolidado em Jan/2026; agora
// gera duas entries — uma em Abr/2025 e outra em Jan/2026.
//
// Quando o pai possui rateio, a baixa é distribuída proporcionalmente
// entre as categorias do título usando os percentuais originais.
//
// Quando o lote NÃO contém BAXP/BAXR para um nCodTitulo (ex.: sync
// incremental que pegou só o pai), caímos no fluxo legado (processMovimento).
// ============================================================================
function isBaixaRecord(record: RawOmieMovimento): boolean {
  const cOrigem = getString(record as Record<string, unknown>, ["cOrigem"])?.toUpperCase() ?? "";
  return cOrigem === "BAXP" || cOrigem === "BAXR";
}

interface RateioPercentual {
  categoria: string;
  percentual: number; // 0..1
  posicao: number; // 1-based
}

function calcularRateioPercentuais(parent: RawOmieMovimento | null): RateioPercentual[] {
  if (!parent) return [];
  const parcelas = extrairRateioParcelas(parent);
  if (parcelas.length === 0) return [];
  const total = parcelas.reduce((sum, p) => sum + p.valor, 0);
  if (total <= 0) return [];
  return parcelas.map((p) => ({
    categoria: p.categoria,
    percentual: p.valor / total,
    posicao: p.posicao,
  }));
}

function processBaixasDoTitulo(
  parents: Record<string, unknown>[],
  baixas: Record<string, unknown>[],
  options: FinancialProcessorOptions
): ProcessingResult[] {
  const results: ProcessingResult[] = [];
  // Pai "principal" para herdar metadados (rateio, fornecedor, descrição).
  // Preferimos o registro com mais informação (categorias rateadas, depois
  // qualquer não-baixa). Se não houver pai no lote, usamos o próprio BAXP.
  const flattenedParents = parents.map((p) => flattenMovimento(p as RawOmieMovimento));
  const parentWithRateio =
    flattenedParents.find((p) => Array.isArray(p.categorias) && p.categorias.length > 0) ?? null;
  const parent: RawOmieMovimento | null =
    parentWithRateio ?? flattenedParents[0] ?? null;
  // Rateio herdado do pai — usado apenas quando a baixa NAO traz seu proprio
  // array `categorias`. Em pagamentos parciais o pai pode nao vir no mesmo
  // lote da Omie (filtro por dDtPagamento exclui titulos com saldo aberto),
  // por isso o array da propria baixa tem prioridade.
  const parentRateio = calcularRateioPercentuais(parent);

  for (let i = 0; i < baixas.length; i++) {
    const rawBaixa = baixas[i];
    const baixa = flattenMovimento(rawBaixa as RawOmieMovimento);
    // A propria baixa pode (e geralmente traz, em titulos rateados) o array
    // `categorias` com o rateio do titulo — preferimos ele ao do pai para
    // sobreviver a sync incremental que so trouxe o BAXP.
    const baixaRateio = calcularRateioPercentuais(baixa);
    const rateio = baixaRateio.length > 0 ? baixaRateio : parentRateio;

    const auditLog: ProcessingAuditLog = {
      movimento_index: options.batchIndex + i,
      omie_id_source: "",
      status: "aceito",
      razao: "",
      entries_gerados: 0,
    };

    try {
      const paymentDate = parseDate(
        getString(baixa as Record<string, unknown>, ["dDtPagamento"])
      );
      if (!paymentDate) {
        auditLog.status = "rejeitado_sem_data";
        auditLog.razao = "Baixa sem dDtPagamento (regime caixa exige data).";
        results.push({ entries: [], auditLog });
        continue;
      }

      const [year, month] = paymentDate.split("-").map(Number);
      const cNatureza = getString(baixa as Record<string, unknown>, ["cNatureza"])?.toUpperCase() ?? "";
      const cGrupo = getString(baixa as Record<string, unknown>, ["cGrupo"])?.toUpperCase() ?? "";
      const type: "receita" | "despesa" =
        cNatureza === "R" || cGrupo.includes("RECEBER") || cGrupo.includes("_REC")
          ? "receita"
          : "despesa";

      // Valor real da baixa: para RECEITA aplicamos a formula de cash
      // quando ha desconto/juros/multa (forca o regime de caixa); para
      // DESPESA mantemos o comportamento legado (`nValorMovCC` primeiro,
      // fallbacks em resumo).
      //
      // Motivacao: descontos concedidos em receita reduzem o cash real
      // (cortesia ao cliente — Cerimonial/Fee em Volta Redonda Mar/Abr
      // 2023 inflado em R$ 65.200 era exatamente isso). Em despesa, o
      // desconto recebido nao reduz o valor da despesa em si — o modelo
      // contabil mantem o bruto e trata o desconto como receita financeira
      // em linha separada.
      const baixaAdj = extractCashAdjustment(baixa);
      const baixaResumo = (baixa.resumo as Record<string, unknown> | undefined) ?? {};
      const valLiquidoBaixaResumo = parseNumber(baixaResumo.nValLiquido);
      const valPagoBaixaResumo = parseNumber(baixaResumo.nValPago);
      const nValorMovCCBaixa = parseNumber(baixa.nValorMovCC);

      let baixaValue: number;
      let baixaSource: "nValorMovCC" | "nValLiquido" | "nValPago";

      // Prioridade: nValorMovCC (cash real ja calculado pela Omie) >
      //             nValLiquido (resumo, ja net) >
      //             nValPago + formula (somente como fallback — cortesia
      //             integral onde nao houve cash mas Omie ainda traz bruto).
      //
      // CRITICO: nao aplicar a formula quando nValorMovCC > 0, porque em
      // baixas o nValPago do resumo JA reflete o valor liquido pago pelo
      // cliente (inclui juros/multa, descontado o desconto). Somar de novo
      // gera dobra de juros e multa.
      if (nValorMovCCBaixa > 0) {
        baixaValue = nValorMovCCBaixa;
        baixaSource = "nValorMovCC";
      } else if (valLiquidoBaixaResumo > 0) {
        baixaValue = valLiquidoBaixaResumo;
        baixaSource = "nValLiquido";
      } else if (valPagoBaixaResumo > 0) {
        // nValorMovCC e nValLiquido zerados: cenario tipico de cortesia
        // integral (desconto cancelou o pagamento) onde a Omie ainda
        // mostra o bruto em nValPago. Formula extrai o cash real (pode
        // ser 0). Aplica para receita e despesa.
        baixaValue = baixaAdj.hasAdjustment
          ? Number(
              (
                valPagoBaixaResumo -
                baixaAdj.desconto +
                baixaAdj.juros +
                baixaAdj.multa
              ).toFixed(2),
            )
          : valPagoBaixaResumo;
        baixaSource = "nValPago";
      } else {
        baixaValue = 0;
        baixaSource = "nValorMovCC";
      }

      // Rejeita baixa vazia. Em RECEITA com ajuste podemos ter cash real = 0
      // (cortesia integral) e isso e legitimo — nao rejeitamos para que o
      // upsert sobrescreva o valor antigo (bug). Em despesa, value === 0
      // sempre indica baixa sem dado util.
      if (
        baixaValue === 0 &&
        !(type === "receita" && baixaAdj.hasAdjustment)
      ) {
        auditLog.status = "rejeitado_sem_data";
        auditLog.razao = "Baixa sem valor (nValorMovCC e nValPago zerados).";
        results.push({ entries: [], auditLog });
        continue;
      }

      const nCodTitulo = getString(baixa as Record<string, unknown>, ["nCodTitulo"]) ?? "0";
      const nCodBaixa = getString(baixa as Record<string, unknown>, ["nCodBaixa"]) ?? "";
      const cOrigemBaixa = getString(baixa as Record<string, unknown>, ["cOrigem"])?.toUpperCase() ?? "";

      // Metadados herdados do pai quando disponível
      const metaSource = parent ?? baixa;
      const description =
        getString(metaSource as Record<string, unknown>, [
          "cDescricao",
          "descricao",
          "cObs",
          "observacao",
        ]) ??
        getString(baixa as Record<string, unknown>, ["cDescricao", "observacao"]) ??
        (type === "receita" ? "Receita Omie" : "Despesa Omie");

      const supplier_customer = getString(metaSource as Record<string, unknown>, [
        "cNomeCliente",
        "nome_cliente",
        "nome_fornecedor",
        "cNomeFornecedor",
      ]);

      const document_number = getString(metaSource as Record<string, unknown>, [
        "cNumDocFiscal",
        "cNumDocumento",
        "cNumParcela",
        "numero_documento",
      ]);

      // Prioridade: nCodMovCC (id do movimento bancario) — mesma chave
      // que processMovimento usa, garantindo que parent e baixa colapsem
      // em UM unico omie_id quando representam a mesma transacao real.
      // Fallback para nCodBaixa preserva o comportamento legado quando
      // a Omie nao expoe nCodMovCC na resposta da baixa.
      const nCodMovCC = getString(baixa as Record<string, unknown>, ["nCodMovCC"]);
      const baseKey = nCodMovCC
        ? `mov:cc:${nCodMovCC}`
        : nCodBaixa
          ? `bx:${nCodTitulo}:${nCodBaixa}`
          : `bx:${nCodTitulo}:${paymentDate}:${baixaValue.toFixed(2)}`;
      auditLog.omie_id_source = baseKey;

      // Departamento: prioriza RATEIO em qualquer fonte (baixa > parent),
      // antes de cair para SINGLE. E comum a Omie expor o array `departamentos`
      // apenas no titulo-pai e a baixa trazer somente o `cCodDepartamento`
      // escalar do "departamento principal". Sem essa prioridade ignoravamos
      // o rateio do pai e a baixa inteira ia para 1 unico dept — Hero perdia
      // a sua parte de despesas rateadas com Viva Go.
      //
      // Ordem:
      //   1. Rateio (>=2 depts) na propria baixa — fonte mais especifica
      //   2. Rateio (>=2 depts) no pai
      //   3. Single da baixa (array com 1 item ou cCodDepartamento escalar)
      //   4. Single do pai
      const baixaItems = extractDepartmentRateio(baixa);
      const parentItems = parent ? extractDepartmentRateio(parent) : [];
      let deptResolution: DepartmentResolution;
      if (baixaItems.length >= 2) {
        deptResolution = { mode: "rateio", items: baixaItems };
      } else if (parentItems.length >= 2) {
        deptResolution = { mode: "rateio", items: parentItems };
      } else if (baixaItems.length === 1) {
        deptResolution = { mode: "single", code: baixaItems[0].code };
      } else {
        const baixaScalar = extractDepartmentScalar(baixa);
        if (baixaScalar) {
          deptResolution = { mode: "single", code: baixaScalar };
        } else if (parentItems.length === 1) {
          deptResolution = { mode: "single", code: parentItems[0].code };
        } else {
          const parentScalar = parent ? extractDepartmentScalar(parent) : null;
          deptResolution = parentScalar
            ? { mode: "single", code: parentScalar }
            : { mode: "none" };
        }
      }
      const singleDeptCode =
        deptResolution.mode === "single" ? deptResolution.code : null;
      const verificadorRateioDept =
        deptResolution.mode === "rateio" ? deptResolution.items.length : undefined;

      const entries: ProcessedFinancialEntry[] = [];

      const baseMetaRateio = {
        regra_baxp_aplicada: true,
        regra_periodo_aplicada: true,
        verificador_rateio: rateio.length,
        verificador_rateio_dept: verificadorRateioDept,
        corretor_duplicidade: 0,
        source_field_value: baixaSource,
        adjusted_for_cash: baixaAdj.hasAdjustment,
        discount_value: baixaAdj.desconto || undefined,
        juros_value: baixaAdj.juros || undefined,
        multa_value: baixaAdj.multa || undefined,
      };
      const baseMetaSemRateio = {
        regra_baxp_aplicada: true,
        regra_periodo_aplicada: true,
        verificador_rateio: 0,
        verificador_rateio_dept: verificadorRateioDept,
        corretor_duplicidade: 1,
        source_field_value: baixaSource,
        adjusted_for_cash: baixaAdj.hasAdjustment,
        discount_value: baixaAdj.desconto || undefined,
        juros_value: baixaAdj.juros || undefined,
        multa_value: baixaAdj.multa || undefined,
      };

      if (rateio.length > 0) {
        // Distribui a baixa proporcionalmente entre as categorias do rateio.
        // Acumula residuo de arredondamento para garantir soma exata.
        let consumido = 0;
        for (let j = 0; j < rateio.length; j++) {
          const r = rateio[j];
          const isLast = j === rateio.length - 1;
          const portion = isLast
            ? Number((baixaValue - consumido).toFixed(2))
            : Number((baixaValue * r.percentual).toFixed(2));
          consumido += portion;
          if (portion === 0) continue;

          if (deptResolution.mode === "rateio") {
            // Cada parcela de categoria e ainda subdividida entre os depts.
            const deptParts = distribuirPorDepartamentos(
              deptResolution.items,
              portion
            );
            for (const dp of deptParts) {
              if (dp.valor === 0) continue;
              entries.push({
                omie_id: `${baseKey}:r${r.posicao}:d${dp.posicao}`,
                company_id: options.companyId,
                type,
                description,
                supplier_customer,
                document_number,
                value: dp.valor,
                payment_date: paymentDate,
                ano_pgto: year,
                mes_pagamento: month,
                category_code: r.categoria,
                department_code: dp.code,
                raw_json: rawBaixa as Record<string, unknown>,
                processing_metadata: { ...baseMetaRateio },
              });
            }
          } else {
            entries.push({
              omie_id: `${baseKey}:r${r.posicao}`,
              company_id: options.companyId,
              type,
              description,
              supplier_customer,
              document_number,
              value: portion,
              payment_date: paymentDate,
              ano_pgto: year,
              mes_pagamento: month,
              category_code: r.categoria,
              department_code: singleDeptCode,
              raw_json: rawBaixa as Record<string, unknown>,
              processing_metadata: { ...baseMetaRateio },
            });
          }
        }
      } else {
        const categoryCode = getString(baixa as Record<string, unknown>, ["cCodCateg"]);

        if (deptResolution.mode === "rateio") {
          const deptParts = distribuirPorDepartamentos(
            deptResolution.items,
            baixaValue
          );
          for (const dp of deptParts) {
            if (dp.valor === 0) continue;
            entries.push({
              omie_id: `${baseKey}:d${dp.posicao}`,
              company_id: options.companyId,
              type,
              description,
              supplier_customer,
              document_number,
              value: dp.valor,
              payment_date: paymentDate,
              ano_pgto: year,
              mes_pagamento: month,
              category_code: categoryCode,
              department_code: dp.code,
              raw_json: rawBaixa as Record<string, unknown>,
              processing_metadata: { ...baseMetaSemRateio },
            });
          }
        } else {
          entries.push({
            omie_id: baseKey,
            company_id: options.companyId,
            type,
            description,
            supplier_customer,
            document_number,
            value: baixaValue,
            payment_date: paymentDate,
            ano_pgto: year,
            mes_pagamento: month,
            category_code: categoryCode,
            department_code: singleDeptCode,
            raw_json: rawBaixa as Record<string, unknown>,
            processing_metadata: { ...baseMetaSemRateio },
          });
        }
      }

      auditLog.entries_gerados = entries.length;
      const deptInfo =
        deptResolution.mode === "rateio"
          ? ` rateio dept (${deptResolution.items.length})`
          : "";
      auditLog.razao = `Baixa parcial processada (${cOrigemBaixa}, nCodBaixa=${nCodBaixa || "-"})${deptInfo}.`;
      results.push({ entries, auditLog });
    } catch (error) {
      auditLog.status = "erro";
      auditLog.razao =
        error instanceof Error ? error.message : "Erro desconhecido ao processar baixa.";
      results.push({ entries: [], auditLog });
    }
  }

  return results;
}

export function processMovimentos(
  rawMovimentos: Record<string, unknown>[],
  companyId: string
): {
  entries: ProcessedFinancialEntry[];
  auditLogs: ProcessingAuditLog[];
} {
  const entries: ProcessedFinancialEntry[] = [];
  const auditLogs: ProcessingAuditLog[] = [];

  // Agrupa por nCodTitulo para identificar pares pai + baixas.
  // Movimentos sem nCodTitulo viram seu próprio grupo (chave única).
  type Grupo = {
    parents: { raw: Record<string, unknown>; index: number }[];
    baixas: { raw: Record<string, unknown>; index: number }[];
  };
  const grupos = new Map<string, Grupo>();
  const ordemGrupos: string[] = [];

  for (let i = 0; i < rawMovimentos.length; i++) {
    const raw = rawMovimentos[i];
    const flat = flattenMovimento(raw as RawOmieMovimento);
    const nCodTitulo = getString(flat as Record<string, unknown>, ["nCodTitulo"]);
    const groupKey = nCodTitulo ? `t:${nCodTitulo}` : `i:${i}`;

    let grupo = grupos.get(groupKey);
    if (!grupo) {
      grupo = { parents: [], baixas: [] };
      grupos.set(groupKey, grupo);
      ordemGrupos.push(groupKey);
    }

    if (isBaixaRecord(flat)) {
      grupo.baixas.push({ raw, index: i });
    } else {
      grupo.parents.push({ raw, index: i });
    }
  }

  for (const groupKey of ordemGrupos) {
    const grupo = grupos.get(groupKey)!;

    if (grupo.baixas.length > 0) {
      // Há baixas: elas são a fonte de verdade para período/valor.
      // O pai é usado apenas para herdar rateio e metadados.
      const baixaResults = processBaixasDoTitulo(
        grupo.parents.map((p) => p.raw),
        grupo.baixas.map((b) => b.raw),
        {
          companyId,
          batchIndex: grupo.baixas[0].index,
        }
      );
      for (const r of baixaResults) {
        entries.push(...r.entries);
        auditLogs.push(r.auditLog);
      }

      // Auditoria: registra que cada pai foi suprimido em favor das baixas.
      for (const p of grupo.parents) {
        auditLogs.push({
          movimento_index: p.index,
          omie_id_source: groupKey,
          status: "aceito",
          razao:
            "Pai suprimido — título possui baixas (BAXP/BAXR) que viram a fonte de verdade.",
          entries_gerados: 0,
        });
      }
    } else {
      // Sem baixas no lote: processa cada pai pelo fluxo legado.
      for (const p of grupo.parents) {
        const result = processMovimento(p.raw, {
          companyId,
          batchIndex: p.index,
        });
        entries.push(...result.entries);
        auditLogs.push(result.auditLog);
      }
    }
  }

  return { entries, auditLogs };
}
