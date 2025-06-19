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
    ]
  },
}

export default nextConfig
