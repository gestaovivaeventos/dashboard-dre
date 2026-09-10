// LandingAI Agentic Document Extraction (ADE) "parse" wrapper.
// Mirrors get_text_with_landingai() from the GCP Cloud Function: takes a URL,
// returns the markdown + credit cost so the caller can debit the company quota.

import { PDFDocument } from 'pdf-lib'

const LANDINGAI_PARSE_URL = 'https://api.va.landing.ai/v1/ade/parse'
const DEFAULT_MODEL = 'dpt-2-latest'

// O LandingAI recusa PDF acima de 100 páginas (HTTP 422) mesmo pedindo só a
// página 1 via `options.pages` — o limite é do arquivo. Anexo desse tamanho é
// apólice/regulamento inteiro (RP 880704: apólice Chubb de 353 páginas), e o
// que a validação precisa (partes, valor, favorecido) está no começo. Em vez
// de derrubar a RP inteira como 'erro', o PDF é baixado, cortado nas primeiras
// páginas e reenviado como arquivo. O corte também limita o custo: cada página
// lida é crédito.
const OVERSIZE_PAGES_TO_READ = 20
const DOWNLOAD_TIMEOUT_MS = 60_000

export interface LandingAIParseResult {
  markdown: string
  creditsUsed: number
  pageCount: number
  // Presente só quando o documento foi cortado: quantas páginas foram de fato
  // lidas (pageCount segue sendo o total do arquivo original).
  pagesRead?: number
}

export class LandingAIError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'LandingAIError'
  }
}

interface ParsePayload {
  markdown: string
  creditsUsed: number
  pageCount: number
}

function isOversizeError(e: unknown): e is LandingAIError {
  return e instanceof LandingAIError && e.status === 422 && /exceed.*pages/i.test(e.message)
}

export async function parseDocumentWithLandingAI(
  documentUrl: string,
  options: { model?: string; timeoutMs?: number } = {},
): Promise<LandingAIParseResult> {
  const apiKey = process.env.VISION_AGENT_API_KEY
  if (!apiKey) {
    throw new LandingAIError('VISION_AGENT_API_KEY não configurada no ambiente')
  }
  const model = options.model ?? DEFAULT_MODEL
  const timeoutMs = options.timeoutMs ?? 200_000

  const form = new FormData()
  form.append('document_url', documentUrl)
  form.append('model', model)

  try {
    return await postParse(form, apiKey, timeoutMs)
  } catch (e) {
    if (!isOversizeError(e)) throw e
  }

  const { bytes, totalPages } = await downloadAndTrimPdf(documentUrl, OVERSIZE_PAGES_TO_READ)
  console.log(`[landingai] oversize pdf (${totalPages} pages) — resending first ${OVERSIZE_PAGES_TO_READ} pages as file`)
  const trimmedForm = new FormData()
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
  trimmedForm.append('document', new Blob([buffer], { type: 'application/pdf' }), 'documento.pdf')
  trimmedForm.append('model', model)
  const parsed = await postParse(trimmedForm, apiKey, timeoutMs)
  return { ...parsed, pageCount: totalPages, pagesRead: Math.min(OVERSIZE_PAGES_TO_READ, totalPages) }
}

async function downloadAndTrimPdf(
  documentUrl: string,
  maxPages: number,
): Promise<{ bytes: Uint8Array; totalPages: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS)
  let original: ArrayBuffer
  try {
    const res = await fetch(documentUrl, { signal: controller.signal })
    if (!res.ok) {
      throw new LandingAIError(`Download do PDF para corte falhou: HTTP ${res.status}`, res.status)
    }
    original = await res.arrayBuffer()
  } catch (e) {
    if (e instanceof LandingAIError) throw e
    throw new LandingAIError(`Download do PDF para corte falhou: ${(e as Error).message}`)
  } finally {
    clearTimeout(timer)
  }

  let src: PDFDocument
  try {
    src = await PDFDocument.load(original, { ignoreEncryption: true })
  } catch (e) {
    throw new LandingAIError(`PDF acima do limite de páginas e não foi possível cortá-lo: ${(e as Error).message}`)
  }
  const totalPages = src.getPageCount()
  const out = await PDFDocument.create()
  const pages = await out.copyPages(
    src,
    Array.from({ length: Math.min(maxPages, totalPages) }, (_, i) => i),
  )
  for (const p of pages) out.addPage(p)
  return { bytes: await out.save(), totalPages }
}

async function postParse(form: FormData, apiKey: string, timeoutMs: number): Promise<ParsePayload> {
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
    const target = form.get('document_url')
    console.log(`[landingai] POST parse ${typeof target === 'string' ? `url=${target.slice(0, 80)}` : 'file upload'}`)
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
