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
