// One-off: move company "Terrazzo" from segment "Feat" to "Real Estate".
// Scoped strictly to the single Terrazzo company row. Read -> verify -> update -> validate.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// minimal .env.local loader (no extra deps)
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = v;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error("Missing Supabase env vars");

const db = createClient(url, key, { auth: { persistSession: false } });

const die = (msg, e) => { console.error("FAIL:", msg, e?.message ?? e ?? ""); process.exit(1); };

// 1. Resolve segment ids
const { data: segs, error: segErr } = await db.from("segments").select("id, name, slug");
if (segErr) die("read segments", segErr);
const bySlug = Object.fromEntries(segs.map((s) => [s.slug, s]));
const realEstate = bySlug["real-estate"];
const feat = bySlug["feat"];
if (!realEstate) die("segment 'real-estate' not found");
console.log("segments -> real-estate:", realEstate.id, "| feat:", feat?.id ?? "(n/a)");

// 2. Read Terrazzo BEFORE
const { data: before, error: bErr } = await db
  .from("companies").select("id, name, segment_id").eq("name", "Terrazzo");
if (bErr) die("read Terrazzo", bErr);
if (before.length !== 1) die(`expected exactly 1 Terrazzo company, found ${before.length}`);
const terrazzo = before[0];
const fromSlug = segs.find((s) => s.id === terrazzo.segment_id)?.slug ?? "(none)";
console.log(`BEFORE -> Terrazzo id=${terrazzo.id} segment=${fromSlug}`);

// snapshot of segment membership counts to prove no other company moves
const { data: allBefore } = await db.from("companies").select("id, segment_id");
const countBy = (rows) => rows.reduce((a, r) => ((a[r.segment_id ?? "null"] = (a[r.segment_id ?? "null"] || 0) + 1), a), {});
const membersBefore = countBy(allBefore);

if (terrazzo.segment_id === realEstate.id) {
  console.log("Terrazzo is ALREADY in real-estate. Nothing to do.");
  process.exit(0);
}

// 3. Update ONLY Terrazzo by id
const { data: updated, error: uErr } = await db
  .from("companies").update({ segment_id: realEstate.id }).eq("id", terrazzo.id).select("id, name, segment_id");
if (uErr) die("update Terrazzo", uErr);
if (updated.length !== 1 || updated[0].segment_id !== realEstate.id) die("update did not apply as expected");

// 4. Validate AFTER
const { data: allAfter } = await db.from("companies").select("id, segment_id");
const membersAfter = countBy(allAfter);
// every other company's segment must be unchanged
let drift = 0;
for (const r of allAfter) {
  if (r.id === terrazzo.id) continue;
  const prev = allBefore.find((x) => x.id === r.id);
  if (prev && prev.segment_id !== r.segment_id) { drift++; console.error("DRIFT on company", r.id); }
}
if (drift) die(`${drift} other companies changed segment — unexpected`);

console.log(`AFTER  -> Terrazzo segment=real-estate (${realEstate.id})`);
console.log("segment counts before:", membersBefore);
console.log("segment counts after :", membersAfter);
console.log("OK: only Terrazzo moved; no other company affected.");
