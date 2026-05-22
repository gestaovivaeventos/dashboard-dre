/* eslint-disable no-console */

// ============================================================================
// Script de teste isolado do motor One Page Report.
//
// Carrega OPENAI_API_KEY do .env.local, monta um OnePageInput com dados
// mockados e chama analyzeOnePageReport. Imprime o JSON da analise no stdout.
//
// Cenario mockado:
//   - Receita realizada ACIMA do orcado.
//   - Despesas operacionais ACIMA do orcado.
//   - Resultado do exercicio positivo, mas pressionado.
//   - Margem operacional levemente pressionada (custo acima do esperado).
//   - FEE e VVR informados para o periodo.
//
// Rodar:
//   npx tsx scripts/test-one-page-analyzer.ts
// ============================================================================

import dotenv from "dotenv";
import path from "path";

// Carrega .env.local antes de qualquer import que toque process.env.
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import {
  analyzeOnePageReport,
  OnePageReportError,
} from "@/lib/financeiro/relatorios/one-page-analyzer";
import type { OnePageInput } from "@/lib/intelligence/one-page-schema";

const fakeInput: OnePageInput = {
  empresa: {
    id: "11111111-1111-1111-1111-111111111111",
    nome: "Empresa Teste (Mock)",
  },
  periodo: {
    date_from: "2026-04-01",
    date_to: "2026-04-30",
    label: "Abril/2026",
  },
  dre: [
    // ─── Receita acima do orcamento ─────────────────────────────────────────
    {
      code: "1",
      name: "Receita Operacional Bruta",
      realizado: 480000.0,
      orcado: 420000.0,
      variacao_absoluta: 60000.0,
      variacao_percentual: 14.29,
      pct_receita_liquida: 100.0,
    },
    {
      code: "2",
      name: "Outras Receitas",
      realizado: 3200.0,
      orcado: 2500.0,
      variacao_absoluta: 700.0,
      variacao_percentual: 28.0,
      pct_receita_liquida: 0.71,
    },
    {
      code: "3",
      name: "Deducoes de Receita",
      realizado: 32000.0,
      orcado: 30000.0,
      variacao_absoluta: 2000.0,
      variacao_percentual: 6.67,
      pct_receita_liquida: 7.08,
    },
    {
      code: "4",
      name: "Receita Liquida",
      realizado: 451200.0,
      orcado: 392500.0,
      variacao_absoluta: 58700.0,
      variacao_percentual: 14.96,
      pct_receita_liquida: 100.0,
    },
    // ─── Custos acima do orcamento (margem pressionada) ─────────────────────
    {
      code: "5",
      name: "Custos com os Servicos Prestados",
      realizado: 165000.0,
      orcado: 130000.0,
      variacao_absoluta: 35000.0,
      variacao_percentual: 26.92,
      pct_receita_liquida: 36.57,
    },
    {
      code: "6",
      name: "Lucro Operacional Bruto",
      realizado: 286200.0,
      orcado: 262500.0,
      variacao_absoluta: 23700.0,
      variacao_percentual: 9.03,
      pct_receita_liquida: 63.43,
    },
    // ─── Despesas operacionais acima do orcamento ──────────────────────────
    {
      code: "7",
      name: "Despesas Operacionais",
      realizado: 245000.0,
      orcado: 210000.0,
      variacao_absoluta: 35000.0,
      variacao_percentual: 16.67,
      pct_receita_liquida: 54.3,
    },
    {
      code: "8",
      name: "Lucro ou Prejuizo Operacional",
      realizado: 41200.0,
      orcado: 52500.0,
      variacao_absoluta: -11300.0,
      variacao_percentual: -21.52,
      pct_receita_liquida: 9.13,
    },
    // ─── Resultado positivo, ainda que abaixo do esperado ──────────────────
    {
      code: "9",
      name: "Receitas Nao Operacionais",
      realizado: 1500.0,
      orcado: 0.0,
      variacao_absoluta: 1500.0,
      variacao_percentual: null,
      pct_receita_liquida: 0.33,
    },
    {
      code: "10",
      name: "Despesas Nao Operacionais",
      realizado: 800.0,
      orcado: 500.0,
      variacao_absoluta: 300.0,
      variacao_percentual: 60.0,
      pct_receita_liquida: 0.18,
    },
    {
      code: "11",
      name: "Resultado do Exercicio",
      realizado: 41900.0,
      orcado: 52000.0,
      variacao_absoluta: -10100.0,
      variacao_percentual: -19.42,
      pct_receita_liquida: 9.29,
    },
  ],
  fee_vvr: {
    fee_mes: 12000.0,
    vvr_mes: 8500.0,
  },
};

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error(
      "OPENAI_API_KEY nao encontrada. Verifique se .env.local existe e contem essa chave.",
    );
    process.exit(1);
  }

  console.error("→ Input enviado ao motor:");
  console.error(JSON.stringify(fakeInput, null, 2));
  console.error("");
  console.error("→ Chamando OpenAI via Vercel AI SDK (gpt-4o-mini, retry 1x)...");
  console.error("");

  try {
    const report = await analyzeOnePageReport(fakeInput);
    console.log(JSON.stringify(report, null, 2));
  } catch (err) {
    if (err instanceof OnePageReportError) {
      console.error("OnePageReportError:", err.message);
      if (err.cause) console.error("Cause:", err.cause);
    } else {
      console.error("Erro inesperado:", err);
    }
    process.exit(1);
  }
}

void main();
