/**
 * Qual caminho aceita FERRAMENTA no modelo ATIVO do painel?
 *
 *   npx tsx scripts/ai-tools-probe.ts
 *
 * Rode isto ao TROCAR o modelo no painel de IA. O painel aceita cadastrar
 * qualquer modelo, e cada família muda a forma da requisição — foi assim que
 * `gpt-6-luna` derrubou o teste de conexão em 30/09/2026 (`max_tokens`) e o
 * agente de viagem em 02/10/2026 (ferramenta no endpoint de chat). A falha é
 * CALADA: o turno morre sem texto e sem erro na tela.
 *
 * O erro medido em 02/10/2026 foi:
 *   "Function tools with reasoning_effort are not supported for gpt-6-luna in
 *    /v1/chat/completions. To use function tools, use /v1/responses or set
 *    reasoning_effort"
 *
 * Duas leituras possíveis, e o código não pode chutar entre elas. Este script
 * testa as três hipóteses contra a API real. Nada da chave é impresso.
 */
import { createClient } from "@supabase/supabase-js";

import { decryptSecret } from "../src/lib/security/encryption";

const TOOL = {
  name: "buscar_precos",
  description: "Pesquisa preco de passagem",
  parameters: {
    type: "object",
    properties: { de: { type: "string" }, para: { type: "string" } },
    required: ["de", "para"],
    additionalProperties: false,
  },
};

const PERGUNTA = "Use a ferramenta buscar_precos para cotar Juiz de Fora -> Curitiba.";

async function chave(): Promise<{ k: string; modelo: string }> {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data } = await db
    .from("ai_provider_settings")
    .select("provider, model, api_key_encrypted")
    .eq("provider", "openai")
    .maybeSingle();
  const r = data as Record<string, unknown>;
  return { k: decryptSecret(String(r.api_key_encrypted)), modelo: String(r.model) };
}

async function tentar(nome: string, url: string, corpo: unknown, k: string) {
  const resp = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${k}`, "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const j = (await resp.json()) as Record<string, any>;
  if (j.error) {
    console.log(`${nome}: HTTP ${resp.status} — ${String(j.error.message).slice(0, 150)}`);
    return;
  }
  // chat/completions
  if (j.choices) {
    const msg = j.choices[0]?.message ?? {};
    console.log(
      `${nome}: HTTP ${resp.status} OK — tool_calls=${(msg.tool_calls ?? []).length} finish=${j.choices[0]?.finish_reason}`,
    );
    return;
  }
  // responses
  const saida = (j.output ?? []) as Array<Record<string, any>>;
  const chamadas = saida.filter((o) => o.type === "function_call");
  console.log(
    `${nome}: HTTP ${resp.status} OK — function_call=${chamadas.length} status=${j.status}` +
      (chamadas[0] ? ` (${chamadas[0].name})` : ""),
  );
}

async function main() {
  const { k, modelo } = await chave();
  console.log(`modelo do painel: ${modelo}\n`);

  // 1) o que a rota faz hoje — e que falhou
  await tentar("chat/completions + tools          ", "https://api.openai.com/v1/chat/completions", {
    model: modelo,
    max_completion_tokens: 150,
    messages: [{ role: "user", content: PERGUNTA }],
    tools: [{ type: "function", function: TOOL }],
  }, k);

  // 2) a segunda sugestão da própria mensagem de erro
  for (const esforco of ["minimal", "low", "none"]) {
    await tentar(`chat/completions + reasoning=${esforco.padEnd(8)}`, "https://api.openai.com/v1/chat/completions", {
      model: modelo,
      max_completion_tokens: 150,
      reasoning_effort: esforco,
      messages: [{ role: "user", content: PERGUNTA }],
      tools: [{ type: "function", function: TOOL }],
    }, k);
  }

  // 3) o caminho que a mensagem recomenda
  await tentar("responses + tools                 ", "https://api.openai.com/v1/responses", {
    model: modelo,
    max_output_tokens: 300,
    input: PERGUNTA,
    tools: [{ type: "function", ...TOOL }],
  }, k);

  // 4) responses SEM tool, só para confirmar que o modelo responde por lá
  await tentar("responses sem tool                ", "https://api.openai.com/v1/responses", {
    model: modelo,
    max_output_tokens: 100,
    input: "Diga apenas: ok",
  }, k);
}

void main();
