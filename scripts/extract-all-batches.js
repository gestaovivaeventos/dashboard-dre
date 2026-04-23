const fs = require('fs');

const BASE_DIR = 'C:\\Users\\Marcelo\\.claude\\projects\\c--Users-Marcelo-PROGRAMAS-dashboard-dre\\2045f17e-eec1-4afb-bdba-d86632ffb238\\tool-results\\';
const SCRIPTS_DIR = 'C:\\Users\\Marcelo\\PROGRAMAS\\dashboard-dre\\scripts\\';

const INSERT_PREFIX = `INSERT INTO ctrl_suppliers (id, omie_id, name, cnpj_cpf, email, phone, status, from_omie, created_by, approved_by, approved_at, created_at, updated_at, chave_pix, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao) VALUES\n`;
const INSERT_SUFFIX = '\nON CONFLICT (id) DO NOTHING;';

function extractVals(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  const outer = JSON.parse(raw);
  const text = outer[0].text;
  const inner = JSON.parse(text);
  const result = inner.result;
  const match = result.match(/<untrusted-data[^>]+>\n(\[[\s\S]*?\])\n<\/untrusted-data/);
  if (!match) return null;
  const dataArr = JSON.parse(match[1]);
  return dataArr[0].vals;
}

const batches = [
  { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711622345.txt', out: 'suppliers_batch1.sql' },
  { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711629293.txt', out: 'suppliers_batch2.sql' },
  { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711784899.txt', out: 'suppliers_batch3.sql' },
  { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711791009.txt', out: 'suppliers_batch4.sql' },
  { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711812368.txt', out: 'suppliers_batch5.sql' },
];

for (const batch of batches) {
  const outPath = SCRIPTS_DIR + batch.out;
  if (fs.existsSync(outPath)) {
    console.log(`${batch.out} already exists (${fs.statSync(outPath).size} bytes), skipping`);
    continue;
  }
  try {
    const vals = extractVals(batch.file);
    if (!vals) { console.log(`No vals in ${batch.out}`); continue; }
    const sql = INSERT_PREFIX + vals + INSERT_SUFFIX;
    fs.writeFileSync(outPath, sql, 'utf8');
    console.log(`Written ${batch.out}: ${sql.length} chars`);
  } catch (e) {
    console.error(`Error on ${batch.out}:`, e.message);
  }
}
console.log('Done');
