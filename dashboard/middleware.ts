import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// This middleware checks for the Global Privacy Control (GPC) signal
// as outlined in the compliance roadmap (Task C-1c).
// See: https://globalprivacycontrol.org/
export function middleware(request: NextRequest) {
  // Check for the GPC header.
  const gpcHeader = request.headers.get('Sec-GPC')

  if (gpcHeader === '1') {
    // TODO: The user has signaled their preference to opt-out of sale/sharing.
    // An API call or Server Action should be invoked here to persist this preference
    // in the user's record, as per task C-1c in the compliance roadmap.
    console.log('Global Privacy Control (GPC) signal detected.')

    // The response can be modified here to set a cookie or header that
    // client-side components can react to, while the preference is
    // being saved asynchronously.
  }

  return NextResponse.next()
}

// This config ensures the middleware runs on all pages and API routes
// within the dashboard, excluding static assets.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
} 