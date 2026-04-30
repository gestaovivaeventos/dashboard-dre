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

  // Rastreabilidade e auditoria
  raw_json: Record<string, unknown>;

  // Metadados de processamento
  processing_metadata: {
    regra_baxp_aplicada: boolean;
    regra_periodo_aplicada: boolean;
    verificador_rateio: number; // 1-5 = numero de categorias rateadas, 0 = sem rateio
    corretor_duplicidade: number; // 0 = rateio, 1 = valor unico
    source_field_value?: "nValPago" | "nValLiquido"; // qual valor foi usado
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
// REGRA 4: CORRETOR_DUPLICIDADE + Seleção de Valor
// ============================================================================
// Define qual valor usar:
//   - Com rateio: corretor = 0, usa nDistrValor de cada item
//   - Sem rateio (CC PAG/REC): corretor = 1, usa nValPago
//   - Sem rateio (outros): corretor = 1, usa nValLiquido
// ============================================================================
function selectValueByCorretor(
  record: RawOmieMovimento,
  verificadorRateio: number
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
    const value = parseNumber(record.nValPago);
    return {
      value,
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
    // Fallback: se nValLiquido vazio/zero, usa nValPago
    const valPago = parseNumber(record.nValPago);
    return {
      value: valPago,
      corretor_duplicidade: 1,
      source_field_value: valPago !== 0 ? "nValPago" : "nValLiquido",
    };
  }
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
// ============================================================================
interface RateioParcela {
  categoria: string;
  valor: number;
  posicao: number; // 1-based
}

function extrairRateioParcelas(record: RawOmieMovimento): RateioParcela[] {
  const parcelas: RateioParcela[] = [];
  const categorias = record.categorias;
  if (!Array.isArray(categorias)) return parcelas;

  for (let i = 0; i < categorias.length; i++) {
    const item = categorias[i];
    const categoria = item.cCodCateg;
    if (!categoria || (typeof categoria === "string" && !categoria.trim())) continue;

    const valor = parseNumber(item.nDistrValor);
    parcelas.push({
      categoria: typeof categoria === "string" ? categoria.trim() : String(categoria),
      valor,
      posicao: i + 1,
    });
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
    // REGRA 7: RATEIO - Quebra em até 5 parcelas
    // ====================================================================
    if (temRateio) {
      const parcelas = extrairRateioParcelas(record);

      for (const parcela of parcelas) {
        const entry: ProcessedFinancialEntry = {
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
          raw_json: rawRecord,
          processing_metadata: {
            regra_baxp_aplicada: false,
            regra_periodo_aplicada: true,
            verificador_rateio: verificadorRateio,
            corretor_duplicidade: 0, // Com rateio, sempre 0
            source_field_value: "nValPago", // placeholder para rateio
          },
        };
        entries.push(entry);
      }

      auditLog.entries_gerados = entries.length;
      return { entries, auditLog };
    }

    // ====================================================================
    // REGRA 4: CORRETOR_DUPLICIDADE (sem rateio)
    // ====================================================================
    const { value, corretor_duplicidade, source_field_value } = selectValueByCorretor(
      record,
      verificadorRateio
    );

    const categoryCode = getString(record as Record<string, unknown>, ["cCodCateg"]);

    const entry: ProcessedFinancialEntry = {
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
      raw_json: rawRecord,
      processing_metadata: {
        regra_baxp_aplicada: false,
        regra_periodo_aplicada: true,
        verificador_rateio: verificadorRateio,
        corretor_duplicidade,
        source_field_value,
      },
    };

    entries.push(entry);
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
  const rateio = calcularRateioPercentuais(parent);

  for (let i = 0; i < baixas.length; i++) {
    const rawBaixa = baixas[i];
    const baixa = flattenMovimento(rawBaixa as RawOmieMovimento);

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

      // Valor real da baixa: nValorMovCC (movimento de conta corrente).
      // Fallback para nValPago do resumo da própria baixa.
      const baixaValue =
        parseNumber(baixa.nValorMovCC) ||
        parseNumber((baixa.resumo as Record<string, unknown> | undefined)?.nValPago);
      if (baixaValue === 0) {
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

      const entries: ProcessedFinancialEntry[] = [];

      if (rateio.length > 0) {
        // Distribui a baixa proporcionalmente entre as categorias do rateio.
        // Acumula resíduo de arredondamento para garantir soma exata.
        let consumido = 0;
        for (let j = 0; j < rateio.length; j++) {
          const r = rateio[j];
          const isLast = j === rateio.length - 1;
          const portion = isLast
            ? Number((baixaValue - consumido).toFixed(2))
            : Number((baixaValue * r.percentual).toFixed(2));
          consumido += portion;
          if (portion === 0) continue;
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
            raw_json: rawBaixa as Record<string, unknown>,
            processing_metadata: {
              regra_baxp_aplicada: true,
              regra_periodo_aplicada: true,
              verificador_rateio: rateio.length,
              corretor_duplicidade: 0,
              source_field_value: "nValPago",
            },
          });
        }
      } else {
        const categoryCode = getString(baixa as Record<string, unknown>, ["cCodCateg"]);
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
          raw_json: rawBaixa as Record<string, unknown>,
          processing_metadata: {
            regra_baxp_aplicada: true,
            regra_periodo_aplicada: true,
            verificador_rateio: 0,
            corretor_duplicidade: 1,
            source_field_value: cOrigemBaixa === "BAXR" ? "nValPago" : "nValPago",
          },
        });
      }

      auditLog.entries_gerados = entries.length;
      auditLog.razao = `Baixa parcial processada (${cOrigemBaixa}, nCodBaixa=${nCodBaixa || "-"}).`;
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
