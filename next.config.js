/** @type {import('next').NextConfig} */
const withSerwist = require('@serwist/next').default({
  swSrc: 'src/app/sw.ts',
  swDest: 'public/sw.js',
  disable: process.env.NODE_ENV !== 'production',
  exclude: [/\/api\//],
});

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
  // Ensure we are NOT using static export if we rely on dynamic routes/api
  // output: 'export', // Commented out to ensure dynamic server mode
  webpack: (config, { isServer }) => {
    if (isServer) {
      // Agent runtime modules use Node.js APIs (fs, path, child_process)
      // These are only called server-side (from orchestrator/instrumentation)
      // but webpack still tries to resolve them. Mark as external.
      config.externals = config.externals || [];
      config.externals.push({
        'fs': 'commonjs fs',
        'fs/promises': 'commonjs fs/promises',
        'path': 'commonjs path',
        'child_process': 'commonjs child_process',
        'util': 'commonjs util',
      });
    }
    return config;
  },
};

module.exports = withSerwist(nextConfig);
