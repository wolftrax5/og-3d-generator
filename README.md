# 3D OpenGraph Image Generator

A Next.js route that returns a PNG immediately, then replaces it with a
WebGPU frame rendered in a Vercel Sandbox.

```
GET /api/og-3d?shape=torusknot&color=6366f1&roughness=0.2&metalness=0.9
```

The first response is an inline SVG (isometric faces for the polyhedra,
gradients for the curved shapes) laid out by Satori via `ImageResponse`. That
response is cached for one minute. The same request publishes the parameters
to the `og-renders` queue. A private consumer forks a sandbox that already
has lavapipe and Dawn, runs `sandbox/render.mjs`, and stores the PNG in
Vercel Blob. The next request for that URL serves the stored frame with an
immutable cache.

Vercel Functions have no GPU. The sandbox does not either: it is a Linux
microVM, and the frame is lavapipe (Vulkan on the CPU). The guest can
`apt-get install` the Vulkan loader, which a function image cannot.

## How it works

1. `GET /api/og-3d` reads `request.nextUrl.searchParams` through
   `lib/og3d/params.ts`. Every parameter is optional and every invalid value
   falls back to a default, because an OpenGraph crawler will not retry a
   failed fetch.
2. If `og/<fingerprint>.png` is already in Blob, that PNG is returned with
   `Cache-Control: public, max-age=31536000, immutable`.
3. Otherwise the shape is drawn as SVG and `ImageResponse` rasterizes it.
   The preview is cached for 60 seconds, and `send('og-renders', job)`
   publishes the work. The idempotency key is the fingerprint, so repeated
   hits collapse into one delivery.
4. `app/api/queues/og-render` is invoked only by the queue. It keeps a named
   sandbox, `og-renderer`, snapshotted after the toolchain install, and
   forks a fresh VM per message.

The Satori preview ignores `rx` and `ry`, rotates only `rz`, and draws
`torusknot` as a torus. The sandbox frame honors the full parameter set,
including `rx`, `ry`, and `supersample`.

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

## Running locally

```bash
npm install
npm run dev            # http://localhost:3000
npm run typecheck
npm test               # parameter parsing and fallbacks
```

## Deploying to Vercel

The build command stays `next build`. The route needs two Vercel products
besides the function itself:

- **Blob**, so finished frames have a public URL. Connect a Blob store so
  `BLOB_READ_WRITE_TOKEN` is set. Without it the route still returns the
  Satori preview and the enqueue is a no-op failure in the logs.
- **Queues and Sandbox**, both authenticated with the deployment's OIDC
  token. Locally, `vercel link` and `vercel env pull` provide that token.
  `vercel dev` delivers queue messages to the consumer.

The consumer allows 800 seconds because the first sandbox boot installs
system packages and `npm install`s Dawn. Later messages fork the snapshot.
The plan has to allow that `maxDuration`.

```bash
vercel --prod
```

Remove any leftover `LD_LIBRARY_PATH`, `VGPU_*`, or `VK_*` variables and a
custom build command from the old in-function WebGPU deploy. Those belong
inside the sandbox now, and the guest sets them itself.
