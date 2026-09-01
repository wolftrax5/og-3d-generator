# 3D OpenGraph Image Generator

A single Next.js route handler that renders a Three.js primitive on a headless
WebGPU device and returns a PNG, with no assets and no headless browser.

```
GET /api/og-3d?shape=torusknot&color=6366f1&roughness=0.2&metalness=0.9
```

Everything in the scene is generated in memory from the query string:
`BoxGeometry`, `SphereGeometry`, `TorusKnotGeometry` and friends, a
`MeshStandardMaterial`, and a three-point light rig. No GLTF, no textures, no
HDR environment — a cold start pays for module load and device acquisition, not
for network fetches.

## How it works

1. `GET /api/og-3d` reads `request.nextUrl.searchParams`. Every parameter is
   optional and every invalid value falls back to a default, because an
   OpenGraph crawler will not retry a failed fetch.
2. `vgpu/node` acquires a Dawn-backed `GPUDevice`.
3. That device is handed to Three's `WebGPURenderer`, which is given a stub
   canvas object since there is no DOM.
4. A primitive is instantiated from the `shape` parameter, given a
   `MeshStandardMaterial` built from `color` / `roughness` / `metalness`, and
   framed by a camera derived from the geometry's bounding sphere so every shape
   fills a comparable part of the frame.
5. One frame is rendered into a `RenderTarget` at `supersample`× the output
   size.
6. The pixels are read back with `readRenderTargetPixelsAsync`, un-padded,
   box-filtered down to the output size, and encoded to PNG by
   `lib/og3d/png.ts` (a ~120-line encoder over `node:zlib`).
7. The response carries `Cache-Control: public, max-age=31536000, immutable`
   plus an `ETag` derived from the parameters.

The device, renderer and render targets are cached at module scope, so a warm
invocation only pays for the frame. Renders are serialized through a promise
queue: a Three.js `Renderer` holds mutable per-frame state, so concurrent
requests sharing one renderer would otherwise interleave.

## Two deviations from the original brief

