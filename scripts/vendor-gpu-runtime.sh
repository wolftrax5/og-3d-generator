#!/usr/bin/env sh
#
# Downloads vgpu's portable CPU (lavapipe) Vulkan renderer into a project-local
# cache so it can be traced into the serverless function bundle.
#
# A Vercel function has no GPU and no vendor Vulkan ICD, and its home directory
# is not a place vgpu can populate at runtime, so the renderer has to be present
# before the function is packaged. Run this during the build.
#
# Also vendors the Vulkan *loader* (libvulkan.so.1) and the shared libraries
# lavapipe itself needs (libdrm, libudev, libzstd, …). Without those,
# requestAdapter() returns null and the route 500s with VGPU-NODE-NO-ADAPTER.
#
# On non-Linux hosts this exits successfully so local builds are unaffected.

set -eu

CACHE_DIR="$(pwd)/.vgpu"
LIBS_DIR="$CACHE_DIR/libs"
LVP_VERSION="25.0.7-vgpu.1"

if [ "$(uname -s)" != "Linux" ]; then
  echo "vendor-gpu-runtime: not Linux, skipping (local host uses its own GPU)"
  exit 0
fi

export VGPU_CACHE_DIR="$CACHE_DIR"
mkdir -p "$LIBS_DIR"

install_renderer() {
  arch="$1"
  echo "vendor-gpu-runtime: installing lavapipe for linux/${arch} into $CACHE_DIR"
  node --input-type=module -e "
    import { installSoftwareRenderer } from '@vgpu/adapter-node/install-software-renderer';
    const result = await installSoftwareRenderer({ arch: '${arch}', platform: 'linux' });
    console.log('vendor-gpu-runtime: linux/${arch} lavapipe ready at', result.path);
  "
}

is_system_lib() {
  case "$(basename "$1")" in
    libc.so.*|ld-linux*|libpthread.so.*|libdl.so.*|libm.so.*|librt.so.*|linux-vdso.so.*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

copy_file_to_libs() {
  src="$1"
  [ -e "$src" ] || return 0
  dest="$LIBS_DIR/$(basename "$src")"
  if [ ! -e "$dest" ]; then
    cp -L "$src" "$dest"
    echo "vendor-gpu-runtime: copied $src"
  fi
}

copy_ldd_closure() {
  binary="$1"
  [ -e "$binary" ] || return 0
  command -v ldd >/dev/null 2>&1 || return 0
  ldd "$binary" 2>/dev/null | while IFS= read -r line; do
    case "$line" in
      *" not found"*) echo "vendor-gpu-runtime: WARNING $line" >&2 ;;
    esac
    lib=$(printf '%s\n' "$line" | awk '/=> \// {print $3}')
    [ -n "$lib" ] || continue
    if is_system_lib "$lib"; then continue; fi
    copy_file_to_libs "$lib"
  done
}

copy_system_libs() {
  for name in libvulkan.so.1 libvulkan.so libdrm.so.2 libudev.so.1 libzstd.so.1 libz.so.1 libcap.so.2; do
    for dir in /usr/lib64 /lib64 /usr/lib/x86_64-linux-gnu /usr/lib/aarch64-linux-gnu /usr/lib /lib; do
      if [ -e "$dir/$name" ]; then
        copy_file_to_libs "$dir/$name"
      fi
    done
  done
}

install_vulkan_deps_from_dnf() {
  if ! command -v dnf >/dev/null 2>&1 && ! command -v yum >/dev/null 2>&1; then
    return 0
  fi
  echo "vendor-gpu-runtime: installing Vulkan/lavapipe shared libraries on the build image"
  pkgs="vulkan-loader libdrm systemd-libs libzstd zlib libcap"
  if command -v dnf >/dev/null 2>&1; then
    dnf install -y $pkgs >/dev/null 2>&1 || true
  else
    yum install -y $pkgs >/dev/null 2>&1 || true
  fi
}

