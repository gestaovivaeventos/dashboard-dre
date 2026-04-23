const fs = require('fs');
const https = require('https');

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhsb3BoaWt2Z3Rxb2V4cXd4eGlzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MzQyODk2MSwiZXhwIjoyMDg5MDA0OTYxfQ.dBhritV67TbNCSb9kdVdPzafhsvPpfMpwuymFHmrLPk';
const BASE_DIR = 'C:\\Users\\Marcelo\\.claude\\projects\\c--Users-Marcelo-PROGRAMAS-dashboard-dre\\2045f17e-eec1-4afb-bdba-d86632ffb238\\tool-results\\';
const SCRIPTS_DIR = 'C:\\Users\\Marcelo\\PROGRAMAS\\dashboard-dre\\scripts\\';

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

function applySQL(sql, label) {
  return new Promise((resolve, reject) => {
    // Use the pg/sql endpoint via service role
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
        'Prefer': 'return=minimal',
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[${label}] ✓ Applied (HTTP ${res.statusCode})`);
          resolve(true);
        } else {
          console.log(`[${label}] ✗ HTTP ${res.statusCode}: ${data.substring(0, 200)}`);
          resolve(false);
        }
      });
    });
    req.on('error', (e) => { console.error(`[${label}] Error:`, e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}

// Apply using pg REST (direct SQL via management API)
function applySQLDirect(sql, label) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ query: sql });
    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: '/v1/projects/hlophikvgtqoexqwxxis/database/query',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SERVICE_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          console.log(`[${label}] ✓ Applied (HTTP ${res.statusCode})`);
          resolve(true);
        } else {
          console.log(`[${label}] ✗ HTTP ${res.statusCode}: ${data.substring(0, 300)}`);
          resolve(false);
        }
      });
    });
    req.on('error', (e) => { console.error(`[${label}] Error:`, e.message); resolve(false); });
    req.write(body);
    req.end();
  });
}

const INSERT_PREFIX = `INSERT INTO ctrl_suppliers (id, omie_id, name, cnpj_cpf, email, phone, status, from_omie, created_by, approved_by, approved_at, created_at, updated_at, chave_pix, banco, agencia, conta_corrente, titular_banco, doc_titular, transf_padrao) VALUES\n`;
const INSERT_SUFFIX = '\nON CONFLICT (id) DO NOTHING;';

async function main() {
  // Files from tool results (batches 1-5)
  const toolFiles = [
    { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711622345.txt', label: 'batch1_offset0' },
    { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711629293.txt', label: 'batch2_offset200' },
    { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711784899.txt', label: 'batch3_offset400' },
    { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711791009.txt', label: 'batch4_offset600' },
    { file: BASE_DIR + 'mcp-plugin_supabase_supabase-execute_sql-1776711812368.txt', label: 'batch5_offset800' },
  ];

  console.log('=== Building and applying supplier batches ===\n');

  for (const batch of toolFiles) {
    console.log(`Extracting ${batch.label}...`);
    try {
      const vals = extractVals(batch.file);
      if (!vals) { console.log('  No vals found, skipping'); continue; }
      const sql = INSERT_PREFIX + vals + INSERT_SUFFIX;
      console.log(`  Extracted ${vals.length} chars, applying...`);
      await applySQLDirect(sql, batch.label);
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
    // small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }

  // Batch 6 - last batch (offset 1000) - apply from pre-written file
  const batch6File = SCRIPTS_DIR + 'suppliers_batch6.sql';
  if (fs.existsSync(batch6File)) {
    const sql = fs.readFileSync(batch6File, 'utf8');
    console.log(`\nApplying batch6 (${sql.length} chars)...`);
    await applySQLDirect(sql, 'batch6_offset1000');
  } else {
    console.log('\nbatch6 file not found, skipping');
  }

  console.log('\n=== Done ===');
}

main().catch(console.error);
