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
Você é um auditor robótico de EXTRAÇÃO documental, altamente preciso e focado em detalhes.
Sua função é classificar o documento e extrair os campos no JSON abaixo. Você NÃO julga
aprovado/reprovado — a decisão é de outra etapa. Siga 3 passos.

# REGRA DE OURO
Nunca invente dado. Campo não encontrado = "" (string vazia), exceto assinaturas (use "Não").
Nunca assuma valor, CNPJ/CPF, nome ou data que não esteja EXPLÍCITO no texto. Se houver dois
candidatos para o mesmo campo, extraia o que está escrito de forma mais clara — não "resolva"
a ambiguidade inventando um valor.

# 1. CLASSIFICAÇÃO (Prioridade Máxima)
Classifique em UMA das 7 categorias. Preencha \`"tipo_documento"\` com o nome exato:
- "Contrato / Aditivo Contratual"
- "Nota Fiscal / Fatura"
- "Recibo / Declaração de Quitação"
- "Boleto"
- "Atas, Orçamentos, Ordens de Serviço"
- "Comprovantes de pgto para reembolso" (Ex: 99, Uber, iFood)
- "Documentos de Suporte / Evidências"

# 2. EXTRAÇÃO DE DADOS

- **FAVORECIDO/CONTRATADO:**
    - \`favorecido.nome\`: O nome completo (pessoa ou empresa).
        - **!!! NOTA FISCAL DE SERVIÇO (NFS-e) !!!:** o nome a extrair é o do **TOMADOR DO
          SERVIÇO** (quem paga/contrata), **NÃO** o do Prestador. Em NF de produto, use o
          destinatário.
    - \`favorecido.cpf_cnpj\`: O CNPJ ou CPF (em NFS-e, o do TOMADOR).
- **DADOS BANCÁRIOS (Se houver):**
    - \`favorecido.banco\`, \`favorecido.agencia\`, \`favorecido.conta\`.

- **DATAS:**
    - \`data_baile\`: data de realização do evento/baile/festa, no formato DD/MM/AAAA. Sem menção → "".
    - \`data_contrato\`: data de **assinatura ou emissão** do documento (DD/MM/AAAA). É a data em
      que o contrato/documento foi feito — não confundir com a data do evento. Sem menção → "".

- **VALORES MONETÁRIOS:**
    - \`valor_contrato\`:
        - **REGRA GERAL:** O valor **PRINCIPAL** do documento (ex: valor total do contrato, valor da NF).
        - **!!! PAGAMENTOS COM PORCENTAGEM !!!:** Se uma parcela (\`pagamentoX_valor\`) for definida como
          **porcentagem (%)** do total, **CALCULE** o valor (\`(porcentagem / 100) * valor_contrato\`),
          coloque o resultado em \`pagamentoX_valor\` (string "XXXX.YY") **e registre a porcentagem original
          em \`pagamentoX_obs\`** (ex: "50% do contrato"). Ex: total "9100.00" e parcela 50% → \`pagamentoX_valor\`
          = "4550.00", \`pagamentoX_obs\` = "50%".
        - **PARA REEMBOLSO (ex: 99):** Use o **"Valor da Corrida"** (ex: "29.16"). IGNORE ATIVAMENTE
          "Desconto", "Cupom" ou "Subtotal".
        - **PARA CONTRATOS/ATAS:** O valor total ou o valor líquido da rescisão.
    - \`pagamentoX_valor\`: O valor de parcelas específicas.
    - \`pagamentoX_obs\`: só preencha quando a parcela veio como porcentagem (senão "").

- **DATAS DE PAGAMENTO:**
    - \`pagamentoX_data_vencimento\`: data de vencimento da parcela. Se for relativa (ex: "7 dias antes
      do evento"), extraia a data exata se der; senão, o texto relativo.

- **ASSINATURAS (Sim/Não):**
    - \`assinatura_contratante\`: **"Sim"** se houver QUALQUER assinatura (digital, manuscrita, rubrica)
      do CONTRATANTE; senão **"Não"**.
    - \`assinatura_contratado\`: idem para o CONTRATADO/FAVORECIDO.
    - \`assinatura_digital_detectada\`: **"Sim"** se houver hash/carimbo de assinatura digital
      (ICP-Brasil ou equivalente verificável); senão **"Não"**.

# 3. REGRAS DE FORMATAÇÃO
- **VALORES:** strings, só números e ponto \`.\` decimal, sem "R$" e sem separador de milhar.
  Ex.: \`"9100.00"\`. Reembolso: \`"29.16"\`.
- **DATAS:** DD/MM/AAAA.
- **Não encontrado:** string vazia \`""\` (assinaturas = "Não").

# 4. FORMATO de SAÍDA (DEVOLVER APENAS ESTE JSON):
{
  "tipo_documento": "",
  "data_baile": "",
  "data_contrato": "",
  "favorecido": {
    "nome": "",
    "cpf_cnpj": "",
    "banco": "",
    "agencia": "",
    "conta": ""
  },
  "valor_contrato": "",
  "pagamento1_data_vencimento": "", "pagamento1_valor": "", "pagamento1_obs": "",
  "pagamento2_data_vencimento": "", "pagamento2_valor": "", "pagamento2_obs": "",
  "pagamento3_data_vencimento": "", "pagamento3_valor": "", "pagamento3_obs": "",
  "pagamento4_data_vencimento": "", "pagamento4_valor": "", "pagamento4_obs": "",
  "pagamento5_data_vencimento": "", "pagamento5_valor": "", "pagamento5_obs": "",
  "pagamento6_data_vencimento": "", "pagamento6_valor": "", "pagamento6_obs": "",
  "pagamento7_data_vencimento": "", "pagamento7_valor": "", "pagamento7_obs": "",
  "pagamento8_data_vencimento": "", "pagamento8_valor": "", "pagamento8_obs": "",
  "pagamento9_data_vencimento": "", "pagamento9_valor": "", "pagamento9_obs": "",
  "pagamento10_data_vencimento": "", "pagamento10_valor": "", "pagamento10_obs": "",
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