extract_deb_libs() {
  url="$1"
  tmp="$(mktemp -d)"
  echo "vendor-gpu-runtime: downloading $url"
  if ! curl -fsSL -o "$tmp/pkg.deb" "$url"; then
    echo "vendor-gpu-runtime: WARNING could not download $url" >&2
    rm -rf "$tmp"
    return 0
  fi
  (
    cd "$tmp"
    ar x pkg.deb
    tar -xf data.tar.* 2>/dev/null || tar --zstd -xf data.tar.zst
  )
  find "$tmp" \( -name '*.so' -o -name '*.so.*' \) -exec cp -L {} "$LIBS_DIR/" \;
  rm -rf "$tmp"
}

install_vulkan_deps_from_debs() {
  deb_arch="$(uname -m)"
  case "$deb_arch" in
    x86_64) deb_arch=amd64 ;;
    aarch64) deb_arch=arm64 ;;
    *) return 0 ;;
  esac

  # Ubuntu 20.04 / glibc 2.31 — loads on Amazon Linux 2023 (glibc 2.34).
  # Only fill gaps so a newer loader copied from the build image is kept.
  if [ ! -e "$LIBS_DIR/libvulkan.so.1" ] && [ ! -e "$LIBS_DIR/libvulkan.so" ]; then
    extract_deb_libs "http://archive.ubuntu.com/ubuntu/pool/main/v/vulkan-loader/libvulkan1_1.2.131.2-1_${deb_arch}.deb"
  fi
  if [ ! -e "$LIBS_DIR/libdrm.so.2" ]; then
    extract_deb_libs "http://archive.ubuntu.com/ubuntu/pool/main/libd/libdrm/libdrm2_2.4.107-8ubuntu1~20.04.2_${deb_arch}.deb"
  fi
  if [ ! -e "$LIBS_DIR/libudev.so.1" ]; then
    extract_deb_libs "http://archive.ubuntu.com/ubuntu/pool/main/s/systemd/libudev1_245.4-4ubuntu3.24_${deb_arch}.deb"
  fi
  if [ ! -e "$LIBS_DIR/libzstd.so.1" ]; then
    extract_deb_libs "http://archive.ubuntu.com/ubuntu/pool/main/libz/libzstd/libzstd1_1.4.4+dfsg-3ubuntu0.1_${deb_arch}.deb"
  fi
  if [ ! -e "$LIBS_DIR/libz.so.1" ]; then
    extract_deb_libs "http://archive.ubuntu.com/ubuntu/pool/main/z/zlib/zlib1g_1.2.11.dfsg-2ubuntu1.5_${deb_arch}.deb"
  fi
  if [ ! -e "$LIBS_DIR/libcap.so.2" ]; then
    extract_deb_libs "http://archive.ubuntu.com/ubuntu/pool/main/libc/libcap2/libcap2_2.32-1_${deb_arch}.deb"
  fi
}

# Default Vercel functions are x64; arm64 is for a future architecture switch.
install_renderer x64
install_renderer arm64

install_vulkan_deps_from_dnf
copy_system_libs
install_vulkan_deps_from_debs

LVP_X64="$CACHE_DIR/vgpu/software-renderer/$LVP_VERSION/linux-x64/libvulkan_lvp.so"
copy_ldd_closure "$LVP_X64"
copy_ldd_closure "$LIBS_DIR/libvulkan.so.1"
for so in "$LIBS_DIR"/*; do
  copy_ldd_closure "$so"
done

if [ ! -e "$LIBS_DIR/libvulkan.so.1" ] && [ ! -e "$LIBS_DIR/libvulkan.so" ]; then
  echo "vendor-gpu-runtime: ERROR no libvulkan.so.1 found; Dawn will not see lavapipe" >&2
  exit 1
fi

for required in libdrm.so.2 libudev.so.1 libzstd.so.1; do
  if [ ! -e "$LIBS_DIR/$required" ]; then
    echo "vendor-gpu-runtime: ERROR missing $required (lavapipe will dlopen-fail on Vercel)" >&2
    exit 1
  fi
done

echo "vendor-gpu-runtime: contents"
find "$CACHE_DIR" -type f -exec ls -la {} \;
