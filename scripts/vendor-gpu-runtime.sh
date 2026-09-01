#!/usr/bin/env sh
#
# Downloads vgpu's portable CPU (lavapipe) Vulkan renderer into a project-local
# cache so it can be traced into the serverless function bundle.
#
# A Vercel function has no GPU and no vendor Vulkan ICD, and its home directory
# is not a place vgpu can populate at runtime, so the renderer has to be present
# before the function is packaged. Run this during the build.
#
# Also vendors libvulkan.so.1 (the Vulkan *loader*). lavapipe is only an ICD;
# Dawn still needs the loader to read VK_ICD_FILENAMES and open that ICD.
#
# On non-Linux hosts this exits successfully so local builds are unaffected.

set -eu

CACHE_DIR="$(pwd)/.vgpu"
LIBS_DIR="$CACHE_DIR/libs"

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

install_vulkan_loader_deb() {
  if [ -e "$LIBS_DIR/libvulkan.so.1" ] || [ -e "$LIBS_DIR/libvulkan.so" ]; then
    return 0
  fi

  deb_arch="$(uname -m)"
  case "$deb_arch" in
    x86_64) deb_arch=amd64 ;;
    aarch64) deb_arch=arm64 ;;
    *) return 0 ;;
  esac

  tmp="$(mktemp -d)"
  url="https://deb.debian.org/debian/pool/main/v/vulkan-loader/libvulkan1_1.3.239.0-1_${deb_arch}.deb"
  echo "vendor-gpu-runtime: downloading Vulkan loader $url"
  if ! curl -fsSL -o "$tmp/libvulkan.deb" "$url"; then
    echo "vendor-gpu-runtime: WARNING could not download Vulkan loader" >&2
    rm -rf "$tmp"
    return 0
  fi

  mkdir -p "$LIBS_DIR"
  (
    cd "$tmp"
    ar x libvulkan.deb
    tar -xf data.tar.* 2>/dev/null || tar --zstd -xf data.tar.zst
  )
  find "$tmp" -name 'libvulkan.so*' -exec cp -L {} "$LIBS_DIR/" \;
  rm -rf "$tmp"
}

copy_system_vulkan_loader() {
  mkdir -p "$LIBS_DIR"
  for dir in /usr/lib64 /lib64 /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib /lib; do
    for name in libvulkan.so.1 libvulkan.so; do
      if [ -e "$dir/$name" ]; then
        cp -L "$dir/$name" "$LIBS_DIR/"
        echo "vendor-gpu-runtime: copied $dir/$name"
      fi
    done
  done
}

install_vulkan_loader_from_dnf() {
  if ! command -v dnf >/dev/null 2>&1 && ! command -v yum >/dev/null 2>&1; then
    return 0
  fi
  echo "vendor-gpu-runtime: installing vulkan-loader on the build image"
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y vulkan-loader >/dev/null 2>&1 || true
  else
    yum install -y vulkan-loader >/dev/null 2>&1 || true
  fi
}

# Default Vercel functions are x64; arm64 is for a future architecture switch.
install_renderer x64
install_renderer arm64

install_vulkan_loader_from_dnf
copy_system_vulkan_loader
install_vulkan_loader_deb

if [ ! -e "$LIBS_DIR/libvulkan.so.1" ] && [ ! -e "$LIBS_DIR/libvulkan.so" ]; then
  echo "vendor-gpu-runtime: WARNING no libvulkan.so.1 found; Dawn will not see lavapipe" >&2
fi

echo "vendor-gpu-runtime: contents"
find "$CACHE_DIR" -type f -exec ls -la {} \;
