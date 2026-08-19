import { sb } from './lib.mjs'
const VCG='58d6c2e2-accb-4ca7-aca4-4163a9d1059e', T='30718b5c-0d79-4ee2-ac76-19b5f44d56c7'
async function one(table, col, id, label){
  const { count, error } = await sb.from(table).select('*',{count:'exact',head:true}).eq(col,id)
  console.log(`${table} [${label}] =`, error? 'ERR '+error.message : count)
}
for (const t of ['dre_accounts','category_mappings','financial_entries','cash_flow_accounts','cash_flow_category_mappings','dre_monthly_aggregates','cash_flow_monthly_aggregates']) {
  await one(t,'company_id',VCG,'VCG'); await one(t,'company_id',T,'TESTE')
}
// sample rows
const { data: acc } = await sb.from('dre_accounts').select('*').eq('company_id',VCG).limit(2)
console.log('dre_accounts sample:', JSON.stringify(acc,null,2))
const { data: cm } = await sb.from('category_mappings').select('*').eq('company_id',VCG).limit(2)
console.log('category_mappings sample:', JSON.stringify(cm,null,2))
const { data: fe } = await sb.from('financial_entries').select('*').eq('company_id',VCG).limit(2)
console.log('financial_entries sample:', JSON.stringify(fe,null,2))
