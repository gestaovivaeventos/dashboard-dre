// LandingAI Agentic Document Extraction (ADE) "parse" wrapper.
// Mirrors get_text_with_landingai() from the GCP Cloud Function: takes a URL,
// returns the markdown + credit cost so the caller can debit the company quota.

const LANDINGAI_PARSE_URL = 'https://api.va.landing.ai/v1/ade/parse'
const DEFAULT_MODEL = 'dpt-2-latest'

export interface LandingAIParseResult {
  markdown: string
  creditsUsed: number
  pageCount: number
}

export class LandingAIError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'LandingAIError'
  }
}

export async function parseDocumentWithLandingAI(
  documentUrl: string,
  options: { model?: string; timeoutMs?: number } = {},
): Promise<LandingAIParseResult> {
  const apiKey = process.env.VISION_AGENT_API_KEY
  if (!apiKey) {
    throw new LandingAIError('VISION_AGENT_API_KEY não configurada no ambiente')
  }

  const form = new FormData()
  form.append('document_url', documentUrl)
  form.append('model', options.model ?? DEFAULT_MODEL)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 180_000)

  let response: Response
  try {
    response = await fetch(LANDINGAI_PARSE_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: controller.signal,
    })
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new LandingAIError('LandingAI parse: timeout aguardando resposta')
    }
    throw new LandingAIError(`LandingAI parse: falha de rede (${(e as Error).message})`)
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    if (response.status === 401 || response.status === 403) {
      throw new LandingAIError('LandingAI parse: chave inválida ou sem permissão', response.status)
    }
    throw new LandingAIError(
      `LandingAI parse: HTTP ${response.status} ${body.slice(0, 300)}`,
      response.status,
    )
  }

  const payload = (await response.json()) as {
    markdown?: string
    metadata?: { credit_usage?: number; page_count?: number }
  }

  const markdown = (payload.markdown ?? '').trim()
  if (!markdown) {
    throw new LandingAIError('LandingAI parse: resposta sem conteúdo markdown')
  }

  return {
    markdown,
    creditsUsed: payload.metadata?.credit_usage ?? 0,
    pageCount: payload.metadata?.page_count ?? 0,
  }
}
