/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Exclude ws from bundling - use Node.js native module (Next.js 14 syntax)
    serverComponentsExternalPackages: ['ws'],
  },
}
module.exports = nextConfig
