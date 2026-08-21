// Saldo FEE por fundo — planilha "BACKEND FLUXO PROJETADO FRANQUIAS", aba
// "CONTROLE FEE QUOKKA (IMPORT)". Coluna C = nome do fundo, coluna K =
// "Valor Disponível Para Retirada Conforme Saldo SPDX" (o saque disponível),
// coluna L = data da última atualização da linha.
// Regra (decisão 2026-08-13): RP de FEE/Cerimonial é aprovada se o valor
// couber no saldo do fundo e reprovada se estourar; qualquer situação em que
// o saldo não possa ser determinado cai em análise especialista — o fallback
// nunca aprova nem reprova às cegas.

import { fetchSheetTabTitleByGid, fetchSheetValues, sheetSerialToDate } from '@/lib/sheets/client'

const FEE_SALDO_SPREADSHEET_ID = '1ymgmW6ISadb8xKBpcNDXTnGr0buoOFVszSZmxaOxKBQ'
// As abas são resolvidas pelo gid (estável a renomeação). A aba "FUNDOS
// INATIVOS (IMPORT)" fica de fora de propósito: fundo inativo não deve
// aprovar pagamento automaticamente.
const FEE_SALDO_GID = 1986082110

// Índices 0-based na aba de importação: A=Unidade, C=Nome do Fundo,
// K=Valor Disponível Para Retirada Conforme Saldo SPDX. Decisão 2026-08-14:
// a coluna certa é a K ("saque disponível"), que limita o FEE restante pelo
// caixa real do fundo — a coluna I ("Valor a receber", FEE − pago) ignora o
// caixa e superestimava (caso real: RP 872197 aprovada com FEE restante
// 8.400,12 quando o saque disponível era 2.264,85).
const COL_UNIDADE = 0
const COL_NOME = 2
const COL_SALDO = 10
// L = "Data da última atualização" da linha. Decisão 2026-08-21: sem olhar
// esta coluna, uma linha congelada é indistinguível de uma fresca — e o
// validador reprovava com saldo de meses atrás (caso real: RP 873266, fundo
// BRYAN.FARIAS, planilha em 753,95 desde 17/02 quando o saque real era
// 7.015,33). Dado velho não decide: cai em análise especialista.
const COL_ATUALIZACAO = 11

// Idade máxima aceita para a linha do fundo. Acima disso o saldo é tratado
// como não determinável.
const SALDO_MAX_DIAS = 30

// A carteira_realizado não tem o saldo SPDX, então NÃO serve para decidir —
// ela só distingue a mensagem: fundo que existe lá mas não na importação é
// "falta importar" (acionável pela equipe), não "fundo desconhecido".
const CARTEIRA_GID = 429827027
const CART_COL_NOME = 2

// Mesma tolerância de centavos usada na validação de valores (validate.ts).
const SALDO_TOLERANCE = 0.02

export interface FeeSaldoEntry {
  /** Nome do fundo como está na planilha (para exibição/auditoria). */
  nome: string
  unidade: string
  /** Coluna K: saque disponível conforme saldo SPDX. */
  saldo: number
  /** Coluna L: quando a linha foi atualizada pela última vez. */
  atualizadoEm: Date | null
}

