import { NextRequest, NextResponse } from 'next/server'
import { ingestPage, finalizeRun } from '@/lib/ingest'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** L'extension appelle depuis l'origine chrome-extension:// : CORS requis. */
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400, headers: cors })
  }

  try {
    if (body.finalize) {
      if (!body.runId) {
        return NextResponse.json({ error: 'runId manquant' }, { status: 400, headers: cors })
      }
      const r = await finalizeRun(body.runId)
      console.log(`\x1b[32m[Ingest]\x1b[0m bilan ${body.runId}:`, r)
      return NextResponse.json(r, { headers: cors })
    }

    if (!Array.isArray(body.ads)) {
      return NextResponse.json({ error: 'ads manquant' }, { status: 400, headers: cors })
    }

    const r = await ingestPage({
      searchId: body.searchId,
      runId: body.runId,
      url: body.url,
      page: body.page,
      total: body.total,
      ads: body.ads,
    })
    console.log(
      `\x1b[36m[Ingest]\x1b[0m page ${body.page ?? '?'} (${body.source ?? '?'}) — ` +
      `${r.stored} annonces${r.reason ? ' — ' + r.reason : ''}`
    )
    return NextResponse.json(r, { headers: cors })
  } catch (e: any) {
    console.error('\x1b[31m[Ingest]\x1b[0m', e)
    return NextResponse.json({ error: e.message }, { status: 500, headers: cors })
  }
}
