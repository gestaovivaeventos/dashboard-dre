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
const VALUE_TOLERANCE = 0.01

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

  // Rule 4: Dados bancários (only for Contrato)
  if (docTipo === 'Contrato / Aditivo Contratual') {
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

  // Rule 5: Assinatura do contratante (only Contrato)
  if (docTipo === 'Contrato / Aditivo Contratual') {
    if (!isAssinaturaPresente(doc.assinatura_contratante)) {
      motivos.push('Assinatura do contratante ausente')
    }
  }

  // Rule 6: Assinatura do contratado (Contrato + Recibo)
  if (
    docTipo === 'Contrato / Aditivo Contratual' ||
    docTipo === 'Recibo / Declaração de Quitação'
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
      status: 'aprovada',
      motivos: [],
      resumo: `Aprovada - Sem dados bancários no contrato (${docTipo})`,
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

  // R1 — Soma dos valor_contrato bate com valor da req (±0,01)
  const reqValor = Number(req.valor) || 0
  if (reqValor > 0) {
    const soma = docs.reduce((acc, d) => acc + (Number(d.valor_contrato) || 0), 0)
    if (Math.abs(reqValor - soma) > VALUE_TOLERANCE) {
      motivos.push(
        `Soma dos valores dos documentos (${soma.toFixed(2)}) não corresponde ao valor da requisição (${reqValor.toFixed(2)})`,
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

  // R14 — Se algum doc tem conta preenchida, pelo menos um deles tem que bater com a da req
  const reqConta = digitsOnly(req.conta)
  const docsComConta = docs.filter((d) => digitsOnly(d.conta))
  if (docsComConta.length > 0) {
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

  // V1 — Qualquer regra falhou → Reprovada
  if (motivos.length > 0) {
    return {
      status: 'reprovada',
      motivos,
      resumo: `Reprovada — ${motivos.join(' · ')}`,
    }
  }

  const tipos = Array.from(new Set(docs.map((d) => d.tipo_documento).filter(Boolean))).join(', ')
  return {
    status: 'aprovada',
    motivos: [],
    resumo: `Aprovada (${docs.length} doc${docs.length === 1 ? '' : 's'}${tipos ? ': ' + tipos : ''})`,
  }
}
