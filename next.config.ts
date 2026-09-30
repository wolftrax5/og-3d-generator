import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The consumer reads these at runtime and uploads them into the sandbox.
  outputFileTracingIncludes: {
    '/api/queues/og-render': ['./sandbox/**/*'],
  },
  serverExternalPackages: ['@vercel/sandbox', '@vercel/queue', '@vercel/blob'],
};

export default nextConfig;
