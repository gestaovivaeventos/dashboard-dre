const fs = require('fs');
const https = require('https');

const DEST_URL = 'https://hlophikvgtqoexqwxxis.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsb3BoaWt2Z3Rxb2V4cXd4eGlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQyODk2MSwiZXhwIjoyMDg5MDA0OTYxfQ.dBhritV67TbNCSb9kdVdPzafhsvPpfMpwuymFHmrLPk';

const BASE_DIR = 'C:\\Users\\Marcelo\\.claude\\projects\\c--Users-Marcelo-PROGRAMAS-dashboard-dre\\2045f17e-eec1-4afb-bdba-d86632ffb238\\tool-results\\';

function extractVals(filepath) {
  const raw = fs.readFileSync(filepath, 'utf8');
  // Find the vals field in the JSON structure
  const idx = raw.indexOf('"vals":"');
  if (idx === -1) return null;
  const start = idx + 8;
  // Find the closing quote (not escaped)
  let end = start;
  while (end < raw.length) {
    if (raw[end] === '"' && raw[end - 1] !== '\\') break;
    end++;
  }
  let vals = raw.substring(start, end);
  // Unescape: \\n -> newline, \\\\ -> \\, \\' -> '
  vals = vals.replace(/\\n/g, '\n');
  vals = vals.replace(/\\'/g, "'");
  return vals;
}

function executeSQL(sql) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const url = new URL('/rest/v1/rpc/execute_sql', DEST_URL);
    // Use the pg REST endpoint instead
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

async function main() {
  const files = [
    BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711622345.txt',
    BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711629293.txt',
  ];

  const INSERT_PREFIX = `INSERT INTO ctrl_suppliers (id, omie_id, name, cnpj_cpf, email, phone, status, from_omie, created_by, approved_by, approved_at, created_at, updated_at, chave_pix, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao) VALUES\n`;

  for (let i = 0; i < files.length; i++) {
    console.log(`\nProcessing batch ${i + 1}...`);
    const vals = extractVals(files[i]);
    if (!vals) {
      console.log('Could not extract vals from', files[i]);
      continue;
    }
    console.log('Vals length:', vals.length);
    console.log('Sample:', vals.substring(0, 150));

    const sql = INSERT_PREFIX + vals + '\nON CONFLICT (id) DO NOTHING;';

    // Write to temp file for inspection
    fs.writeFileSync(`c:\\Users\\Marcelo\\PROGRAMAS\\dashboard-dre\\scripts\\batch${i+1}.sql`, sql, 'utf8');
    console.log(`Written to batch${i+1}.sql (${sql.length} chars)`);
  }
}

main().catch(console.error);
