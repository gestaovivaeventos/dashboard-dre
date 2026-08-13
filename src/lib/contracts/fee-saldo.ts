// Saldo FEE por fundo — planilha "BACKEND FLUXO PROJETADO FRANQUIAS", aba
// "CONTROLE FEE QUOKKA (IMPORT)". Coluna C = nome do fundo, coluna I =
// "Valor a receber": quanto o fundo ainda tem disponível para receber de FEE.
// Regra (decisão 2026-08-13): RP de FEE/Cerimonial é aprovada se o valor
// couber no saldo do fundo e reprovada se estourar; qualquer situação em que
// o saldo não possa ser determinado cai em análise especialista — o fallback
// nunca aprova nem reprova às cegas.

import { fetchSheetTabTitleByGid, fetchSheetValues } from '@/lib/sheets/client'

const FEE_SALDO_SPREADSHEET_ID = '1ymgmW6ISadb8xKBpcNDXTnGr0buoOFVszSZmxaOxKBQ'
// A aba é resolvida pelo gid (estável a renomeação) — é o gid do link usado
// pela controladoria. A aba "FUNDOS INATIVOS (IMPORT)" fica de fora de
// propósito: fundo inativo não deve aprovar pagamento automaticamente.
const FEE_SALDO_GID = 1986082110

// Índices 0-based na aba: A=Unidade, C=Nome do Fundo, I=Valor a receber.
const COL_UNIDADE = 0
const COL_NOME = 2
const COL_SALDO = 8

// Mesma tolerância de centavos usada na validação de valores (validate.ts).
const SALDO_TOLERANCE = 0.02

export interface FeeSaldoEntry {
  /** Nome do fundo como está na planilha (para exibição/auditoria). */
  nome: string
  unidade: string
  /** Coluna I ("Valor a receber"). Pode ser negativo. */
  saldo: number
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

/** Lê a planilha e monta o mapa fundo → saldo. Lança erro se inacessível. */
export async function loadFeeSaldo(): Promise<FeeSaldoMap> {
  const tab = await fetchSheetTabTitleByGid(FEE_SALDO_SPREADSHEET_ID, FEE_SALDO_GID)
  const range = `'${tab.replace(/'/g, "''")}'!A2:I`
  const rows = await fetchSheetValues(FEE_SALDO_SPREADSHEET_ID, range)

  const byKey = new Map<string, FeeSaldoEntry>()
  const conflitos = new Set<string>()
  const semSaldo = new Set<string>()
  for (const row of rows) {
    const nome = String(row[COL_NOME] ?? '').trim()
    if (!nome) continue
    const key = normFundo(nome)
    if (!key) continue
    const saldo = parseSaldo(row[COL_SALDO])
    if (saldo === null) {
      // Fundo listado mas sem "Valor a receber" — acontece na planilha real
      // (célula em branco). Distinguir de "não encontrado" na mensagem.
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
      unidade: String(row[COL_UNIDADE] ?? '').trim(),
      saldo,
    })
    semSaldo.delete(key)
  }
  return { byKey, conflitos, semSaldo, totalLinhas: rows.length }
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
        `fundo "${String(fundo).trim()}" está na planilha de saldo FEE, mas sem valor na coluna "Valor a receber"`,
      )
    }
    return especialista(
      `fundo "${String(fundo).trim()}" não encontrado na planilha de saldo FEE`,
    )
  }

  const detalhe = `fundo "${entry.nome}" (${entry.unidade || 'sem unidade'}): saldo a receber ${fmt(entry.saldo)}, RP ${fmt(valor)}`
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
