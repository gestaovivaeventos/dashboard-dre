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

  const timeoutMs = options.timeoutMs ?? 200_000
  const controller = new AbortController()
  const fetchStart = Date.now()

  // We pair AbortController with a Promise.race hard-timeout. AbortController
  // alone has proved unreliable in Vercel's Node runtime when the LandingAI
  // socket hangs without bytes — the fetch never settles, the abort signal
  // doesn't bubble up, the function dies at maxDuration and the item stays
  // 'pending', blocking the cron forever. The race guarantees we *always*
  // reject after timeoutMs so the catch can mark the item as 'erro'.
  let abortTimer: NodeJS.Timeout | null = null
  const hardTimeout = new Promise<never>((_, reject) => {
    abortTimer = setTimeout(() => {
      console.log(`[landingai] hard timeout ${timeoutMs}ms — aborting`)
      controller.abort()
      reject(new LandingAIError('LandingAI parse: timeout aguardando resposta'))
    }, timeoutMs)
  })

  let response: Response
  try {
    console.log(`[landingai] POST parse url=${documentUrl.slice(0, 80)}`)
    response = await Promise.race([
      fetch(LANDINGAI_PARSE_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      }),
      hardTimeout,
    ])
    console.log(`[landingai] parse responded status=${response.status} took=${Date.now() - fetchStart}ms`)
  } catch (e) {
    console.log(`[landingai] parse fetch threw after ${Date.now() - fetchStart}ms: ${(e as Error).name}: ${(e as Error).message}`)
    if (e instanceof LandingAIError) throw e
    if (e instanceof Error && e.name === 'AbortError') {
      throw new LandingAIError('LandingAI parse: timeout aguardando resposta')
    }
    throw new LandingAIError(`LandingAI parse: falha de rede (${(e as Error).message})`)
  } finally {
    if (abortTimer) clearTimeout(abortTimer)
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
