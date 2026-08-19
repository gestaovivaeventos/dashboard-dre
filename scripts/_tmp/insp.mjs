import { sb } from './lib.mjs'
const { data, error } = await sb.from('companies').select('*').or('name.ilike.%Campo Grande%,name.ilike.%Teste%')
if (error) { console.error(error); process.exit(1) }
console.log(JSON.stringify(data, null, 2))
