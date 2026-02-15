/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Exclude ws from bundling - use Node.js native module (Next.js 14 syntax)
    serverComponentsExternalPackages: ['ws'],
    instrumentationHook: true,
  },
  env: {
    OPENCLAW_GATEWAY_URL: process.env.OPENCLAW_GATEWAY_URL,
    OPENCLAW_HOOKS_TOKEN: process.env.OPENCLAW_HOOKS_TOKEN,
  },
}
module.exports = nextConfig
