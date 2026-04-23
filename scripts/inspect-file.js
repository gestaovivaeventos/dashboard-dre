const fs = require('fs');
const f = 'C:\\Users\\Marcelo\\.claude\\projects\\c--Users-Marcelo-PROGRAMAS-dashboard-dre\\2045f17e-eec1-4afb-bdba-d86632ffb238\\tool-results\\mcp-plugin_supabase_supabase-execute_sql-1776711622345.txt';
const raw = fs.readFileSync(f, 'utf8');
console.log('File length:', raw.length);
console.log('First 500:', raw.substring(0, 500));
console.log('---');
// Find vals
const idx = raw.indexOf('vals');
console.log('vals index:', idx);
if (idx !== -1) console.log('Around vals:', raw.substring(idx - 5, idx + 200));
