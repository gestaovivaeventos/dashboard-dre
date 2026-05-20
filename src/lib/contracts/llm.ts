// LLM extraction wrapper. Takes the markdown output of LandingAI ADE and
// returns the structured ContractExtraction JSON.
//
// Uses OpenAI Chat Completions with response_format=json_object. The prompt
// is the same one validated in production by the GCP Cloud Function — kept
// verbatim (Portuguese, exact rules) so behaviour stays consistent.

import type { ContractExtraction } from './types'

const DEFAULT_MODEL = 'gpt-4o-mini'
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions'

export class LlmExtractionError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'LlmExtractionError'
  }
}

function buildPrompt(text: string): string {
  return `
Você é um auditor robótico, altamente preciso e focado em detalhes. Sua função é ler o texto e preencher o JSON abaixo, seguindo 3 passos:

# 1. CLASSIFICAÇÃO (Prioridade Máxima)
Primeiro, classifique o documento em UMA das 7 categorias. Preencha \`"tipo_documento"\` com o nome exato da categoria.
Categorias:
- "Contrato / Aditivo Contratual"
- "Nota Fiscal / Fatura"
- "Recibo / Declaração de Quitação"
- "Boleto"
- "Atas, Orçamentos, Ordens de Serviço"
- "Comprovantes de pgto para reembolso" (Ex: 99, Uber, iFood)
- "Documentos de Suporte / Evidências"

# 2. EXTRAÇÃO DE DADOS

- **DATA DO BAILE/EVENTO:**
    - \`data_baile\`: Procure pela data de realização do evento principal, data do baile, ou data da festa. Se houver, extraia no formato DD/MM/AAAA. Se não houver menção explícita a uma data de evento, deixe em branco.

- **FAVORECIDO/CONTRATADO:**
    - \`favorecido.nome\`: O nome completo (pessoa ou empresa).
    - \`favorecido.cpf_cnpj\`: O CNPJ ou CPF.
- **DADOS BANCÁRIOS (Se houver):**
    - \`favorecido.banco\`, \`favorecido.agencia\`, \`favorecido.conta\`.

- **VALORES MONETÁRIOS:**
    - \`valor_contrato\`:
        - **REGRA GERAL:** O valor **PRINCIPAL** do documento (ex: valor total do contrato, valor da NF).
        - **!!! PAGAMENTOS COM PORCENTAGEM !!!:** Se um pagamento (\`pagamentoX_valor\`) for definido como uma **porcentagem (%)** do valor total, **CALCULE** o valor correspondente (\`(porcentagem / 100) * valor_contrato\`) e coloque o **resultado numérico formatado** (como string "XXXX.YY") no campo \`pagamentoX_valor\`. Ex: Se valor_contrato é "9100.00" e o pagamento é 50%, preencha pagamentoX_valor com "4550.00".
        - **PARA REEMBOLSO (ex: 99):** Este DEVE ser o **"Valor da Corrida"** (ex: "29.16"). A IA DEVE IGNORAR ATIVAMENTE valores de **"Desconto"** (ex: "3.24"), "Cupom" ou "Subtotal". Procure o valor principal da despesa.
        - **PARA CONTRATOS/ATAS:** O valor total ou o valor líquido da rescisão.
    - \`pagamentoX_valor\`: O valor de parcelas específicas.

- **DATAS DE PAGAMENTO:**
    - \`pagamentoX_data_vencimento\`: Extraia as datas de vencimento para \`pagamentoX_data_vencimento\`. Se a data for relativa (ex: "7 dias antes do evento"), tente extrair a data exata se possível, senão extraia o texto relativo.

- **ASSINATURAS (Sim/Não):**
    - \`assinatura_contratante\`: Coloque **"Sim"** se houver QUALQUER assinatura (digital, manuscrita, rubrica) do CONTRATANTE. Senão, coloque **"Não"**.
    - \`assinatura_contratado\`: Coloque **"Sim"** se houver QUALQUER assinatura (digital, manuscrita, rubrica) do CONTRATADO/FAVORECIDO. Senão, coloque **"Não"**.
    - \`assinatura_digital_detectada\`: Coloque **"Sim"** se detectar um hash de assinatura digital. Senão, **"Não"**.

# 3. REGRAS DE FORMATAÇÃO
- **VALORES (\`valor_contrato\`, \`pagamentoX_valor\`):**
    - Retorne como **strings**, usando **apenas números e o ponto \`.\` como separador decimal**.
    - **NÃO use** "R$" ou separador de milhar.
    - Exemplo correto: \`"9100.00"\`. Exemplo para reembolso: \`"29.16"\`.
- **Valores Não Encontrados**: Deixe a string vazia \`""\`, exceto para assinaturas, que devem ser "Não".

# 4. FORMATO de SAÍDA (DEVOLVER APENAS ESTE JSON):
{
  "tipo_documento": "",
  "data_baile": "",
  "favorecido": {
    "nome": "",
    "cpf_cnpj": "",
    "banco": "",
    "agencia": "",
    "conta": ""
  },
  "valor_contrato": "",
  "pagamento1_data_vencimento": "",
  "pagamento1_valor": "",
  "pagamento2_data_vencimento": "",
  "pagamento2_valor": "",
  "pagamento3_data_vencimento": "",
  "pagamento3_valor": "",
  "pagamento4_data_vencimento": "",
  "pagamento4_valor": "",
  "pagamento5_data_vencimento": "",
  "pagamento5_valor": "",
  "pagamento6_data_vencimento": "",
  "pagamento6_valor": "",
  "pagamento7_data_vencimento": "",
  "pagamento7_valor": "",
  "pagamento8_data_vencimento": "",
  "pagamento8_valor": "",
  "pagamento9_data_vencimento": "",
  "pagamento9_valor": "",
  "pagamento10_data_vencimento": "",
  "pagamento10_valor": "",
  "assinatura_contratante": "Não",
  "assinatura_contratado": "Não",
  "assinatura_digital_detectada": "Não"
}

Lembre-se: devolva **apenas o JSON puro**.

# TEXTO DO DOCUMENTO PARA ANÁLISE:
${text}
`
}

