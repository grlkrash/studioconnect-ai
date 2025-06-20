/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/admin",
  // Removed output: 'export' to enable API routes and dynamic content
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  typescript: {
    ignoreBuildErrors: true
  },
  eslint: {
    ignoreDuringBuilds: true
  },
  // Enable standalone mode for production deployment
  output: 'standalone'
}

export default nextConfig
