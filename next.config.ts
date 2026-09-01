import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Dawn ships as a native .node addon, so these packages must not be bundled;
  // they are required from node_modules at runtime instead.
  serverExternalPackages: ['vgpu', '@vgpu/adapter-node', '@vgpu/core', 'webgpu'],

  outputFileTracingIncludes: {
    // File tracing follows `import`/`require`, so it cannot see either the
    // Dawn binary (chosen at runtime by platform) or the vendored CPU renderer
    // (a data file). Both have to be listed explicitly or the deployed
    // function has no way to create a device.
    '/api/og-3d': ['./.vgpu/**/*', './node_modules/webgpu/dist/linux-*.dawn.node'],
  },
};

export default nextConfig;
