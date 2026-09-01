#!/usr/bin/env sh
#
# Downloads vgpu's portable CPU (lavapipe) Vulkan renderer into a project-local
# cache so it can be traced into the serverless function bundle.
#
# A Vercel function has no GPU and no vendor Vulkan ICD, and its home directory
# is not a place vgpu can populate at runtime, so the renderer has to be present
# before the function is packaged. Run this during the build.
#
# Vercel builds on Linux x64 but the og-3d function is configured for arm64
# (see vercel.json). The default `vgpu install-software-renderer` CLI installs
# for the build host arch (x64), so we also install arm64 explicitly here.
#
# On non-Linux hosts this exits successfully so local builds are unaffected.

set -eu

CACHE_DIR="$(pwd)/.vgpu"

if [ "$(uname -s)" != "Linux" ]; then
  echo "vendor-gpu-runtime: not Linux, skipping (local host uses its own GPU)"
  exit 0
fi

export VGPU_CACHE_DIR="$CACHE_DIR"

install_renderer() {
  arch="$1"
  echo "vendor-gpu-runtime: installing lavapipe for linux/${arch} into $CACHE_DIR"
  node --input-type=module -e "
    import { installSoftwareRenderer } from '@vgpu/adapter-node/install-software-renderer';
    const result = await installSoftwareRenderer({ arch: '${arch}', platform: 'linux' });
    console.log('vendor-gpu-runtime: linux/${arch} lavapipe ready at', result.path);
  "
}

# Build host is x64; keep x64 in the cache for CI/diagnostics on the same arch.
install_renderer x64
# The deployed function runs on arm64 — this is the copy it will look up at runtime.
install_renderer arm64

echo "vendor-gpu-runtime: contents"
find "$CACHE_DIR" -type f -exec ls -la {} \;
