// Mostra a ESTRUTURA de uma planilha de viagens, sem tocar o banco:
//
//   npx tsx scripts/viagens-historico-inspect.ts "docs/viagens/historico-2026.xlsx"
//
// Existe porque a planilha real do admin é "uma viagem por ABA", e o importador do
// histórico lê uma linha por viagem na primeira aba. Antes de converter, é preciso
// VER o formato: quantas abas, como cada uma rotula passagem/hotel/alimentação, e
// onde estão pessoas e noites — que são o que transforma gasto em custo unitário.
//
// Só lê e imprime. Nenhuma escrita, nenhuma credencial.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error('Uso: npx tsx scripts/viagens-historico-inspect.ts "caminho/da/planilha.xlsx"');
  process.exit(1);
}

const LINHAS = Number(process.env.LINHAS ?? 30);
const COLUNAS = Number(process.env.COLUNAS ?? 10);
const ABAS = Number(process.env.ABAS ?? 0); // 0 = todas
const LARGURA = Number(process.env.LARGURA ?? 28);
/** ABA="NOME|OUTRA" imprime só essas, com o texto inteiro. */
const SO = (process.env.ABA ?? "").split("|").map((x) => x.trim()).filter(Boolean);

const caminho = resolve(arquivo);
const wb = XLSX.read(new Uint8Array(readFileSync(caminho)), { type: "array" });

console.log(`\nArquivo: ${caminho}`);
console.log(`Abas (${wb.SheetNames.length}): ${wb.SheetNames.join(" | ")}\n`);

const nomes = SO.length > 0 ? SO : ABAS > 0 ? wb.SheetNames.slice(0, ABAS) : wb.SheetNames;

/** Célula vazia some; número vira número; texto é cortado para a linha caber. */
function mostrar(v: unknown): string {
  if (v === null || v === undefined || v === "") return "";
  if (typeof v === "number") return String(v);
  const t = String(v).replace(/\s+/g, " ").trim();
  return t.length > LARGURA ? `${t.slice(0, LARGURA - 1)}…` : t;
}

for (const nome of nomes) {
  const ws = wb.Sheets[nome];
  if (!ws) continue;
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1,
    blankrows: true,
    defval: "",
  });

  const usadas = data.slice(0, LINHAS);
  // Linhas de rodapé em branco não dizem nada; corta o rabo vazio.
  while (usadas.length > 0 && (usadas[usadas.length - 1] ?? []).every((c) => mostrar(c) === "")) {
    usadas.pop();
  }

  console.log(`${"─".repeat(78)}`);
  console.log(`ABA "${nome}" — ${data.length} linha(s) no total, mostrando ${usadas.length}`);
  console.log(`${"─".repeat(78)}`);
  usadas.forEach((row, i) => {
    const celulas = (row ?? []).slice(0, COLUNAS).map(mostrar);
    // Linha inteiramente vazia vale como separador visual, sem poluir.
    if (celulas.every((c) => c === "")) {
      console.log(`${String(i + 1).padStart(3)} |`);
      return;
    }
    console.log(`${String(i + 1).padStart(3)} | ${celulas.join(" | ")}`);
  });
  console.log("");
}

console.log(
  "Para a conversão eu preciso achar, em cada aba: cidade, mês, PESSOAS, noites,\n" +
    "ocupação (pessoas por quarto), modal e os totais de passagem, hospedagem e\n" +
    "alimentação. O que não estiver na planilha volta como pendência, nunca como chute.\n",
);