export async function extractContractDataWithLlm(
  text: string,
  options: { model?: string; timeoutMs?: number } = {},
): Promise<ContractExtraction> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new LlmExtractionError('OPENAI_API_KEY não configurada no ambiente')
  }

  const model = options.model ?? DEFAULT_MODEL
  const timeoutMs = options.timeoutMs ?? 120_000

  const controller = new AbortController()
  // Same hard-timeout pattern as landingai.ts — AbortController alone is
  // unreliable when sockets hang. Promise.race forces rejection after
  // timeoutMs regardless of fetch state.
  let abortTimer: NodeJS.Timeout | null = null
  const hardTimeout = new Promise<never>((_, reject) => {
    abortTimer = setTimeout(() => {
      controller.abort()
      reject(new LlmExtractionError('OpenAI: timeout aguardando resposta'))
    }, timeoutMs)
  })

  let response: Response
  try {
    response = await Promise.race([
      fetch(OPENAI_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: buildPrompt(text) }],
          temperature: 0,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      }),
      hardTimeout,
    ])
  } catch (e) {
    if (e instanceof LlmExtractionError) throw e
    if (e instanceof Error && e.name === 'AbortError') {
      throw new LlmExtractionError('OpenAI: timeout aguardando resposta')
    }
    throw new LlmExtractionError(`OpenAI: falha de rede (${(e as Error).message})`)
  } finally {
    if (abortTimer) clearTimeout(abortTimer)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new LlmExtractionError(
      `OpenAI: HTTP ${response.status} ${body.slice(0, 300)}`,
      response.status,
    )
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }

  const rawText = payload.choices?.[0]?.message?.content
  if (!rawText) {
    throw new LlmExtractionError('OpenAI: resposta vazia ou sem choice')
  }

  let parsed: ContractExtraction
  try {
    parsed = JSON.parse(rawText) as ContractExtraction
  } catch (e) {
    throw new LlmExtractionError(
      `OpenAI: JSON inválido na resposta (${(e as Error).message}): ${rawText.slice(0, 200)}`,
    )
  }

  if (!parsed.favorecido) {
    parsed.favorecido = { nome: '', cpf_cnpj: '', banco: '', agencia: '', conta: '' }
  }

  return parsed
}
