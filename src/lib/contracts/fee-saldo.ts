// Saldo FEE por fundo — planilha "BACKEND FLUXO PROJETADO FRANQUIAS", aba
// "CONTROLE FEE QUOKKA (IMPORT)". Coluna C = nome do fundo, coluna I =
// "Valor a receber": quanto o fundo ainda tem disponível para receber de FEE.
// Regra (decisão 2026-08-13): RP de FEE/Cerimonial é aprovada se o valor
// couber no saldo do fundo e reprovada se estourar; qualquer situação em que
// o saldo não possa ser determinado cai em análise especialista — o fallback
// nunca aprova nem reprova às cegas.

import { fetchSheetTabTitleByGid, fetchSheetValues } from '@/lib/sheets/client'

const FEE_SALDO_SPREADSHEET_ID = '1ymgmW6ISadb8xKBpcNDXTnGr0buoOFVszSZmxaOxKBQ'
// As abas são resolvidas pelo gid (estável a renomeação). A aba "FUNDOS
// INATIVOS (IMPORT)" fica de fora de propósito: fundo inativo não deve
// aprovar pagamento automaticamente.
const FEE_SALDO_GID = 1986082110

// Índices 0-based na aba de importação: A=Unidade, C=Nome do Fundo,
// I=Valor a receber.
const COL_UNIDADE = 0
const COL_NOME = 2
const COL_SALDO = 8

// Fallback: fundos recentes demoram a entrar na aba de importação (casos
// reais: 9578/9619, RPs 872197/872136 caíam em "não encontrado"). A aba
// carteira_realizado tem todos os fundos e a coluna O ("VALOR RESTANTE DE
// FEE") faz a mesma conta da coluna I da importação (FEE − pago), então ela
// cobre quem ainda não foi importado. A importação continua sendo a fonte
// primária — o fallback nunca sobrepõe um fundo que está lá.
const CARTEIRA_GID = 429827027
// carteira_realizado: A=FRANQUIA, C=FUNDO, O=VALOR RESTANTE DE FEE.
const CART_COL_UNIDADE = 0
const CART_COL_NOME = 2
const CART_COL_SALDO = 14

// Mesma tolerância de centavos usada na validação de valores (validate.ts).
const SALDO_TOLERANCE = 0.02

export interface FeeSaldoEntry {
  /** Nome do fundo como está na planilha (para exibição/auditoria). */
  nome: string
  unidade: string
  /** Valor disponível de FEE. Pode ser negativo. */
  saldo: number
  /** De qual aba veio o saldo (para o motivo ficar auditável). */
  fonte: 'importacao' | 'carteira'
}

export interface FeeSaldoMap {
  byKey: Map<string, FeeSaldoEntry>
  /** Chaves que aparecem em mais de uma linha com saldos divergentes. */
  conflitos: Set<string>
  /** Fundos presentes na planilha mas com a coluna I vazia/não numérica. */
  semSaldo: Set<string>
  totalLinhas: number
}

