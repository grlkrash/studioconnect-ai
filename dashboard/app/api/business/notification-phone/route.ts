import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getBusiness } from '@/lib/getBusiness'

export async function GET(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) {
      console.warn('[Notification Phone] Business not found for GET request')
      return NextResponse.json({ error: 'business_not_found' }, { status: 404 })
    }

    const data = await prisma.business.findUnique({ 
      where: { id: biz.id }, 
      select: { notificationPhoneNumber: true } 
    })
    
    const phone = data?.notificationPhoneNumber || ''
    console.log(`[Notification Phone] Retrieved phone for business ${biz.id}: ${phone ? 'configured' : 'not configured'}`)
    
    return NextResponse.json({ notificationPhoneNumber: phone })
  } catch (error) {
    console.error('[Notification Phone] GET error:', error)
    return NextResponse.json({ error: 'internal_server_error' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const biz = await getBusiness(req)
    if (!biz) {
      console.warn('[Notification Phone] Business not found for PUT request')
      return NextResponse.json({ error: 'business_not_found' }, { status: 404 })
    }

    const body = await req.json().catch(() => null)
    const phone = body?.phoneNumber as string | undefined
    
    if (!phone || typeof phone !== 'string') {
      console.warn('[Notification Phone] Invalid payload:', body)
      return NextResponse.json({ error: 'invalid_payload' }, { status: 400 })
    }

    // Basic phone number validation (E.164 format expected)
    const phoneRegex = /^\+\d{1,3}\d{4,14}$/
    if (!phoneRegex.test(phone)) {
      console.warn('[Notification Phone] Invalid phone format:', phone)
      return NextResponse.json({ 
        error: 'invalid_phone_format',
        message: 'Phone number must be in E.164 format (e.g., +1234567890)'
      }, { status: 400 })
    }

    await prisma.business.update({ 
      where: { id: biz.id }, 
      data: { notificationPhoneNumber: phone } 
    })
    
    console.log(`[Notification Phone] Updated phone for business ${biz.id}: ${phone}`)
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('[Notification Phone] PUT error:', error)
    return NextResponse.json({ error: 'internal_server_error' }, { status: 500 })
  }
} 