import { NextRequest, NextResponse } from 'next/server'

// This middleware checks for the Global Privacy Control (GPC) signal
// as outlined in the compliance roadmap (Task C-1c).
// See: https://globalprivacycontrol.org/
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

  /* ORIGINAL AUTH CODE (COMMENTED OUT FOR TESTING)
  // Check for authentication token
  const token = request.cookies.get('token')?.value
  
  // Public paths that don't require authentication (after /admin prefix is stripped)
  const publicPaths = ['/login']
  const isPublicPath = publicPaths.includes(pathname)
  
  console.log(`[MIDDLEWARE] Token exists: ${!!token}, Is public path: ${isPublicPath}, Path: ${pathname}`)
  
  // If no token and trying to access protected route, redirect to login
  if (!token && !isPublicPath) {
    console.log(`[MIDDLEWARE] No token, redirecting to login`)
    const loginUrl = new URL('/login', request.url)
    return NextResponse.redirect(loginUrl)
  }
  
  // If has token and on login page, redirect to dashboard root
  if (token && pathname === '/login') {
    console.log(`[MIDDLEWARE] Has token on login page, redirecting to dashboard`)
    const dashboardUrl = new URL('/', request.url)
    return NextResponse.redirect(dashboardUrl)
  }

  console.log(`[MIDDLEWARE] Allowing request to proceed`)
  return NextResponse.next()
  */
}

// This config ensures the middleware runs on all pages within the dashboard
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api routes (starting with /api/)
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!api|_next/static|_next/image|favicon.ico).*)',
  ],
} 