const fs = require('fs');
const https = require('https');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsb3BoaWt2Z3Rxb2V4cXd4eGlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQyODk2MSwiZXhwIjoyMDg5MDA0OTYxfQ.dBhritV67TbNCSb9kdVdPzafhsvPpfMpwuymFHmrLPk';
const BASE_DIR = 'C:\\Users\\Marcelo\\.claude\\projects\\c--Users-Marcelo-PROGRAMAS-dashboard-dre\\2045f17e-eec1-4afb-bdba-d86632ffb238\\tool-results\\';

function extractVals(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  // Parse outer JSON array
  const outer = JSON.parse(raw);
  const text = outer[0].text;
  // Parse inner JSON (result field)
  const inner = JSON.parse(text);
  const result = inner.result;
  // Extract JSON array from between untrusted-data tags
  const match = result.match(/<untrusted-data[^>]+>\n(\[[\s\S]*?\])\n<\/untrusted-data/);
  if (!match) {
    console.log('No match found in result');
    return null;
  }
  const dataArr = JSON.parse(match[1]);
  return dataArr[0].vals;
}

async function executeSQLDirect(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const options = {
      hostname: 'hlophikvgtqoexqwxxis.supabase.co',
      port: 443,
      path: '/rest/v1/rpc/execute_sql',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': SERVICE_KEY,
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Apply SQL using Supabase SQL editor API
async function applySQL(sql, label) {
  // Write to file for manual application if needed
  const outFile = `C:\\Users\\Marcelo\\PROGRAMAS\\dashboard-dre\\scripts\\${label}.sql`;
  fs.writeFileSync(outFile, sql, 'utf8');
  console.log(`[${label}] Written ${sql.length} chars to ${outFile}`);
  return outFile;
}

async function main() {
  const INSERT_PREFIX = `INSERT INTO ctrl_suppliers (id, omie_id, name, cnpj_cpf, email, phone, status, from_omie, created_by, approved_by, approved_at, created_at, updated_at, chave_pix, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao) VALUES\n`;

  const batches = [
    { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711622345.txt', label: 'suppliers_batch1' },
    { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711629293.txt', label: 'suppliers_batch2' },
  ];

  for (const batch of batches) {
    console.log(`\nExtracting ${batch.label}...`);
    try {
      const vals = extractVals(batch.file);
      if (!vals) { console.log('No vals found'); continue; }
      console.log(`Extracted ${vals.length} chars`);
      const sql = INSERT_PREFIX + vals + '\nON CONFLICT (id) DO NOTHING;';
      await applySQL(sql, batch.label);
    } catch (e) {
      console.error('Error:', e.message);
    }
  }
}

main().catch(console.error);
