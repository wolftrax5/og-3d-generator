#!/usr/bin/env sh
#
# Downloads vgpu's portable CPU (lavapipe) Vulkan renderer into a project-local
# cache so it can be traced into the serverless function bundle.
#
# A Vercel function has no GPU and no vendor Vulkan ICD, and its home directory
# is not a place vgpu can populate at runtime, so the renderer has to be present
# before the function is packaged. Run this during the build.
#
# The download only exists for Linux x64 and arm64; on any other platform this
# exits successfully so local builds are unaffected.

set -eu

CACHE_DIR="$(pwd)/.vgpu"

if [ "$(uname -s)" != "Linux" ]; then
  echo "vendor-gpu-runtime: not Linux, skipping (local host uses its own GPU)"
  exit 0
fi

echo "vendor-gpu-runtime: installing software renderer into $CACHE_DIR"
VGPU_CACHE_DIR="$CACHE_DIR" npx --yes vgpu install-software-renderer

echo "vendor-gpu-runtime: contents"
find "$CACHE_DIR" -type f -exec ls -la {} \;
