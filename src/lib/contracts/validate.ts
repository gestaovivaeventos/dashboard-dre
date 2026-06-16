// Port of analisar_linha() from the GCP Cloud Function (main.py).
// Validates a requisition row against its extracted contract data,
// applying rules that depend on the document type.

import { WRatio } from 'fuzzball'

import {
  DEFAULT_DOC_TYPE,
  type ExtractedContract,
  type RequisitionInput,
  type ValidationResult,
} from './types'

const FUZZY_NAME_THRESHOLD = 85
// Diferença de até R$ 0,02 entre documento e requisição é aceitável (arredondamentos
// de parcela, centavos de OCR). Acima disso é divergência de valor.
const VALUE_TOLERANCE = 0.02

// Acima deste valor, exige dados bancários + assinaturas (R4/R5/R6 na camada 1,
// R14/R15/R16 na camada 2). Abaixo, contrato precisa só de nome + CPF/CNPJ +
// valor. O valor de referência é o MAIOR entre valor do contrato, soma das
// parcelas e valor da requisição — "na dúvida, o maior" (nunca aprova de menos).
const LIMITE_ALTO_VALOR = 10000

function maiorValor(...valores: Array<number | null | undefined>): number {
  const nums = valores.map((v) => Number(v) || 0).filter((v) => Number.isFinite(v))
  return nums.length ? Math.max(...nums) : 0
}

// Requisições de FEE/Cerimonial não passam por leitura de documento — vão
// direto para aprovação manual (análise especialista). Casa "fee" como palavra
// isolada (evita "coffee", "feedback") e "cerimonial" como substring, sem
// acento e sem distinção de caixa.
export function isFeeCerimonial(descricao: string | null | undefined): boolean {
  if (!descricao) return false
  const norm = descricao
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return /\bfee\b/.test(norm) || norm.includes('cerimonial')
}

