import { NextRequest, NextResponse } from 'next/server'

// MIDDLEWARE COMPLETELY DISABLED TO FIX REDIRECT LOOP
export function middleware(request: NextRequest) {
  // DO NOTHING - JUST ALLOW ALL REQUESTS
  return NextResponse.next()
}

// DISABLE MATCHER TO PREVENT MIDDLEWARE FROM RUNNING
export const config = {
  matcher: []
}

/* ORIGINAL MIDDLEWARE CODE (COMPLETELY DISABLED)
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  // Skip middleware for static files, API routes, and favicon
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/api/')
  ) {
    return NextResponse.next()
  }

  // Check for the GPC header
  const gpcHeader = request.headers.get('Sec-GPC')
  if (gpcHeader === '1') {
    console.log('Global Privacy Control (GPC) signal detected.')
  }

  console.log(`[MIDDLEWARE] Processing pathname: ${pathname}`)

  // TEMPORARILY DISABLE AUTH CHECKS TO TEST BASIC ROUTING
  // Just log and allow all requests to proceed
  const token = request.cookies.get('token')?.value
  console.log(`[MIDDLEWARE] Token exists: ${!!token}, Path: ${pathname}`)
  console.log(`[MIDDLEWARE] Allowing request to proceed (auth disabled for testing)`)
  
  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
}
*/ 