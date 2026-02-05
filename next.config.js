/** @type {import('next').NextConfig} */
const nextConfig = {
  // Exclude ws from bundling - use Node.js native module
  serverExternalPackages: ['ws'],
  
  // Ensure API routes run in Node.js runtime (not Edge)
  experimental: {
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
}
module.exports = nextConfig
