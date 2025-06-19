import { NextRequest, NextResponse } from 'next/server'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    // Reuse logic from /api/auth/me – minimal version
    const business = await getBusiness(req)

    // Return same user parsing method
    const auth = req.headers.get('authorization') || req.headers.get('Authorization') || ''
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : undefined

    let user: any = null
    if (token) {
      try {
        const base64 = token.split('.')[1]
        const json = Buffer.from(base64, 'base64').toString('utf-8')
        user = JSON.parse(json)
      } catch {}
    }

    return NextResponse.json({ businessId: business?.id, user })
  } catch (err) {
    console.error('[ME]', err)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
} 