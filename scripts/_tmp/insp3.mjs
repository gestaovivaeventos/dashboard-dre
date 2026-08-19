import { sb } from './lib.mjs'
const VCG='58d6c2e2-accb-4ca7-aca4-4163a9d1059e'
const r = await sb.from('category_mappings').select('*',{count:'exact'}).eq('company_id',VCG).limit(2)
console.log('category_mappings:', r.status, r.error?.message, r.count, JSON.stringify(r.data))
