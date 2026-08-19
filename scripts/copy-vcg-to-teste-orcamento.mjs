/**
 * Replica o ambiente da Viva Campo Grande na empresa "Teste Módulo Orçamento":
 * plano de contas DRE, mapeamento de categorias (DRE e Fluxo de Caixa) e os
 * lançamentos vindos da Omie.
 *
 * A empresa de teste não tem credencial da Omie e serve só para exercitar o
 * módulo Orçamento em construção — em especial o método "Média com correção de
 * índices", que precisa do realizado do ano-base para calcular a média.
 *
 * A origem é SOMENTE LEITURA: todo insert/update/delete é filtrado pela empresa
 * destino (ver `guard`). Rodar de novo é seguro — o plano e os lançamentos são
 * recriados do zero no destino.
 *
 * Uso: node scripts/copy-vcg-to-teste-orcamento.mjs [--execute]
 *      (sem --execute é dry-run: só mostra o que faria)
 */
import { createClient } from '@supabase/supabase-js'
import fs from 'fs'

const NEWLINE = /\r?\n/
const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(NEWLINE)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
})

const SRC = '58d6c2e2-accb-4ca7-aca4-4163a9d1059e' // Viva Campo Grande (somente leitura)
const DST = '30718b5c-0d79-4ee2-ac76-19b5f44d56c7' // Teste Módulo Orçamento
const EXECUTE = process.argv.includes('--execute')

const log = (...a) => console.log(EXECUTE ? '[exec]' : '[dry ]', ...a)

/** Rede de proteção: nenhuma escrita pode escapar para fora da empresa de teste. */
function guard(companyId) {
  if (companyId !== DST) throw new Error(`ESCRITA BLOQUEADA: company_id ${companyId} != destino`)
}

/** Lê todas as linhas de uma tabela furando o teto de 1000 do PostgREST. */
async function readAll(table, select, apply) {
  const out = []
  const PAGE = 500
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(select).order('id').range(from, from + PAGE - 1)
    q = apply(q)
    const { data, error } = await q
    if (error) throw new Error(`${table}: ${error.message}`)
    out.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  return out
}

async function insertBatched(table, rows, batchSize = 200) {
  for (const r of rows) guard(r.company_id)
  if (!EXECUTE) return rows.length
  let done = 0
  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize)
    const { error } = await sb.from(table).insert(chunk)
    if (error) throw new Error(`${table} insert @${i}: ${error.message}`)
    done += chunk.length
    if (done % 1500 === 0 || done === rows.length) log(`  ${table}: ${done}/${rows.length}`)
  }
  return done
}

// --- 1) Plano de contas DRE --------------------------------------------------
async function copyPlan() {
  const source = await readAll(
    'dre_accounts',
    'id,code,name,parent_id,level,type,is_summary,formula,sort_order,active,data_source',
    (q) => q.eq('company_id', SRC),
  )
  log(`plano origem: ${source.length} contas`)

  const existing = await readAll('dre_accounts', 'id', (q) => q.eq('company_id', DST))
  if (existing.length > 0) {
    log(`destino já tem ${existing.length} contas — apagando antes de recriar`)
    if (EXECUTE) {
      const { error } = await sb.from('dre_accounts').delete().eq('company_id', DST)
      if (error) throw new Error(`limpeza do plano destino: ${error.message}`)
    }
  }

  // Duas passadas: insere tudo com parent_id nulo e depois refaz a hierarquia
  // pelos CÓDIGOS (os ids novos só existem depois do insert).
  const rows = source.map((a) => ({
    code: a.code,
    name: a.name,
    parent_id: null,
    type: a.type,
    is_summary: a.is_summary,
    formula: a.formula,
    sort_order: a.sort_order,
    active: a.active,
    data_source: a.data_source,
    company_id: DST,
    level: a.code.split('.').length,
  }))
  if (!EXECUTE) {
    log(`inseriria ${rows.length} contas + hierarquia`)
    return new Map()
  }
  await insertBatched('dre_accounts', rows)

  const inserted = await readAll('dre_accounts', 'id,code', (q) => q.eq('company_id', DST))
  const newIdByCode = new Map(inserted.map((r) => [r.code, r.id]))
  const codeByOldId = new Map(source.map((a) => [a.id, a.code]))

  let hier = 0
  for (const a of source) {
    if (!a.parent_id) continue
    const parentCode = codeByOldId.get(a.parent_id)
    const childId = newIdByCode.get(a.code)
    const parentId = parentCode ? newIdByCode.get(parentCode) : null
    if (!childId || !parentId) continue
    const { error } = await sb
      .from('dre_accounts')
      .update({ parent_id: parentId })
      .eq('id', childId)
      .eq('company_id', DST)
    if (error) throw new Error(`hierarquia ${a.code}: ${error.message}`)
    hier++
  }
  log(`plano copiado: ${rows.length} contas, ${hier} vínculos pai/filho`)
  return newIdByCode
}

