/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: "/admin",
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
  // Remove standalone output since we're integrating with Express
  // output: 'standalone'
}

export default nextConfig
