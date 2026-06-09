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
    const docCnpj = digitsOnly(doc.cpf_cnpj)

    if (!reqCnpj) {
      motivos.push('CPF/CNPJ da requisição (Aba A) em branco')
    } else if (!docCnpj) {
      motivos.push('CPF/CNPJ não encontrado no documento (Aba B)')
    } else if (reqCnpj !== docCnpj) {
      motivos.push(
        `CPF/CNPJ não confere (Doc: '${doc.cpf_cnpj ?? ''}' vs Req: '${req.cpf_cnpj ?? ''}')`,
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
const TIPO_RECIBO = 'Recibo / Declaração de Quitação'
const TIPO_BOLETO = 'Boleto'

// Threshold for the R10 document-required rule:
// req.valor ≤ R$ 1.000 → recibo (qualquer)
// req.valor ≥ R$ 1.001 → contrato OU recibo assinado OU boleto
const R10_THRESHOLD = 1000

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

  const motivos: string[] = []
  const req = group.req
  // Tracks the "partial payment" scenario: contract total exceeds the
  // requisition value, but one of the contract's installments (pagamentoX)
  // matches. We can't auto-approve (would need contract balance history we
  // don't have), but we don't want to reprove either — the requisition is
  // legitimate, just needs a manual balance check.
  let partialPayment: null | {
    somaContratos: number
    parcelaIdentificada: number
  } = null

  // R1 — Soma dos valor_contrato bate com valor da req (±0,01)
  // Three outcomes: exact match (ok), overage with matching installment
  // (verificar_saldo), or true mismatch (reprovada).
  const reqValor = Number(req.valor) || 0
  if (reqValor > 0) {
    const soma = docs.reduce((acc, d) => acc + (Number(d.valor_contrato) || 0), 0)
    const diff = soma - reqValor

    if (Math.abs(diff) <= VALUE_TOLERANCE) {
      // Match — R1 passes.
    } else if (diff > 0) {
      // Sum of contract totals exceeds the requisition. Could be partial
      // payment: scan installments across all docs for a value that matches.
      const todasParcelas = docs.flatMap((d) => d.valores_pagamentos.map((v) => Number(v) || 0))
      const parcela = todasParcelas.find((v) => Math.abs(v - reqValor) <= VALUE_TOLERANCE)
      if (parcela !== undefined) {
        partialPayment = { somaContratos: soma, parcelaIdentificada: parcela }
      } else {
        motivos.push(
          `Valor da requisição (${reqValor.toFixed(2)}) não corresponde à soma dos contratos (${soma.toFixed(2)}) nem a nenhuma parcela declarada`,
        )
      }
    } else {
      // Sum is LESS than requisition — req is paying more than the docs say
      // the contract is worth. Always a real problem.
      motivos.push(
        `Soma dos valores dos documentos (${soma.toFixed(2)}) é menor que o valor da requisição (${reqValor.toFixed(2)})`,
      )
    }
  } else {
    motivos.push('Valor da requisição em branco ou zero')
  }

  // R6 — Pelo menos UM doc com fornecedor casando (fuzzy ≥85) com forn ou favorecido da req
  const reqForn = limparNomeEmpresa(req.fornecedor)
  const reqFav = limparNomeEmpresa(req.favorecido)
  if (!reqForn && !reqFav) {
    motivos.push('Fornecedor/Favorecido da requisição em branco')
  } else {
    const algumBate = docs.some((d) => {
      const docName = limparNomeEmpresa(d.fornecedor)
      if (!docName) return false
      return (
        (reqForn && nomesParecem(docName, reqForn)) ||
        (reqFav && nomesParecem(docName, reqFav))
      )
    })
    if (!algumBate) {
      const nomesDocs = docs.map((d) => d.fornecedor || '—').join(' / ')
      motivos.push(
        `Nenhum documento com fornecedor correspondente (Req: '${req.fornecedor ?? ''}' / '${req.favorecido ?? ''}' vs Docs: ${nomesDocs})`,
      )
    }
  }

  // R9 — Pelo menos UM doc com CPF/CNPJ batendo com o da req
  const reqCnpj = digitsOnly(req.cpf_cnpj)
  if (!reqCnpj) {
    motivos.push('CPF/CNPJ da requisição em branco')
  } else {
    const algumBate = docs.some((d) => digitsOnly(d.cpf_cnpj) === reqCnpj)
    if (!algumBate) {
      motivos.push(`Nenhum documento com CPF/CNPJ correspondente (Req: ${req.cpf_cnpj ?? ''})`)
    }
  }

  // R10 — Documentos obrigatórios por faixa de valor
  if (reqValor > 0 && reqValor <= R10_THRESHOLD) {
    const temRecibo = docs.some((d) => d.tipo_documento === TIPO_RECIBO)
    if (!temRecibo) {
      motivos.push(`Requisição até R$ ${R10_THRESHOLD.toFixed(2)} exige pelo menos um Recibo`)
    }
  } else if (reqValor >= R10_THRESHOLD + 1) {
    const temContrato = docs.some((d) => d.tipo_documento === TIPO_CONTRATO)
    const temReciboAssinado = docs.some(
      (d) => d.tipo_documento === TIPO_RECIBO && isAssinaturaPresente(d.assinatura_contratado),
    )
    const temBoleto = docs.some((d) => d.tipo_documento === TIPO_BOLETO)
    if (!temContrato && !temReciboAssinado && !temBoleto) {
      motivos.push(
        `Requisição acima de R$ ${R10_THRESHOLD.toFixed(2)} exige Contrato OU Recibo assinado OU Boleto`,
      )
    }
  }

  // Gate de alto valor (requisição): conta bancária e assinaturas só são
  // exigidas quando o valor de referência passa de R$ 10.000. Referência = o
  // maior entre valor da req, soma dos contratos e todas as parcelas.
  const somaContratosRef = docs.reduce((a, d) => a + (Number(d.valor_contrato) || 0), 0)
  const todasParcelasRef = docs.flatMap((d) => (d.valores_pagamentos ?? []).map((v) => Number(v) || 0))
  const exigeAltoValorReq =
    maiorValor(reqValor, somaContratosRef, ...todasParcelasRef) > LIMITE_ALTO_VALOR

  // R14 — Se algum doc tem conta preenchida, pelo menos um deles tem que bater
  // com a da req (só acima de R$ 10.000)
  const reqConta = digitsOnly(req.conta)
  const docsComConta = docs.filter((d) => digitsOnly(d.conta))
  if (exigeAltoValorReq && docsComConta.length > 0) {
    if (!reqConta) {
      motivos.push('Documento(s) com conta bancária preenchida, mas a requisição está sem conta')
    } else {
      const algumBate = docsComConta.some((d) => digitsOnly(d.conta).includes(reqConta))
      if (!algumBate) {
        const contas = docsComConta.map((d) => d.conta || '—').join(' / ')
        motivos.push(
          `Conta bancária dos documentos (${contas}) não confere com a requisição (${req.conta ?? ''})`,
        )
      }
    }
  }

  // R15/R16 — Assinaturas só são exigidas acima de R$ 10.000.
  if (exigeAltoValorReq) {
    // R15 — Se tem Contrato, ele DEVE ter assinatura contratante e contratado
    const contratos = docs.filter((d) => d.tipo_documento === TIPO_CONTRATO)
    const recibos = docs.filter((d) => d.tipo_documento === TIPO_RECIBO)
    if (contratos.length > 0) {
      const semContratante = contratos.some((c) => !isAssinaturaPresente(c.assinatura_contratante))
      const semContratado = contratos.some((c) => !isAssinaturaPresente(c.assinatura_contratado))
      if (semContratante) motivos.push('Contrato sem assinatura do contratante')
      if (semContratado) motivos.push('Contrato sem assinatura do contratado')
    } else if (recibos.length > 0) {
      // R16 — Sem Contrato, mas tem Recibo → recibo deve estar assinado pelo contratado
      const semAssinatura = recibos.some((r) => !isAssinaturaPresente(r.assinatura_contratado))
      if (semAssinatura) motivos.push('Recibo sem assinatura do contratado')
    }
  }

  // V1 — Qualquer regra falhou → Reprovada
  // Alertas (não mudam o status): cronograma por módulo. Usa a data do contrato
  // do(s) documento(s), o módulo e a data do evento da RP. Fora da janela → avisa.
  const alertas: string[] = []
  if (req.modulo && req.data_evento) {
    const contratoComData = docs.find((d) => d.data_contrato)
    const al = alertaCronograma(req.modulo, req.data_evento, contratoComData?.data_contrato)
    if (al) alertas.push(al)
  }
  const comAlertas = alertas.length ? { alertas } : {}

  if (motivos.length > 0) {
    return {
      status: 'reprovada',
      motivos,
      resumo: `Reprovada — ${motivos.join(' · ')}`,
      ...comAlertas,
    }
  }

  const tipos = Array.from(new Set(docs.map((d) => d.tipo_documento).filter(Boolean))).join(', ')

  // Sem reprovações, mas com pagamento parcial detectado → não é seguro
  // aprovar sozinho. Sinaliza pra revisão manual do saldo do contrato.
  if (partialPayment) {
    const resumo = `Verificar saldo — parcela de R$ ${partialPayment.parcelaIdentificada.toFixed(2)} identificada em contrato de R$ ${partialPayment.somaContratos.toFixed(2)} (${docs.length} doc${docs.length === 1 ? '' : 's'})`
    return {
      status: 'verificar_saldo',
      motivos: [
        `Pagamento parcial: parcela R$ ${partialPayment.parcelaIdentificada.toFixed(2)} de contrato R$ ${partialPayment.somaContratos.toFixed(2)}. Confirme manualmente que o saldo do contrato comporta esta requisição.`,
      ],
      resumo,
      ...comAlertas,
    }
  }

  // Aprovada COM RESSALVA: contrato de alto valor (≥ R$ 10k) sem NENHUM dado
  // bancário nos documentos. Não reprova (a conta pode estar na própria RP),
  // mas sinaliza a pendência pro aprovador conferir.
  const temContratoAltoValor =
    exigeAltoValorReq && docs.some((d) => d.tipo_documento === TIPO_CONTRATO)
  const algumDocComConta = docs.some((d) => digitsOnly(d.conta))
  if (temContratoAltoValor && !algumDocComConta) {
    return {
      status: 'aprovada_ressalva',
      motivos: ['Contrato acima de R$ 10.000 sem dados bancários no documento — confira a conta antes de pagar'],
      resumo: `Aprovada com ressalva — contrato ≥ R$ 10k sem dados bancários (${docs.length} doc${docs.length === 1 ? '' : 's'})`,
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
