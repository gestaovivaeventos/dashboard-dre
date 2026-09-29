// Confere a leitura da Sólides SEM tocar o banco: roda o cliente e o parser do
// DP contra a API real e imprime só CONTAGENS (nunca nome, CPF ou salário).
//   npx tsx --conditions=react-server scripts/dp-solides-dryrun.ts
import fs from "node:fs";

import { buscarFicha, listarColaboradores } from "@/lib/dp/solides/client";
import { parseDetail, parseListItem } from "@/lib/dp/solides/parse";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const i = line.indexOf("=");
  if (i > 0 && !process.env[line.slice(0, i).trim()]) process.env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "");
}

async function main() {
  const t0 = Date.now();
  const lista = (await listarColaboradores()).map(parseListItem);
  console.log(`lista: ${lista.length} em ${Date.now() - t0} ms`);
  const count = (f: (x: (typeof lista)[number]) => boolean) => lista.filter(f).length;
  console.log("sem CPF válido:", count((c) => !c.cpf), "| sem admissão:", count((c) => !c.data_admissao));
  console.log("com unidade:", count((c) => c.unidade_id !== null), "| só departamento:", count((c) => c.unidade_id === null && c.departamento_id !== null), "| nenhum:", count((c) => c.unidade_id === null && c.departamento_id === null));

  const t1 = Date.now();
  let ok = 0, erro = 0, comSalario = 0, comEndereco = 0, comDeslig = 0;
  const queue = [...lista];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let c = queue.shift(); c; c = queue.shift()) {
      try {
        const f = parseDetail(await buscarFicha(c.solides_id));
        ok++; if (f.salario !== null) comSalario++; if (f.endereco) comEndereco++; if (f.data_desligamento) comDeslig++;
      } catch { erro++; }
    }
  }));
  console.log(`fichas: ${ok} ok, ${erro} erro em ${Date.now() - t1} ms | com salário ${comSalario} | com endereço ${comEndereco} | com data de desligamento ${comDeslig}`);

  if (process.argv.includes("--regras")) {
    const sql = fs.readFileSync("supabase/migrations/20260929160000_dp_solides.sql", "utf8");
    const seeds = Array.from(sql.matchAll(/\('(unidade|departamento)', (\d+), '[^']*', '([^']+)'\)/g)).map((m) => ({ origem: m[1], id: Number(m[2]) }));
    const tem = (o: string, id: number | null) => id !== null && seeds.some((s) => s.origem === o && s.id === id);
    const resolvidos = lista.filter((c) => (c.unidade_id !== null ? tem("unidade", c.unidade_id) : tem("departamento", c.departamento_id)));
    console.log(`de-para inicial: ${seeds.length} regras → ${resolvidos.length} de ${lista.length} com empresa`);
  }
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
