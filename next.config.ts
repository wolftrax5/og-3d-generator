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
    //
    // The function runs on arm64 (vercel.json); list both Linux Dawn binaries
    // so the trace is explicit, plus the whole .vgpu tree (arm64 lavapipe is
    // installed at build time even though the build host is x64).
    '/api/og-3d': [
      './.vgpu/**/*',
      './node_modules/webgpu/dist/linux-arm64.dawn.node',
      './node_modules/webgpu/dist/linux-x64.dawn.node',
    ],
  },
};

export default nextConfig;
