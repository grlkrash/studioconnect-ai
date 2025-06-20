/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/admin",
  output: 'export', // Static export for production
  trailingSlash: true,
  images: {
    unoptimized: true
  },
  env: {
    DATABASE_URL: process.env.DATABASE_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || "http://localhost:3000",
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET || "development-secret"
  },
  // Remove API routes since Express.js handles all APIs
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:3000/api/:path*' // Proxy to Express.js
      }
    ]
  }
}

export default nextConfig