export interface FeeSaldoMap {
  byKey: Map<string, FeeSaldoEntry>
  /** Chaves que aparecem em mais de uma linha com saldos divergentes. */
  conflitos: Set<string>
  /** Fundos presentes na importação mas com a coluna K vazia/não numérica. */
  semSaldo: Set<string>
  /** Fundos que existem na carteira_realizado mas não na importação. */
  naoImportados: Set<string>
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

// A coluna L vem como serial do Sheets (UNFORMATTED_VALUE), mas aceita string
// de data também — a planilha é editada à mão.
function parseAtualizacao(cell: unknown): Date | null {
  if (typeof cell === 'number' && Number.isFinite(cell) && cell > 0) {
    const d = sheetSerialToDate(cell)
    return Number.isNaN(d.getTime()) ? null : d
  }
  if (typeof cell === 'string' && cell.trim()) {
    const m = cell.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/)
    if (m) {
      let ano = Number(m[3])
      if (ano < 100) ano += 2000
      const d = new Date(Date.UTC(ano, Number(m[2]) - 1, Number(m[1])))
      return Number.isNaN(d.getTime()) ? null : d
    }
    const d = new Date(cell.trim())
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export function diasDesde(data: Date, hoje: Date): number {
  return Math.floor((hoje.getTime() - data.getTime()) / 86400000)
}

function parseSaldo(cell: unknown): number | null {
  if (typeof cell === 'number') return Number.isFinite(cell) ? cell : null
  if (typeof cell === 'string' && cell.trim() !== '') {
    const n = Number(cell.replace(/\./g, '').replace(',', '.'))
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Lê as duas abas e monta o mapa fundo → saque disponível. */
export async function loadFeeSaldo(): Promise<FeeSaldoMap> {
  const [tabImport, tabCarteira] = await Promise.all([
    fetchSheetTabTitleByGid(FEE_SALDO_SPREADSHEET_ID, FEE_SALDO_GID),
    fetchSheetTabTitleByGid(FEE_SALDO_SPREADSHEET_ID, CARTEIRA_GID),
  ])
  const [rowsImport, rowsCarteira] = await Promise.all([
    fetchSheetValues(FEE_SALDO_SPREADSHEET_ID, `'${tabImport.replace(/'/g, "''")}'!A2:L`),
    fetchSheetValues(FEE_SALDO_SPREADSHEET_ID, `'${tabCarteira.replace(/'/g, "''")}'!A2:C`),
  ])

  const byKey = new Map<string, FeeSaldoEntry>()
  const conflitos = new Set<string>()
  const semSaldo = new Set<string>()
  for (const row of rowsImport) {
    const nome = String(row[COL_NOME] ?? '').trim()
    if (!nome) continue
    const key = normFundo(nome)
    if (!key) continue
    const saldo = parseSaldo(row[COL_SALDO])
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
      unidade: String(row[COL_UNIDADE] ?? '').trim(),
      saldo,
      atualizadoEm: parseAtualizacao(row[COL_ATUALIZACAO]),
    })
    semSaldo.delete(key)
  }

  const naoImportados = new Set<string>()
  for (const row of rowsCarteira) {
    const key = normFundo(String(row[CART_COL_NOME] ?? ''))
    if (!key || byKey.has(key) || conflitos.has(key) || semSaldo.has(key)) continue
    naoImportados.add(key)
  }

  return { byKey, conflitos, semSaldo, naoImportados, totalLinhas: rowsImport.length }
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
  hoje: Date = new Date(),
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
        `fundo "${String(fundo).trim()}" está na aba de importação, mas sem valor na coluna de saque disponível`,
      )
    }
    if (saldoMap.naoImportados.has(key)) {
      return especialista(
        `fundo "${String(fundo).trim()}" ainda não foi importado para a aba CONTROLE FEE QUOKKA (IMPORT) — sem saque disponível na planilha; pedir a importação do fundo`,
      )
    }
    return especialista(
      `fundo "${String(fundo).trim()}" não encontrado na planilha de saldo FEE`,
    )
  }

  // Frescor da linha. Saldo é um número que muda toda semana; decidir com uma
  // foto de meses atrás é pior do que não decidir, porque parece confiável.
  if (!entry.atualizadoEm) {
    return especialista(
      `fundo "${entry.nome}" sem data de última atualização na planilha de saldo FEE — não é possível saber se o saque disponível está vigente`,
    )
  }
  const idade = diasDesde(entry.atualizadoEm, hoje)
  if (idade > SALDO_MAX_DIAS) {
    const quando = entry.atualizadoEm.toISOString().slice(0, 10).split('-').reverse().join('/')
    return especialista(
      `saque disponível do fundo "${entry.nome}" desatualizado: última atualização em ${quando} (${idade} dias atrás, limite ${SALDO_MAX_DIAS}) — pedir a reimportação da planilha antes de decidir`,
    )
  }

  const detalhe = `fundo "${entry.nome}" (${entry.unidade || 'sem unidade'}): saque disponível ${fmt(entry.saldo)}, RP ${fmt(valor)}, atualizado em ${entry.atualizadoEm.toISOString().slice(0, 10).split('-').reverse().join('/')}`
  if (valor <= entry.saldo + SALDO_TOLERANCE) {
    return {
      status: 'aprovada',
      resumo: `Aprovada — FEE/Cerimonial dentro do saque disponível do fundo (${fmt(entry.saldo)} disponível, RP ${fmt(valor)})`,
      motivos: [`Saque disponível comporta a requisição: ${detalhe}`],
    }
  }
  return {
    status: 'reprovada',
    resumo: `Reprovada — FEE/Cerimonial acima do saque disponível do fundo (${fmt(entry.saldo)} disponível, RP ${fmt(valor)})`,
    motivos: [`Valor da RP excede o saque disponível do fundo: ${detalhe}`],
  }
}