// Os nomes de fundo não têm grafia estável entre a base de RPs e a planilha
// ("ISABELI.CAMPIDELI PUC-PSICO 2029-2" vs "ISABELI-CAMPIDELI-PUC-PSICO-2029-2"),
// então a chave descarta tudo que não é letra ou número.
export function normFundo(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

function parseSaldo(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'string' && cell.trim() !== '') {
    const n = Number(cell.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

interface ParsedTab {
  byKey: Map<string, FeeSaldoEntry>
  conflitos: Set<string>
  semSaldo: Set<string>
  totalLinhas: number
}

function parseTab(
  rows: Awaited<ReturnType<typeof fetchSheetValues>>,
  cols: { nome: number; unidade: number; saldo: number },
  fonte: FeeSaldoEntry['fonte'],
): ParsedTab {
  const byKey = new Map<string, FeeSaldoEntry>()
  const conflitos = new Set<string>()
  const semSaldo = new Set<string>()
  for (const row of rows) {
    const nome = String(row[cols.nome] ?? '').trim()
    if (!nome) continue
    const key = normFundo(nome)
    if (!key) continue
    const saldo = parseSaldo(row[cols.saldo])
    if (saldo === null) {
      // Fundo listado mas sem valor — acontece na planilha real (célula em
      // branco). Distinguir de "não encontrado" na mensagem.
      if (!byKey.has(key)) semSaldo.add(key)
      continue
    }
    const existente = byKey.get(key)
    if (existente && Math.abs(existente.saldo - saldo) > SALDO_TOLERANCE) {
      // Linhas duplicadas com saldos diferentes: não dá para saber qual vale.
      conflitos.add(key)
      continue
    }
    byKey.set(key, {
      nome,
      unidade: String(row[cols.unidade] ?? '').trim(),
      saldo,
      fonte,
    })
    semSaldo.delete(key)
  }
  return { byKey, conflitos, semSaldo, totalLinhas: rows.length }
}

/** Lê as duas abas e monta o mapa fundo → saldo. Lança erro se inacessível. */
export async function loadFeeSaldo(): Promise<FeeSaldoMap> {
  const [tabImport, tabCarteira] = await Promise.all([
    fetchSheetTabTitleByGid(FEE_SALDO_SPREADSHEET_ID, FEE_SALDO_GID),
    fetchSheetTabTitleByGid(FEE_SALDO_SPREADSHEET_ID, CARTEIRA_GID),
  ])
  const [rowsImport, rowsCarteira] = await Promise.all([
    fetchSheetValues(FEE_SALDO_SPREADSHEET_ID, `'${tabImport.replace(/'/g, "''")}'!A2:I`),
    fetchSheetValues(FEE_SALDO_SPREADSHEET_ID, `'${tabCarteira.replace(/'/g, "''")}'!A2:O`),
  ])

  const primaria = parseTab(rowsImport, { nome: COL_NOME, unidade: COL_UNIDADE, saldo: COL_SALDO }, 'importacao')
  const carteira = parseTab(
    rowsCarteira,
    { nome: CART_COL_NOME, unidade: CART_COL_UNIDADE, saldo: CART_COL_SALDO },
    'carteira',
  )

  // Merge: a importação manda; a carteira só entra onde a importação não
  // conhece o fundo (nem como conflito).
  const byKey = primaria.byKey
  const conflitos = primaria.conflitos
  const semSaldo = new Set(primaria.semSaldo)
  carteira.byKey.forEach((entry, key) => {
    if (byKey.has(key) || conflitos.has(key)) return
    if (carteira.conflitos.has(key)) return
    byKey.set(key, entry)
    semSaldo.delete(key)
  })
  carteira.conflitos.forEach((key) => {
    if (!byKey.has(key) && !conflitos.has(key)) conflitos.add(key)
  })
  carteira.semSaldo.forEach((key) => {
    if (!byKey.has(key) && !conflitos.has(key)) semSaldo.add(key)
  })

  return { byKey, conflitos, semSaldo, totalLinhas: primaria.totalLinhas + carteira.totalLinhas }
}

export interface FeeDecisao {
  status: 'aprovada' | 'reprovada' | 'analise_especialista'
  resumo: string
  motivos: string[]
}

const fmt = (n: number) => `R$ ${n.toFixed(2)}`

/**
 * Decide uma RP de FEE/Cerimonial pelo saldo do fundo. Pura (sem I/O) para
 * ser testável; `saldoMap` nulo indica que a planilha não pôde ser lida.
 */
export function decidirPorSaldoFee(
  fundo: string | null | undefined,
  valorRp: number | string | null | undefined,
  saldoMap: FeeSaldoMap | null,
  loadError: string | null,
): FeeDecisao {
  const especialista = (motivo: string): FeeDecisao => ({
    status: 'analise_especialista',
    resumo: `FEE/Cerimonial — análise especialista (${motivo})`,
    motivos: [motivo],
  })

  if (!saldoMap) {
    return especialista(
      `planilha de saldo FEE inacessível${loadError ? `: ${loadError.slice(0, 200)}` : ''}`,
    )
  }

  const valor = valorRp === null || valorRp === undefined ? NaN : Number(valorRp)
  if (!Number.isFinite(valor)) {
    return especialista('valor da RP ausente ou ilegível — não foi possível comparar com o saldo FEE')
  }

  const key = normFundo(fundo)
  if (!key) {
    return especialista('RP sem fundo informado — não foi possível localizar o saldo FEE')
  }
  if (saldoMap.conflitos.has(key)) {
    return especialista(
      `fundo "${String(fundo).trim()}" aparece mais de uma vez na planilha de saldo FEE com valores divergentes`,
    )
  }
  const entry = saldoMap.byKey.get(key)
  if (!entry) {
    if (saldoMap.semSaldo.has(key)) {
      return especialista(
        `fundo "${String(fundo).trim()}" está na planilha de saldo FEE, mas sem valor na coluna de saldo`,
      )
    }
    return especialista(
      `fundo "${String(fundo).trim()}" não encontrado na planilha de saldo FEE (abas de importação e carteira)`,
    )
  }

  const fonteTxt = entry.fonte === 'carteira' ? ', aba carteira_realizado' : ''
  const detalhe = `fundo "${entry.nome}" (${entry.unidade || 'sem unidade'}${fonteTxt}): saldo a receber ${fmt(entry.saldo)}, RP ${fmt(valor)}`
  if (valor <= entry.saldo + SALDO_TOLERANCE) {
    return {
      status: 'aprovada',
      resumo: `Aprovada — FEE/Cerimonial dentro do saldo do fundo (${fmt(entry.saldo)} disponível, RP ${fmt(valor)})`,
      motivos: [`Saldo FEE comporta a requisição: ${detalhe}`],
    }
  }
  return {
    status: 'reprovada',
    resumo: `Reprovada — FEE/Cerimonial acima do saldo do fundo (${fmt(entry.saldo)} disponível, RP ${fmt(valor)})`,
    motivos: [`Valor da RP excede o saldo FEE do fundo: ${detalhe}`],
  }
}