// --- 2) Mapeamento de categorias -> contas do plano NOVO ---------------------
// A empresa de teste já tinha mapeamentos apontando para contas da VCG/globais
// (não havia plano próprio). Com plano próprio, todo mapeamento tem de apontar
// para a conta de MESMO CÓDIGO dentro do plano do destino.
async function fixMappings(newIdByCode) {
  const dstMaps = await readAll(
    'category_mapping',
    'id,omie_category_code,omie_category_name,dre_account_id',
    (q) => q.eq('company_id', DST),
  )
  const srcMaps = await readAll(
    'category_mapping',
    'omie_category_code,omie_category_name,dre_account_id',
    (q) => q.eq('company_id', SRC),
  )
  const allAccounts = await readAll('dre_accounts', 'id,code,company_id', (q) => q)
  const codeById = new Map(allAccounts.map((a) => [a.id, a.code]))

  log(`mapeamentos: destino ${dstMaps.length}, origem ${srcMaps.length}`)

  // 2a) Categorias que existem na origem e faltam no destino.
  const dstCodes = new Set(dstMaps.map((m) => m.omie_category_code))
  const faltantes = srcMaps.filter((m) => !dstCodes.has(m.omie_category_code))
  const novos = faltantes.map((m) => ({
    omie_category_code: m.omie_category_code,
    omie_category_name: m.omie_category_name,
    dre_account_id: EXECUTE ? (newIdByCode.get(codeById.get(m.dre_account_id)) ?? null) : null,
    company_id: DST,
  }))
  log(`mapeamentos a criar no destino: ${novos.length}`)
  await insertBatched('category_mapping', novos)

  // 2b) Repontar os mapeamentos existentes para as contas do plano do destino.
  if (!EXECUTE) {
    log(`repontaria ${dstMaps.length} mapeamentos para as contas novas`)
    return
  }
  let fixed = 0
  const orphan = []
  for (const m of dstMaps) {
    const code = codeById.get(m.dre_account_id)
    const newId = code ? newIdByCode.get(code) : null
    if (!newId) {
      orphan.push(m.omie_category_code)
      continue
    }
    if (newId === m.dre_account_id) continue
    const { error } = await sb
      .from('category_mapping')
      .update({ dre_account_id: newId })
      .eq('id', m.id)
      .eq('company_id', DST)
    if (error) throw new Error(`repontar ${m.omie_category_code}: ${error.message}`)
    fixed++
  }
  log(
    `mapeamentos repontados: ${fixed}` +
      (orphan.length ? ` — sem conta correspondente: ${orphan.join(', ')}` : ''),
  )
}

// --- 3) Mapeamento do Fluxo de Caixa (contas são globais, o id não muda) -----
async function copyCashFlowMappings() {
  const src = await readAll(
    'cash_flow_category_mappings',
    'omie_category_code,omie_category_name,cash_flow_account_id',
    (q) => q.eq('company_id', SRC),
  )
  const dst = await readAll('cash_flow_category_mappings', 'omie_category_code', (q) =>
    q.eq('company_id', DST),
  )
  const have = new Set(dst.map((m) => m.omie_category_code))
  const rows = src
    .filter((m) => !have.has(m.omie_category_code))
    .map((m) => ({ ...m, company_id: DST }))
  log(`fluxo de caixa: ${rows.length} mapeamentos a copiar`)
  await insertBatched('cash_flow_category_mappings', rows)
}

// --- 4) Lançamentos da Omie --------------------------------------------------
async function copyEntries() {
  const existing = await sb
    .from('financial_entries')
    .select('*', { count: 'exact', head: true })
    .eq('company_id', DST)
  if ((existing.count ?? 0) > 0) {
    log(`destino já tem ${existing.count} lançamentos — apagando antes de recopiar`)
    if (EXECUTE) {
      const { error } = await sb.from('financial_entries').delete().eq('company_id', DST)
      if (error) throw new Error(`limpeza dos lançamentos: ${error.message}`)
    }
  }
  const cols =
    'omie_id,type,description,value,payment_date,category_code,category_name,supplier_customer,document_number,raw_json,ano_pgto,mes_pagamento,processing_metadata,department_code,project_code,project_name'
  const source = await readAll('financial_entries', `id,${cols}`, (q) => q.eq('company_id', SRC))
  log(`lançamentos origem: ${source.length}`)
  const rows = source.map(({ id, ...rest }) => ({ ...rest, company_id: DST }))
  await insertBatched('financial_entries', rows, 150)
  log(`lançamentos copiados: ${rows.length}`)
}

// --- 5) Agregados ------------------------------------------------------------
// Escopados só ao destino: recalcular a VCG seria inócuo, mas melhor não tocar.
async function refreshAggregates() {
  if (!EXECUTE) {
    log('recalcularia dre_monthly_aggregates e cash_flow_monthly_aggregates do destino')
    return
  }
  for (const fn of ['refresh_dre_monthly_aggregates', 'refresh_cash_flow_monthly_aggregates']) {
    const { error } = await sb.rpc(fn, { p_company_ids: [DST] })
    log(`${fn}: ${error ? 'ERRO ' + error.message : 'ok'}`)
  }
}

const newIdByCode = await copyPlan()
await fixMappings(newIdByCode)
await copyCashFlowMappings()
await copyEntries()
await refreshAggregates()
log('fim')
