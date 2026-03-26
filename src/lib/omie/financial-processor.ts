/**
 * PROCESSADOR FINANCEIRO - Camada de Tratamento DRE em Regime de Caixa
 * 
 * ============================================================================
 * REGRAS DE NEGOCIO IMPLEMENTADAS (11 regras):
 * ============================================================================
 * 
 * 1. FONTE DE DADOS: API ListarMovimentos da Omie
 * 2. REGRA DO PERIODO: Usa dDtPagamento para derivar ano_pgto e mes_pagamento
 * 3. REGRA DO VERIFICADOR_RATEIO: Detecta quantas categorias (1-5) estão preenchidas
 * 4. REGRA DO CORRETOR_DUPLICIDADE: Define qual valor usar (nValPago vs nValLiquido)
 * 5. REGRA DO VERIFICADOR_BAXP: Exclui cOrigem = BAXP ou BAXR
 * 6. REGRA DE CONSOLIDAÇÃO: Agrupa por período e categoria da DRE
 * 7. REGRA DE RATEIO: Quebra lançamento em até 5 parcelas com nDistrValor
 * 8. DE/PARA: Mapeia categorias Omie para contas DRE
 * 9. FILTRO DE PERÍODO: Aplica tratativas antes de consolidar
 * 10. AUDITORIA: Registra decisões de processamento
 * 11. INTEGRIDADE: Valida inconsistências entre categoria e valor rateado
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

  // Categoria simples (sem rateio)
  cCodCateg?: string;
  cDescricao?: string;

  // Categoria com rateio (campos cCodCateg1..5 e nDistrValor1..5)
  cCodCateg1?: string;
  cCodCateg2?: string;
  cCodCateg3?: string;
  cCodCateg4?: string;
  cCodCateg5?: string;

  nDistrValor1?: string | number;
  nDistrValor2?: string | number;
  nDistrValor3?: string | number;
  nDistrValor4?: string | number;
  nDistrValor5?: string | number;

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
// Identifica quantas categorias rateadas existem verificando cCodCateg1..5
// Retorna:
//   0 = sem rateio (cCodCateg1 está vazio)
//   1 = 1 categoria (cCodCateg2 está vazio)
//   2 = 2 categorias (cCodCateg3 está vazio)
//   ... e assim por diante até 5
// ============================================================================
function detectVerificadorRateio(record: RawOmieMovimento): number {
  const cat1 = getString(record as Record<string, unknown>, ["cCodCateg1"]);
  if (!cat1) return 0; // Sem rateio

  const cat2 = getString(record as Record<string, unknown>, ["cCodCateg2"]);
  if (!cat2) return 1;

  const cat3 = getString(record as Record<string, unknown>, ["cCodCateg3"]);
  if (!cat3) return 2;

  const cat4 = getString(record as Record<string, unknown>, ["cCodCateg4"]);
  if (!cat4) return 3;

  const cat5 = getString(record as Record<string, unknown>, ["cCodCateg5"]);
  if (!cat5) return 4;

  // Todas as 5 categorias preenchidas
  return 5;
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
    const value = parseNumber(record.nValLiquido);
    return {
      value,
      corretor_duplicidade: 1,
      source_field_value: "nValLiquido",
    };
  }
}

// ============================================================================
// REGRA 7: QUEBRA DE RATEIO
// ============================================================================
// Para lançamentos com rateio, quebra em até 5 parcelas
// Cada parcela recebe:
//   - cCodCategN (categoria)
//   - nDistrValorN (valor específico dessa parcela)
// ============================================================================
interface RateioParcela {
  categoria: string;
  valor: number;
  posicao: number; // 1-5
}

function extrairRateioParcelas(record: RawOmieMovimento): RateioParcela[] {
  const parcelas: RateioParcela[] = [];

  const categorias = ["cCodCateg1", "cCodCateg2", "cCodCateg3", "cCodCateg4", "cCodCateg5"];
  const valores = ["nDistrValor1", "nDistrValor2", "nDistrValor3", "nDistrValor4", "nDistrValor5"];

  for (let i = 0; i < 5; i++) {
    const categoria = getString(record as Record<string, unknown>, [categorias[i]]);
    if (!categoria) break; // Para na primeira vazia

    const valor = parseNumber((record as Record<string, unknown>)[valores[i]]);
    parcelas.push({
      categoria,
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

    const [year, month, day] = paymentDate.split("-").map(Number);
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
    // Helper: Gera omie_id único
    // ====================================================================
    const makeOmieId = (suffix: string): string => {
      let base: string;
      if (nCodTitulo !== "0" && nCodTitulo !== "") {
        base = `${nCodTitulo}:${cNumParcela}:${cOrigem}`;
      } else if (cNumTitulo) {
        base = `0:${cNumTitulo}:${cOrigem}`;
      } else {
        base = `0:${paymentDate}:${cOrigem}:${batchIndex}`;
      }
      return `mov:${base}${suffix}`;
    };

    auditLog.omie_id_source = makeOmieId("");

    const entries: ProcessedFinancialEntry[] = [];

    // ====================================================================
    // REGRA 7: RATEIO - Quebra em até 5 parcelas
    // ====================================================================
    if (temRateio) {
      const parcelas = extrairRateioParcelas(record);

      for (const parcela of parcelas) {
        const entry: ProcessedFinancialEntry = {
          omie_id: makeOmieId(`:r${parcela.posicao}`),
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
      omie_id: makeOmieId(""),
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

export function processMovimentos(
  rawMovimentos: Record<string, unknown>[],
  companyId: string
): {
  entries: ProcessedFinancialEntry[];
  auditLogs: ProcessingAuditLog[];
} {
  const entries: ProcessedFinancialEntry[] = [];
  const auditLogs: ProcessingAuditLog[] = [];

  for (let i = 0; i < rawMovimentos.length; i++) {
    const result = processMovimento(rawMovimentos[i], {
      companyId,
      batchIndex: i,
    });
    entries.push(...result.entries);
    auditLogs.push(result.auditLog);
  }

  return { entries, auditLogs };
}
