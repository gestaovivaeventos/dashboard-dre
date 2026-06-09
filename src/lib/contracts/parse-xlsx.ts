// Parses the requisitions spreadsheet uploaded by the user. Mirrors the
// columns of "Aba A" from the GCP workflow so existing Mundo Viva exports
// can be ingested as-is.

import * as XLSX from 'xlsx'

import { parseValor } from './parse-value'

export interface RequisitionRow {
  requisicao_codigo: string
  fornecedor: string | null
  favorecido: string | null
  cpf_cnpj: string | null
  conta: string | null
  valor: number | null
  link_contrato: string
  descricao: string | null
  // Campos opcionais da RP usados pelas regras de cronograma/BV/vencimento
  // (etapas futuras). Hoje só são transportados — nenhuma regra os consome.
  data_evento: string | null
  modulo: number | null
  valor_total_contrato: number | null
  historico_rps_pagas: number | null
  data_pagamento_prevista: string | null
  // BV (saldo do contrato): chave de casamento com a base de RPs pagas.
  fundo: string | null
  numero_contrato: string | null
}

export interface ParseXlsxResult {
  rows: RequisitionRow[]
  warnings: string[]
}

// Maps a normalized header label to the field name we care about.
// Listing variants keeps the importer tolerant to small label tweaks
// (case, accents, with/without colon).
const HEADER_ALIASES: Record<string, keyof RequisitionRow> = {
  requisicao: 'requisicao_codigo',
  requisição: 'requisicao_codigo',
  codigo: 'requisicao_codigo',
  codigorequisicao: 'requisicao_codigo',

  fornecedor: 'fornecedor',
  favorecido: 'favorecido',

  cpfcnpj: 'cpf_cnpj',
  cnpj: 'cpf_cnpj',
  cpf: 'cpf_cnpj',

  conta: 'conta',
  contabancaria: 'conta',
  dadosbancarios: 'conta',

  valor: 'valor',

  descricao: 'descricao',
  descricaorequisicao: 'descricao',
  titulo: 'descricao',
  historico: 'descricao',
  observacao: 'descricao',

  dataevento: 'data_evento',
  datadoevento: 'data_evento',

  modulo: 'modulo',
  modulocronograma: 'modulo',

  valortotalcontrato: 'valor_total_contrato',
  valordocontrato: 'valor_total_contrato',
  valorcontrato: 'valor_total_contrato',

  historicorpspagas: 'historico_rps_pagas',
  rpspagas: 'historico_rps_pagas',
  totalpago: 'historico_rps_pagas',
  japago: 'historico_rps_pagas',

  datapagamentoprevista: 'data_pagamento_prevista',
  dataprevista: 'data_pagamento_prevista',
  dataprevistapagamento: 'data_pagamento_prevista',
  previsaopagamento: 'data_pagamento_prevista',

  fundo: 'fundo',

  numerocontrato: 'numero_contrato',
  numerodocontrato: 'numero_contrato',
  ncontrato: 'numero_contrato',
  contrato: 'numero_contrato',
  idcontrato: 'numero_contrato',

  linkdocontrato: 'link_contrato',
  link: 'link_contrato',
  url: 'link_contrato',
  linkcontrato: 'link_contrato',
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function cellToString(value: unknown): string | null {
  if (value === null || value === undefined || value === '') return null
  const text = String(value).trim()
  return text || null
}

export function parseRequisitionsXlsx(buffer: ArrayBuffer): ParseXlsxResult {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) {
    throw new Error('Planilha sem abas.')
  }
  const sheet = workbook.Sheets[sheetName]

  const data = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  })

  if (data.length === 0) {
    throw new Error('Planilha vazia.')
  }

  // Locate the header row: first row with at least 3 recognized columns
  // (some Mundo Viva exports have a title row above the headers).
  let headerRowIdx = -1
  let columnMap: Map<number, keyof RequisitionRow> = new Map()

  for (let i = 0; i < Math.min(data.length, 10); i += 1) {
    const row = data[i] ?? []
    const candidate = new Map<number, keyof RequisitionRow>()
    const seenFields = new Set<keyof RequisitionRow>()
    for (let c = 0; c < row.length; c += 1) {
      const field = HEADER_ALIASES[normalizeHeader(row[c])]
      if (field && !seenFields.has(field)) {
        candidate.set(c, field)
        seenFields.add(field)
      }
    }
    if (candidate.size >= 3) {
      headerRowIdx = i
      columnMap = candidate
      break
    }
  }

  if (headerRowIdx === -1) {
    throw new Error(
      'Cabeçalho não reconhecido. Esperado: REQUISIÇÃO, Fornecedor, Favorecido, CPF/CNPJ, Conta, valor, Link do Contrato.',
    )
  }

  const required: Array<keyof RequisitionRow> = ['requisicao_codigo', 'link_contrato']
  const found = new Set(columnMap.values())
  const missing = required.filter((r) => !found.has(r))
  if (missing.length > 0) {
    throw new Error(`Colunas obrigatórias ausentes: ${missing.join(', ')}.`)
  }

  const warnings: string[] = []
  const rows: RequisitionRow[] = []
  const seenLinks = new Map<string, number>()

  const columnEntries: Array<[number, keyof RequisitionRow]> = []
  columnMap.forEach((field, col) => columnEntries.push([col, field]))

  for (let i = headerRowIdx + 1; i < data.length; i += 1) {
    const raw = data[i] ?? []
    const result: Partial<RequisitionRow> = {}

    for (const [col, field] of columnEntries) {
      const cell = raw[col]
      const isEmpty = cell == null || cell === ''
      if (field === 'valor' || field === 'valor_total_contrato' || field === 'historico_rps_pagas') {
        result[field] = isEmpty ? null : parseValor(cell)
      } else if (field === 'modulo') {
        const n = isEmpty ? NaN : parseInt(String(cell).replace(/\D/g, ''), 10)
        result.modulo = Number.isFinite(n) ? n : null
      } else {
        const stringValue = cellToString(cell)
        if (field === 'requisicao_codigo') result.requisicao_codigo = stringValue ?? ''
        else if (field === 'link_contrato') result.link_contrato = stringValue ?? ''
        else if (field === 'fornecedor') result.fornecedor = stringValue
        else if (field === 'favorecido') result.favorecido = stringValue
        else if (field === 'cpf_cnpj') result.cpf_cnpj = stringValue
        else if (field === 'conta') result.conta = stringValue
        else if (field === 'descricao') result.descricao = stringValue
        else if (field === 'data_evento') result.data_evento = stringValue
        else if (field === 'data_pagamento_prevista') result.data_pagamento_prevista = stringValue
        else if (field === 'fundo') result.fundo = stringValue
        else if (field === 'numero_contrato') result.numero_contrato = stringValue
      }
    }

    const codigo = result.requisicao_codigo
    const link = result.link_contrato
    if (!codigo || !link) {
      if (codigo || link) {
        warnings.push(`Linha ${i + 1} ignorada: requisição ou link ausente.`)
      }
      continue
    }

    const dedupKey = `${codigo}|${link}`
    if (seenLinks.has(dedupKey)) {
      warnings.push(
        `Linha ${i + 1} duplicada (requisição "${codigo}" + link já presente na linha ${seenLinks.get(dedupKey)}).`,
      )
      continue
    }
    seenLinks.set(dedupKey, i + 1)

    rows.push({
      requisicao_codigo: codigo,
      fornecedor: result.fornecedor ?? null,
      favorecido: result.favorecido ?? null,
      cpf_cnpj: result.cpf_cnpj ?? null,
      conta: result.conta ?? null,
      valor: result.valor ?? null,
      link_contrato: link,
      descricao: result.descricao ?? null,
      data_evento: result.data_evento ?? null,
      modulo: result.modulo ?? null,
      valor_total_contrato: result.valor_total_contrato ?? null,
      historico_rps_pagas: result.historico_rps_pagas ?? null,
      data_pagamento_prevista: result.data_pagamento_prevista ?? null,
      fundo: result.fundo ?? null,
      numero_contrato: result.numero_contrato ?? null,
    })
  }

  if (rows.length === 0) {
    throw new Error('Nenhuma linha válida encontrada após o cabeçalho.')
  }

  return { rows, warnings }
}
