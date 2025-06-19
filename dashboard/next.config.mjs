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
        // Destination must live within the configured `basePath`.
        // We manually include `/admin` to comply with Next.js 14 rewrite rules.
        destination: '/admin/api/:path*',
        // We intentionally include the base path in the destination so no automatic
        // prefixing occurs.  By omitting `basePath: false` the rewrite complies
        // with Next.js 14 validation rules.
      },
      // Additional rewrite to handle admin API calls correctly
      {
        source: '/admin/api/:path*',
        destination: '/admin/api/:path*',
      },
    ]
  },
  // Add proper API routing configuration
  async headers() {
    return [
      {
        source: '/admin/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, max-age=0',
          },
        ],
      },
    ]
  },
}

export default nextConfig