**The package is `vgpu`, not `@vercel/vgpu`.** No package is published under
that name; the library from `vercel-labs/vgpu` is published as
[`vgpu`](https://www.npmjs.com/package/vgpu) (docs at
[vgpu.sh](https://vgpu.sh)).

**It uses `WebGPURenderer`, not `WebGLRenderer`.** These are mutually
exclusive: `WebGLRenderer` needs a WebGL context, which does not exist in a Node
serverless runtime, and vgpu provides a WebGPU device. `WebGPURenderer` from
`three/webgpu` accepts an externally owned `GPUDevice`, which is the seam vgpu
fits into. (`three/webgpu` also exports `WebGLRenderTarget` as an alias of
`RenderTarget`, so the render target in the brief is the same object either
way.)

## Parameters

| Parameter      | Alias                | Accepts                            | Default             |
| -------------- | -------------------- | ---------------------------------- | ------------------- |
| `shape`        | `s`                  | see below                          | `cube`              |
| `color`        | `c`                  | `rrggbb`, `rgb`, `#rrggbb`, name   | `ffffff`            |
| `bg`           | `background`         | `rrggbb`, or `transparent`/`none`  | `0b1020`            |
| `roughness`    | `r`                  | `0` – `1`                          | `0.35`              |
| `metalness`    | `m`                  | `0` – `1`                          | `0.15`              |
| `width`        | `w`                  | `64` – `2048`                      | `1200`              |
| `height`       | `h`                  | `64` – `2048`                      | `630`               |
| `rx` `ry` `rz` | `rotx` `roty` `rotz` | degrees, `-360` – `360`            | `-20`, `35`, `0`    |
| `zoom`         | `z`                  | `0.25` – `4`                       | `1`                 |
| `light`        | `l`                  | `0` – `4`                          | `1`                 |
| `wireframe`    | `wire`               | `0` / `1` (bare key means on)      | off                 |
| `ss`           | `supersample`        | `1` – `3`                          | `2`                 |

Shapes: `cube`, `sphere`, `torus`, `torusknot`, `cone`, `cylinder`, `capsule`,
`icosahedron`, `octahedron`, `tetrahedron`, `dodecahedron`, `ring`, `plane`.
Aliases: `box`, `ball`, `donut`, `knot`, `ico`, `octa`, `tetra`, `dodeca`,
`pill`, `quad`.

Named colors are a small Tailwind-ish set (`red`, `sky`, `indigo`, `emerald`, …)
for convenience in a hand-written URL.

Antialiasing is supersampling rather than MSAA: the frame renders at `ss`× and is
box-filtered on the CPU. It antialiases shading as well as silhouettes and does
not depend on how a given backend resolves a multisampled target for readback.
`ss` is automatically reduced when `width × height × ss²` would exceed the
render budget (6 MP), so the largest output is always renderable.

## Running locally

```bash
npm install
npm run dev            # http://localhost:3000
```

Render straight to a file, without a server:

```bash
node scripts/render.ts "shape=sphere&color=f97316&roughness=0.9" out.png
node scripts/inspect-png.ts out.png     # decode and sample pixels
node scripts/diagnose.ts                # per-stage timing of the pipeline
```

Check whether the host can render headless at all:

```bash
npm run gpu:doctor
```

`vgpu doctor` prints a JSON verdict and a prescription. Two common outcomes:

- **Missing Dawn runtime** — run `npm run gpu:install` (`vgpu install-dawn`).
- **No adapter / no GPU** (CI, containers) — run
  `npx vgpu install-software-renderer` for the portable CPU renderer.

### macOS older than 15

The Dawn binary in `webgpu@0.4.0` is built against the macOS 15 SDK and will not
`dlopen` on macOS 14 or earlier:

```
Symbol not found: _OBJC_CLASS_$_MTLLogStateDescriptor
  ... (built for macOS 15.0 which is newer than running OS)
```

On Darwin < 24 the renderer vendors `webgpu@0.3.0`'s arch-specific binary into
`.vgpu/macos14/` on `npm install` and on the first render, then points
`VGPU_DAWN_BINARY` at it. That cache survives later `npm install`s, unlike
`npm i --no-save webgpu@0.3.0`. An explicit `VGPU_DAWN_BINARY` still wins.

## Deploying to Vercel

The route runs on the Node.js runtime (`export const runtime = 'nodejs'`)
because Dawn is a native addon.

A Vercel function has no GPU and no vendor Vulkan ICD, so vgpu needs its
portable lavapipe (CPU) renderer **and** the shared libraries that renderer
`dlopen`s (`libvulkan.so.1`, `libdrm`, `libudev`, `libzstd`). Those are
downloaded at build time into a project-local `.vgpu/`, traced into the
function bundle, and picked up at runtime:

- `npm run vercel-build` runs `scripts/vendor-gpu-runtime.sh` before
  `next build`. Set the project's build command to `npm run vercel-build`.
  The vendor script installs lavapipe for Linux x64 and arm64.
- `next.config.ts` traces `.vgpu/**` and the whole `webgpu` package (native
  Dawn `.node` binaries) into `/api/og-3d`.
- `lib/og3d/renderer.ts` points `VGPU_CACHE_DIR` / `VGPU_DAWN_BINARY` at those
  files and sets `VGPU_ADAPTER=software` on Vercel so the function never waits
  for a GPU that is not there.

`architecture: "arm64"` is not accepted in this project's `vercel.json` by
Vercel's config API, so the function stays on the default x64 image. Stock
`webgpu` ships a `linux-x64.dawn.node`; vgpu's own portable Dawn prebuild is
arm64-only.

Recommended function configuration: raise memory (CPU scales with it — the
render is CPU-bound on lavapipe) and allow a generous `maxDuration` for cold
starts. Warm renders are fast, and the `immutable` response means each distinct
URL is rendered once and served from the Edge cache thereafter.

**Status of this path:** the render pipeline is verified end to end on a real
GPU (see below), and the Linux/CPU-renderer configuration above follows vgpu's
documented mechanism, but it has not been executed on a Vercel deployment from
this machine. Validate it with `vercel build && vercel deploy --prebuilt` and
check the function logs for `VGPU-NODE-NO-ADAPTER` or
`VGPU-NODE-PREBUILD-MISSING`, which are the two failure modes to expect.

## Verification

`npm test` covers the CPU-side logic that would otherwise be hard to see:
parameter fallbacks and clamping, the render budget invariant across every
reachable size, PNG structure and lossless round-trip, 256-byte row un-padding,
and alpha-weighted downsampling.

The GPU path was exercised for real (Metal, macOS 14 with the Dawn override
above), which surfaced three bugs worth recording:

1. **A double sRGB encode.** A `RenderTarget` tagged `SRGBColorSpace` becomes an
   `rgba8unorm-srgb` texture, so the hardware encodes on write *in addition to*
   the output pass driven by `outputColorSpace`. `bg=0b1020` came back as
   `#3b4763`. The target is now linear, leaving exactly one encode; the
   background is byte-exact.
2. **`Renderer.init()` needs `requestAnimationFrame`.** Three's animation loop
   reads `self` when it is constructed and calls it immediately. A stub is
   installed for the duration of `init()` and removed afterwards, so no
   permanent `self` global is left behind for other libraries to misread as a
   browser.
3. **The render budget was not enforceable.** `2048×2048` at `ss=1` exceeded the
   original 4 MP cap with no way to comply, since the factor cannot go below 1.
   The cap is now above `maxSize²` and the invariant is covered by a test.

HTTP behaviour checked against `next start`: PNG content type, the immutable
`Cache-Control`, `ETag` with a `304` on revalidation, an image returned for a
bare request and for deliberately malformed parameters, and eight concurrent
requests all returning their own correct shape through the serialized renderer.
