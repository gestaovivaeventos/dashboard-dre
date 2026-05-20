import { NextResponse } from 'next/server'

import { processNextPendingBatch } from '@/lib/contracts/process-batch'
import { createAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const maxDuration = 300

function isAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return request.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const db = createAdminClient()
  const result = await processNextPendingBatch(db)
  if (!result) {
    return NextResponse.json({ ok: true, processed: false, message: 'No pending batches.' })
  }
  return NextResponse.json({ ok: true, processed: true, ...result })
}

// Allow manual triggering via POST from the UI (with the same Bearer secret),
// useful for "run now" buttons on a batch page.
export async function POST(request: Request) {
  return GET(request)
}
