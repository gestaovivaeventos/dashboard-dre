// Read-only post-migration verification of Terrazzo's preserved rules.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: c } = await db.from("companies").select("id, name, segment_id, dre_sum_sheets_with_omie").eq("name", "Terrazzo").single();
const { data: seg } = await db.from("segments").select("slug").eq("id", c.segment_id).single();
console.log(`Terrazzo: segment=${seg.slug}  company_id=${c.id}  dre_sum_sheets_with_omie=${c.dre_sum_sheets_with_omie}`);

const tableCount = async (table, filter = (q) => q) => {
  const { count, error } = await filter(db.from(table).select("*", { count: "exact", head: true }).eq("company_id", c.id));
  return error ? `ERR(${error.message})` : count;
};

console.log("dre_accounts (total):            ", await tableCount("dre_accounts"));
console.log("dre_accounts data_source=sheets: ", await tableCount("dre_accounts", (q) => q.eq("data_source", "sheets")));
console.log("manual_account_values rows:      ", await tableCount("manual_account_values"));
console.log("category_mappings rows:          ", await tableCount("category_mappings"));
console.log("financial_entries rows:          ", await tableCount("financial_entries"));
console.log("budget_entries rows:             ", await tableCount("budget_entries"));
console.log("company_documents rows:          ", await tableCount("company_documents"));
console.log("user_company_access rows:        ", await tableCount("user_company_access"));
