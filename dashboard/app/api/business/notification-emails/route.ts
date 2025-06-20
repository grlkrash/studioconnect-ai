import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) {
      console.warn('[Notification Emails] Business not found for GET request')
      return NextResponse.json({ error: 'business_not_found' }, { status: 404 })
    }

    const data = await prisma.business.findUnique({ 
      where: { id: biz.id }, 
      select: { notificationEmails: true } 
    })
    
    const emails = data?.notificationEmails || []
    console.log(`[Notification Emails] Retrieved ${emails.length} emails for business ${biz.id}`)
    
    return NextResponse.json({ notificationEmails: emails })
  } catch (error) {
    console.error('[Notification Emails] GET error:', error)
    return NextResponse.json({ error: 'internal_server_error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) {
      console.warn('[Notification Emails] Business not found for PUT request')
      return NextResponse.json({ error: 'business_not_found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    if (!body || !Array.isArray(body.emails)) {
      console.warn('[Notification Emails] Invalid payload:', body)
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    const invalidEmails = body.emails.filter((email: any) => 
      typeof email !== 'string' || !emailRegex.test(email)
    )
    
    if (invalidEmails.length > 0) {
      console.warn('[Notification Emails] Invalid email addresses:', invalidEmails)
      return NextResponse.json({ 
        error: 'invalid_email_format', 
        invalidEmails 
      }, { status: 400 })
    }

    await prisma.business.update({ 
      where: { id: biz.id }, 
      data: { notificationEmails: body.emails as string[] } 
    })
    
    console.log(`[Notification Emails] Updated emails for business ${biz.id}:`, body.emails)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notification Emails] PUT error:', error)
    return NextResponse.json({ error: 'internal_server_error' }, { status: 500 })
  }
} 