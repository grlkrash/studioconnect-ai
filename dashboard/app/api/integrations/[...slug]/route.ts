import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'

// Base URL of the Express API (same container / Render service)
// Fallback to relative root when deployed behind the same domain.
const API_BASE = process.env.API_INTERNAL_URL || ''

async function proxy(req: NextRequest, urlPath: string) {
  // Build absolute target URL (keeps query string)
  const target = `${API_BASE}/api/integrations${urlPath}${req.nextUrl.search}`

  const init: RequestInit = {
    method: req.method,
    headers: {
      // Forward cookies / auth header so Express can re-auth the user
      cookie: req.headers.get('cookie') || '',
      authorization: req.headers.get('authorization') || '',
      'content-type': req.headers.get('content-type') || undefined,
    } as any,
    // For POST / PUT / etc forward body stream
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : (req as any).body,
  }

  const resp = await fetch(target, init as any)
  const data = await resp.arrayBuffer()
  return new NextResponse(data, {
    status: resp.status,
    headers: resp.headers,
  })
}

export async function GET(req: NextRequest, { params }: { params: { slug?: string[] } }) {
  const subPath = params.slug ? '/' + params.slug.join('/') : ''
  return proxy(req, subPath)
}
export async function POST(req: NextRequest, { params }: { params: { slug?: string[] } }) {
  const subPath = params.slug ? '/' + params.slug.join('/') : ''
  return proxy(req, subPath)
}
export async function DELETE(req: NextRequest, { params }: { params: { slug?: string[] } }) {
  const subPath = params.slug ? '/' + params.slug.join('/') : ''
  return proxy(req, subPath)
}
export async function PUT(req: NextRequest, { params }: { params: { slug?: string[] } }) {
  const subPath = params.slug ? '/' + params.slug.join('/') : ''
  return proxy(req, subPath)
} 