// Parser tolerante de data: aceita "DD/MM/AAAA" (e variações com . ou -),
// ISO "AAAA-MM-DD" e número serial do Excel. Retorna null se não der pra ler.
export function parseDataBR(value: string | null | undefined): Date | null {
  if (!value) return null
  const s = String(value).trim()
  if (!s) return null
  if (/^\d+(\.\d+)?$/.test(s)) {
    // Serial do Excel (epoch 1899-12-30).
    const serial = Number(s)
    if (serial > 59 && serial < 100000) {
      const d = new Date(Math.round((serial - 25569) * 86400000))
      return Number.isNaN(d.getTime()) ? null : d
    }
    return null
  }
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/)
  if (m) {
    let year = Number(m[3])
    if (year < 100) year += 2000
    const d = new Date(year, Number(m[2]) - 1, Number(m[1]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

function formatarData(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}

// Cronograma por módulo (janela de antecedência da contratação em relação ao
// evento). Antecedência = data_evento − data_contrato, em dias.
// Fora da janela NÃO reprova — só gera alerta. Tabela fácil de ajustar.
const CRONOGRAMA_MODULOS: Record<number, { nome: string; minDias: number; maxDias: number }> = {
  1: { nome: 'Fotografia', minDias: -90, maxDias: Number.POSITIVE_INFINITY }, // até 3 meses após o evento (confirmado)
  2: { nome: 'Local', minDias: 180, maxDias: 540 }, // 18 a 6 meses antes
  3: { nome: 'Atração/Buffet', minDias: 180, maxDias: 365 }, // 12 a 6 meses antes
  4: { nome: 'Complementos', minDias: 30, maxDias: 180 }, // 6 a 1 mês antes
  5: { nome: 'Segurança/Staff', minDias: 7, maxDias: 90 }, // 3 meses a 7 dias antes
}

export function alertaCronograma(
  modulo: number | null | undefined,
  dataEvento: string | null | undefined,
  dataContrato: string | null | undefined,
): string | null {
  if (!modulo) return null
  const janela = CRONOGRAMA_MODULOS[modulo]
  if (!janela) return null
  const evento = parseDataBR(dataEvento)
  const contrato = parseDataBR(dataContrato)
  if (!evento || !contrato) return null
  const diffDias = Math.round((evento.getTime() - contrato.getTime()) / 86400000)
  if (diffDias < janela.minDias || diffDias > janela.maxDias) {
    const max = Number.isFinite(janela.maxDias) ? `${janela.maxDias}` : '∞'
    return `Módulo ${modulo} (${janela.nome}): contratação fora da janela — ${diffDias} dia(s) de antecedência (esperado ${janela.minDias} a ${max} dias)`
  }
  return null
}

const TERMOS_REMOVIVEIS = new Set([
  'ltda',
  'me',
  'sa',
  's/a',
  'eireli',
  'epp',
  'cia',
  'companhia',
])

export function limparNomeEmpresa(texto: string | null | undefined): string {
  if (!texto) return ''
  const semPontuacao = texto.toLowerCase().replace(/[^\w\s]/g, '')
  return semPontuacao
    .split(/\s+/)
    .filter((p) => p && !TERMOS_REMOVIVEIS.has(p))
    .join(' ')
}

function digitsOnly(value: string | null | undefined): string {
  if (!value) return ''
  return value.replace(/\D/g, '')
}

function isAssinaturaPresente(value: string | null | undefined): boolean {
  if (!value) return false
  const normalized = value.trim().toLowerCase()
  return normalized === 'sim'
}

// Match thefuzz's WRatio semantics: when one side is empty, treat as no match.
function nomesParecem(a: string, b: string): boolean {
  if (!a || !b) return false
  return WRatio(a, b) >= FUZZY_NAME_THRESHOLD
}

interface ValidateOptions {
  // Sum of valor_contrato of all items in the same (requisicao_codigo, tipo_documento)
  // group. Used as a fallback when individual values don't match but the sum does
  // (e.g. multiple parcial invoices for one requisition).
  somaDoGrupo: number
}

export function analisarLinha(
  req: RequisitionInput,
  doc: ExtractedContract,
  opts: ValidateOptions,
): ValidationResult {
  const motivos: string[] = []
  let contratoSemConta = false

  const docTipo = (doc.tipo_documento || DEFAULT_DOC_TYPE).trim() || DEFAULT_DOC_TYPE
  const somaDoGrupo = Number(opts.somaDoGrupo) || 0

  // Gate de alto valor: conta bancária e assinaturas só são exigidas quando o
  // valor de referência passa de R$ 10.000.
  const somaParcelasDoc = (doc.valores_pagamentos ?? []).reduce((a, v) => a + (Number(v) || 0), 0)
  const exigeAltoValor =
    maiorValor(doc.valor_contrato, somaParcelasDoc, req.valor) > LIMITE_ALTO_VALOR

  // Rule 1: Razão social / Nome do favorecido
  if (
    docTipo === 'Contrato / Aditivo Contratual' ||
    docTipo === 'Nota Fiscal / Fatura' ||
    docTipo === 'Recibo / Declaração de Quitação'
  ) {
    const reqFornecedor = (req.fornecedor ?? '').trim()
    const reqFavorecido = (req.favorecido ?? '').trim()
    const docFornecedor = (doc.fornecedor ?? '').trim()

    if (!reqFornecedor && !reqFavorecido) {
      motivos.push('Fornecedor/Favorecido da requisição (Aba A) em branco')
    } else if (!docFornecedor) {
      motivos.push('Nome/Razão Social do documento (Aba B) em branco')
    } else {
      const docLimpo = limparNomeEmpresa(docFornecedor)
      const fornecedorLimpo = limparNomeEmpresa(reqFornecedor)
      const favorecidoLimpo = limparNomeEmpresa(reqFavorecido)

      const matchFornecedor = fornecedorLimpo ? nomesParecem(docLimpo, fornecedorLimpo) : false
      const matchFavorecido = favorecidoLimpo ? nomesParecem(docLimpo, favorecidoLimpo) : false

      if (!matchFornecedor && !matchFavorecido) {
        motivos.push(
          `Nome não corresponde (Doc:'${docFornecedor}' vs Req Forn:'${reqFornecedor}', Req Fav:'${reqFavorecido}')`,
        )
      }
    }
  }

  // Rule 2: CPF/CNPJ
  if (
    docTipo === 'Contrato / Aditivo Contratual' ||
    docTipo === 'Nota Fiscal / Fatura' ||
    docTipo === 'Boleto' ||
    docTipo === 'Atas, Orçamentos, Ordens de Serviço'
  ) {
    const reqCnpj = digitsOnly(req.cpf_cnpj)
    // Casa contra TODOS os CPF/CNPJ do documento (favorecido + contratante +
    // demais). O contrato pode ser firmado num CNPJ e indicar outro CPF/CNPJ
    // como favorecido do pagamento — basta o documento da requisição constar em
    // qualquer ponto do contrato. Fallback ao cpf_cnpj principal para extrações
    // antigas sem a lista.
    const docCnpjsTodos = (doc.cpf_cnpj_todos?.length ? doc.cpf_cnpj_todos : [doc.cpf_cnpj])
      .map(digitsOnly)
      .filter(Boolean)

    if (!reqCnpj) {
      motivos.push('CPF/CNPJ da requisição (Aba A) em branco')
    } else if (docCnpjsTodos.length === 0) {
      motivos.push('CPF/CNPJ não encontrado no documento (Aba B)')
    } else if (!docCnpjsTodos.includes(reqCnpj)) {
      const lista = doc.cpf_cnpj_todos?.length
        ? doc.cpf_cnpj_todos.join(', ')
        : doc.cpf_cnpj ?? ''
      motivos.push(
        `CPF/CNPJ não confere (Req: '${req.cpf_cnpj ?? ''}' não consta no documento. Encontrados: ${lista})`,
      )
    }
  }

  // Rule 3: Valor total
  if (docTipo !== 'Documentos de Suporte / Evidências') {
    const reqValor = Number(req.valor) || 0
    const valoresDoc = [
      Number(doc.valor_contrato) || 0,
      ...doc.valores_pagamentos.map((v) => Number(v) || 0),
    ].filter((v) => v > 0)

    if (valoresDoc.length === 0 && somaDoGrupo === 0) {
      motivos.push('Nenhum valor encontrado no documento (Aba B)')
    } else {
      let valorAprovado = false

      // Check 1: any individual value matches the requisition value (±0.01)
      for (const v of valoresDoc) {
        if (Math.abs(reqValor - v) <= VALUE_TOLERANCE) {
          valorAprovado = true
          break
        }
      }

      // Check 2: if not, does the group sum match the requisition value (±0.01)?
      if (!valorAprovado && somaDoGrupo > 0) {
        if (Math.abs(reqValor - somaDoGrupo) <= VALUE_TOLERANCE) {
          valorAprovado = true
        }
      }

      if (!valorAprovado) {
        const valoresStr = valoresDoc.map((v) => v.toFixed(2)).join(', ')
        motivos.push(
          `Valor não corresponde (Req: ${reqValor.toFixed(2)} vs Doc: [${valoresStr}] e vs Soma: [${somaDoGrupo.toFixed(2)}])`,
        )
      }
    }
  }

  // Rule 4: Dados bancários (only for Contrato, e só acima de R$ 10.000)
  if (docTipo === 'Contrato / Aditivo Contratual' && exigeAltoValor) {
    const contratoConta = (doc.conta ?? '').trim()
    const reqConta = (req.conta ?? '').trim()

    if (!contratoConta || contratoConta.toLowerCase() === 'não preenchido') {
      contratoSemConta = true
    } else {
      const contratoContaLimpo = digitsOnly(contratoConta)
      const reqContaLimpo = digitsOnly(reqConta)

      if (!reqContaLimpo) {
        motivos.push('Conta da requisição (Aba A) em branco')
      } else if (!contratoContaLimpo.includes(reqContaLimpo)) {
        motivos.push(
          `Conta bancária não confere (Doc: '${contratoConta}' vs Req: '${reqConta}')`,
        )
      }
    }
  }

  // Rule 5: Assinatura do contratante (only Contrato, e só acima de R$ 10.000)
  if (docTipo === 'Contrato / Aditivo Contratual' && exigeAltoValor) {
    if (!isAssinaturaPresente(doc.assinatura_contratante)) {
      motivos.push('Assinatura do contratante ausente')
    }
  }

  // Rule 6: Assinatura do contratado (Contrato + Recibo, e só acima de R$ 10.000)
  if (
    (docTipo === 'Contrato / Aditivo Contratual' ||
      docTipo === 'Recibo / Declaração de Quitação') &&
    exigeAltoValor
  ) {
    if (!isAssinaturaPresente(doc.assinatura_contratado)) {
      motivos.push('Assinatura do contratado ausente')
    }
  }

  // Final status — matches the GCP string outputs verbatim so the
  // status_resumo column stays human-readable and consistent with history.
  if (motivos.length > 0) {
    if (docTipo === 'Documentos de Suporte / Evidências') {
      return {
        status: 'analise_especialista',
        motivos,
        resumo: `(${docTipo}) (Ignorar Reprovação) - Motivos: ${motivos.join(', ')}`,
      }
    }
    return {
      status: 'reprovada',
      motivos,
      resumo: `Reprovada - Motivo (${docTipo}): ${motivos.join(', ')}`,
    }
  }

  if (docTipo === 'Documentos de Suporte / Evidências') {
    return {
      status: 'analise_especialista',
      motivos: [],
      resumo: `Análise do Especialista - (${docTipo})`,
    }
  }

  if (contratoSemConta && docTipo === 'Contrato / Aditivo Contratual') {
    return {
      status: 'aprovada_ressalva',
      motivos: ['Contrato acima de R$ 10.000 sem dados bancários — confira a conta antes de pagar'],
      resumo: `Aprovada com ressalva - Sem dados bancários no contrato (${docTipo})`,
    }
  }

  return {
    status: 'aprovada',
    motivos: [],
    resumo: `Aprovada (${docTipo})`,
  }
}

// Builds the (requisicao_codigo, tipo_documento) -> sum(valor_contrato) map
// used by analisarLinha. Mirrors the soma_grupos_b dict from main.py.
export function calcularSomaGrupos(
  items: Array<{
    requisicao_codigo: string
    tipo_documento: string | null
    extracted_valor_contrato: number | null
  }>,
): Map<string, number> {
  const map = new Map<string, number>()
  for (const item of items) {
    const tipo = (item.tipo_documento || DEFAULT_DOC_TYPE).trim() || DEFAULT_DOC_TYPE
    const key = `${item.requisicao_codigo}|${tipo}`
    const current = map.get(key) ?? 0
    map.set(key, current + (Number(item.extracted_valor_contrato) || 0))
  }
  return map
}

export function chaveGrupoSoma(requisicaoCodigo: string, tipoDocumento: string | null): string {
  const tipo = (tipoDocumento || DEFAULT_DOC_TYPE).trim() || DEFAULT_DOC_TYPE
  return `${requisicaoCodigo}|${tipo}`
}

// ─── Validação por requisição (rules R1, R6, R9, R10, R14, R15, R16, V1) ────

export interface RequisitionDocument extends ExtractedContract {
  // Whether the extraction step succeeded. Items with extraction_failed=true
  // make the whole requisition non-validatable (status = 'erro').
  extraction_failed: boolean
}

export interface RequisitionGroup {
  requisicao_codigo: string
  req: RequisitionInput
  documentos: RequisitionDocument[]
}

const TIPO_CONTRATO = 'Contrato / Aditivo Contratual'
const TIPO_NF = 'Nota Fiscal / Fatura'
const TIPO_BOLETO = 'Boleto'

export function analisarRequisicao(group: RequisitionGroup): ValidationResult {
  // If ANY document had an extraction failure, we can't audit the requisition
  // safely — flag the whole group as 'erro' so a human/retry pipeline picks it up.
  const errored = group.documentos.filter((d) => d.extraction_failed)
  if (errored.length > 0) {
    return {
      status: 'erro',
      motivos: [`${errored.length} documento(s) com falha de extração — não foi possível validar a requisição`],
      resumo: 'Erro de extração em um ou mais documentos',
    }
  }

  // Only consider documents the model could classify. Suporte/Evidências is
  // informational only (didn't carry data we use here).
  const docs = group.documentos.filter(
    (d) => d.tipo_documento && d.tipo_documento !== 'Documentos de Suporte / Evidências',
  )

  if (docs.length === 0) {
    return {
      status: 'analise_especialista',
      motivos: ['Nenhum documento classificável (apenas suporte/evidências)'],
      resumo: 'Análise do especialista — apenas documentos de suporte',
    }
  }

  const req = group.req
  const reqValor = Number(req.valor) || 0

  // Sem valor na RP não dá para determinar a faixa nem comparar valores —
  // REVISAR (informação de entrada ausente, não é divergência do documento).
  if (reqValor <= 0) {
    return {
      status: 'analise_especialista',
      motivos: ['Valor da requisição ausente ou ilegível — encaminhado para revisão'],
      resumo: 'Revisar — valor da requisição ausente',
    }
  }

  // motivos  → REPROVAR (divergência explícita OU requisito documental da faixa ausente)
  // revisar  → analise_especialista (falta info de entrada / caso não avaliável)
  // ressalvas→ aprovada_ressalva (avisos que não bloqueiam o pagamento)
  const motivos: string[] = []
  const revisar: string[] = []
  const ressalvas: string[] = []

  // ── Identificação cruzada da RP com os documentos ────────────────────────
  const reqForn = limparNomeEmpresa(req.fornecedor)
  const reqFav = limparNomeEmpresa(req.favorecido)
  const reqCnpj = digitsOnly(req.cpf_cnpj)
  const reqConta = digitsOnly(req.conta)
  const matchNome = docs.some((d) => {
    const docName = limparNomeEmpresa(d.fornecedor)
    if (!docName) return false
    return (reqForn && nomesParecem(docName, reqForn)) || (reqFav && nomesParecem(docName, reqFav))
  })
  const matchCnpj = reqCnpj
    ? docs.some((d) =>
        (d.cpf_cnpj_todos?.length ? d.cpf_cnpj_todos : [d.cpf_cnpj]).map(digitsOnly).includes(reqCnpj),
      )
    : false

  // ── Valor (ambas as faixas) ──────────────────────────────────────────────
  // Soma dos valores dos documentos vs valor da RP. Estouro com parcela
  // compatível → pagamento parcial (verificar_saldo); soma menor → reprova.
  let partialPayment: null | { somaContratos: number; parcelaIdentificada: number } = null
  {
    const soma = docs.reduce((acc, d) => acc + (Number(d.valor_contrato) || 0), 0)
    const diff = soma - reqValor
    if (Math.abs(diff) <= VALUE_TOLERANCE) {
      // valor confere
    } else if (diff > 0) {
      const todasParcelas = docs.flatMap((d) => d.valores_pagamentos.map((v) => Number(v) || 0))
      const parcela = todasParcelas.find((v) => Math.abs(v - reqValor) <= VALUE_TOLERANCE)
      if (parcela !== undefined) {
        partialPayment = { somaContratos: soma, parcelaIdentificada: parcela }
      } else {
        motivos.push(
          `Valor da requisição (${reqValor.toFixed(2)}) não corresponde à soma dos documentos (${soma.toFixed(2)}) nem a nenhuma parcela declarada`,
        )
      }
    } else {
      motivos.push(
        `Soma dos valores dos documentos (${soma.toFixed(2)}) é menor que o valor da requisição (${reqValor.toFixed(2)})`,
      )
    }
  }

  if (reqValor <= LIMITE_ALTO_VALOR) {
    // ═══════════ FAIXA 1 — RP até R$ 10.000 (validação flexível) ═══════════
    // Aprova com: favorecido identificável (CNPJ OU nome) + valor compatível +
    // ≥1 anexo classificável (garantido por docs.length > 0). Não exige
    // dados bancários, assinaturas, cronograma nem tipo específico de anexo.
    const reqTemIdentificacao = Boolean(reqCnpj || reqForn || reqFav)
    if (!reqTemIdentificacao) {
      revisar.push('Favorecido da requisição em branco (sem nome e sem CPF/CNPJ)')
    } else if (!matchNome && !matchCnpj) {
      motivos.push(
        `Favorecido da requisição não confere com nenhum documento (Req: '${req.favorecido ?? req.fornecedor ?? ''}' / '${req.cpf_cnpj ?? ''}')`,
      )
    }
  } else {
    // ═══════════ FAIXA 2 — RP acima de R$ 10.000 (validação rígida) ═══════════
    // CNPJ/CPF do favorecido compatível é obrigatório nas duas variantes.
    if (!reqCnpj) {
      motivos.push('CPF/CNPJ da requisição ausente — obrigatório acima de R$ 10.000')
    } else if (!matchCnpj) {
      motivos.push(`CPF/CNPJ da requisição não confere com nenhum documento (Req: ${req.cpf_cnpj ?? ''})`)
    }

    const temContrato = docs.some((d) => d.tipo_documento === TIPO_CONTRATO)

    if (temContrato) {
      // ── A) Contrato de serviço / compromisso formal: contrato completo ──
      const contratos = docs.filter((d) => d.tipo_documento === TIPO_CONTRATO)

      if (contratos.some((c) => !isAssinaturaPresente(c.assinatura_contratante))) {
        motivos.push('Contrato sem assinatura do contratante')
      }
      if (contratos.some((c) => !isAssinaturaPresente(c.assinatura_contratado))) {
        motivos.push('Contrato sem assinatura do contratado')
      }

      // Dados bancários compatíveis com o favorecido.
      const docsComConta = docs.filter((d) => digitsOnly(d.conta))
      if (docsComConta.length === 0) {
        motivos.push('Contrato acima de R$ 10.000 sem dados bancários no documento')
      } else if (!reqConta) {
        revisar.push('Documento com conta bancária, mas a requisição está sem conta para conferência')
      } else if (!docsComConta.some((d) => digitsOnly(d.conta).includes(reqConta))) {
        const contas = docsComConta.map((d) => d.conta || '—').join(' / ')
        motivos.push(`Conta bancária dos documentos (${contas}) não confere com a requisição (${req.conta ?? ''})`)
      }

      // Valores das parcelas presentes; vencimentos ausentes só geram ressalva.
      const temValor = docs.some(
        (d) => (d.valores_pagamentos ?? []).length > 0 || (Number(d.valor_contrato) || 0) > 0,
      )
      if (!temValor) motivos.push('Contrato sem valores de pagamento')
      const temVencimento = docs.some((d) => (d.datas_vencimento ?? []).length > 0)
      if (!temVencimento) {
        ressalvas.push('Contrato sem datas de vencimento das parcelas — confira o cronograma')
      }
    } else {
      // ── B) Documento fiscal avulso (NF/Fatura/Boleto), sem contrato ──
      // Não exige contrato/assinatura/bancário. Exige documento fiscal idôneo:
      // número do documento OU chave de acesso. (CNPJ e valor já checados.)
      const docsFiscais = docs.filter(
        (d) => d.tipo_documento === TIPO_NF || d.tipo_documento === TIPO_BOLETO,
      )
      if (docsFiscais.length === 0) {
        motivos.push('Requisição acima de R$ 10.000 sem contrato nem documento fiscal (NF/Fatura/Boleto)')
      } else {
        const temIdoneidade = docsFiscais.some(
          (d) => (d.numero_documento ?? '').trim() || (d.chave_acesso ?? '').trim(),
        )
        if (!temIdoneidade) {
          motivos.push('Documento fiscal sem número nem chave de acesso — idoneidade não confirmada')
        }
      }
    }
  }

  // ── BV — Saldo do contrato (ambas as faixas) ──────────────────────────────
  // O já-pago (base de RPs pagas, casando fundo + CNPJ + nº do contrato) mais
  // esta RP não pode estourar o valor do contrato. Só roda quando há valor de
  // contrato e histórico disponível.
  const valorContratoBV = Number(req.valor_total_contrato) || 0
  if (valorContratoBV > 0 && req.historico_rps_pagas != null) {
    const jaPago = Number(req.historico_rps_pagas) || 0
    const saldo = valorContratoBV - jaPago
    if (reqValor > saldo + VALUE_TOLERANCE) {
      motivos.push(
        `BV estourado: já pago R$ ${jaPago.toFixed(2)} + esta RP R$ ${reqValor.toFixed(2)} excede o valor do contrato R$ ${valorContratoBV.toFixed(2)} (saldo disponível R$ ${saldo.toFixed(2)})`,
      )
    }
  }

  // ── Alertas (não mudam o status): cronograma por módulo ──────────────────
  const alertas: string[] = []
  if (req.modulo && req.data_evento) {
    const contratoComData = docs.find((d) => d.data_contrato)
    const al = alertaCronograma(req.modulo, req.data_evento, contratoComData?.data_contrato)
    if (al) alertas.push(al)
  }
  const comAlertas = alertas.length ? { alertas } : {}

  // ── Ressalva: vencimento do documento posterior à data prevista da RP ─────
  const prevista = parseDataBR(req.data_pagamento_prevista)
  if (prevista) {
    let vencPosterior: Date | null = null
    for (const d of docs) {
      for (const v of d.datas_vencimento ?? []) {
        const venc = parseDataBR(v)
        if (venc && venc.getTime() > prevista.getTime() && (!vencPosterior || venc > vencPosterior)) {
          vencPosterior = venc
        }
      }
    }
    if (vencPosterior) {
      ressalvas.push(
        `Vencimento do documento (${formatarData(vencPosterior)}) posterior à data prevista de pagamento (${formatarData(prevista)})`,
      )
    }
  }

  // ── Decisão final ─────────────────────────────────────────────────────────
  // Prioridade: REPROVAR (divergência/requisito ausente) > REVISAR (falta de
  // info / pagamento parcial) > APROVAR com ressalva > APROVAR.
  const tipos = Array.from(new Set(docs.map((d) => d.tipo_documento).filter(Boolean))).join(', ')

  if (motivos.length > 0) {
    return {
      status: 'reprovada',
      motivos,
      resumo: `Reprovada — ${motivos.join(' · ')}`,
      ...comAlertas,
    }
  }

  if (revisar.length > 0) {
    return {
      status: 'analise_especialista',
      motivos: revisar,
      resumo: `Revisar — ${revisar.join(' · ')}`,
      ...comAlertas,
    }
  }

  if (partialPayment) {
    return {
      status: 'verificar_saldo',
      motivos: [
        `Pagamento parcial: parcela R$ ${partialPayment.parcelaIdentificada.toFixed(2)} de contrato R$ ${partialPayment.somaContratos.toFixed(2)}. Confirme manualmente que o saldo do contrato comporta esta requisição.`,
      ],
      resumo: `Verificar saldo — parcela de R$ ${partialPayment.parcelaIdentificada.toFixed(2)} identificada em contrato de R$ ${partialPayment.somaContratos.toFixed(2)} (${docs.length} doc${docs.length === 1 ? '' : 's'})`,
      ...comAlertas,
    }
  }

  if (ressalvas.length > 0) {
    return {
      status: 'aprovada_ressalva',
      motivos: ressalvas,
      resumo: `Aprovada com ressalva — ${ressalvas.join(' · ')}`,
      ...comAlertas,
    }
  }

  return {
    status: 'aprovada',
    motivos: [],
    resumo: `Aprovada (${docs.length} doc${docs.length === 1 ? '' : 's'}${tipos ? ': ' + tipos : ''})`,
    ...comAlertas,
  }
}
