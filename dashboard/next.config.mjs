/** @type {import('next').NextConfig} */
const nextConfig = {
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  basePath: "/admin",
  async rewrites() {
    return [
      // Allow client-side requests that omit the `/admin` basePath to still reach
      // the correct route handlers during runtime. This prevents 404s like
      // /api/dashboard-status when the application is deployed under /admin.
      {
        source: '/api/:path*',
        destination: '/api/:path*', // `/admin` is automatically prefixed after build
        // Disable basePath matching for the incoming request so that a request
        // to `/api/*` (without the base path) is matched.
        basePath: false,
      },
    ]
  },
}

export default nextConfig
