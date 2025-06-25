import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  
  console.log(`[MIDDLEWARE] Processing request: ${pathname}`)
  
  // Skip middleware for static files, API routes, and favicon
  if (
    pathname.startsWith('/_next/') ||
    pathname.startsWith('/favicon.ico') ||
    pathname.startsWith('/static/') ||
    pathname.startsWith('/api/') ||
    pathname.includes('.')
  ) {
    console.log(`[MIDDLEWARE] Skipping static/API path: ${pathname}`)
    return NextResponse.next()
  }

  // Check for authentication token
  const token = request.cookies.get('token')?.value
  console.log(`[MIDDLEWARE] Token present: ${!!token}`)
  
  // CRITICAL FIX: server.ts strips /admin prefix, so:
  // - Browser requests /admin/login -> server.ts routes to Next.js as /login
  // - Browser requests /admin/ -> server.ts routes to Next.js as /
  // - When we redirect from middleware, we need to redirect to the FULL path (with /admin)
  
  // Public paths that don't require authentication (as seen by Next.js after prefix stripping)
  const publicPaths = ['/login']
  const isPublicPath = publicPaths.includes(pathname)
  
  console.log(`[MIDDLEWARE] Path: ${pathname}, Is public: ${isPublicPath}, Has token: ${!!token}`)
  
  // If no token and trying to access protected route, redirect to login
  if (!token && !isPublicPath) {
    console.log(`[MIDDLEWARE] No token for protected route, redirecting to login`)
    // CRITICAL: Redirect to the full /admin/login path since server.ts will strip it
    const loginUrl = new URL('/admin/login', request.url)
    return NextResponse.redirect(loginUrl)
  }
  
  // If has token and on login page, redirect to dashboard root  
  if (token && pathname === '/login') {
    console.log(`[MIDDLEWARE] Has token on login page, redirecting to dashboard`)
    // CRITICAL: Redirect to the full /admin/ path since server.ts will strip it
    const dashboardUrl = new URL('/admin/', request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  console.log(`[MIDDLEWARE] Allowing request to proceed`)
  return NextResponse.next()
}

// Apply middleware to all routes except the excluded ones
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - api (API routes)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
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