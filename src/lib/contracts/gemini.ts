// Gemini "extract" wrapper. Sends the markdown text from LandingAI to Gemini
// with the same prompt used by the GCP Cloud Function and returns structured JSON.
// The prompt is intentionally kept verbatim (Portuguese, exact rules) so the model's
// behaviour matches what is already validated in production.

import type { ContractExtraction } from './types'

const DEFAULT_MODEL = 'gemini-2.5-flash-lite'

export class GeminiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'GeminiError'
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

function extractJsonFromResponse(raw: string): string {
  // Strip ```json fences and surrounding whitespace, matching the Python cleanup.
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  return cleaned
}

export async function extractContractDataWithGemini(
  text: string,
  options: { model?: string; timeoutMs?: number } = {},
): Promise<ContractExtraction> {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    throw new GeminiError('GEMINI_API_KEY não configurada no ambiente')
  }

  const model = options.model ?? DEFAULT_MODEL
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 120_000)

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildPrompt(text) }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
      signal: controller.signal,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new GeminiError('Gemini: timeout aguardando resposta')
    }
    throw new GeminiError(`Gemini: falha de rede (${(e as Error).message})`)
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new GeminiError(`Gemini: HTTP ${response.status} ${body.slice(0, 300)}`, response.status)
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }

  const rawText = payload.candidates?.[0]?.content?.parts?.[0]?.text
  if (!rawText) {
    throw new GeminiError('Gemini: resposta vazia ou sem candidato')
  }

  let parsed: ContractExtraction
  try {
    parsed = JSON.parse(extractJsonFromResponse(rawText)) as ContractExtraction
  } catch (e) {
    throw new GeminiError(
      `Gemini: JSON inválido na resposta (${(e as Error).message}): ${rawText.slice(0, 200)}`,
    )
  }

  // The Python script defensively initializes `favorecido` when missing.
  if (!parsed.favorecido) {
    parsed.favorecido = { nome: '', cpf_cnpj: '', banco: '', agencia: '', conta: '' }
  }

  return parsed
}
