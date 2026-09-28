# 3D OpenGraph Image Generator

A single Next.js route handler that draws a shaded primitive and returns a PNG,
using `ImageResponse` from `next/og` (Satori under the hood).

```
GET /api/og-3d?shape=torusknot&color=6366f1&roughness=0.2&metalness=0.9
```

Each shape is an inline SVG — isometric faces for the polyhedra, gradients for
the curved shapes — laid out by Satori and rasterized to PNG. There is no GPU,
no native addon and no headless browser, so the route deploys as a plain
Next.js function.

## How it works

1. `GET /api/og-3d` reads `request.nextUrl.searchParams` through
   `lib/og3d/params.ts`. Every parameter is optional and every invalid value
   falls back to a default, because an OpenGraph crawler will not retry a
   failed fetch.
2. The shape is drawn as SVG. `color`, `metalness` and `light` pick the
   highlight, mid and shadow tones; `roughness` moves the highlight stop of
   the curved shapes' gradient.
3. `ImageResponse` renders the layout to a PNG at `width` × `height`.
4. The response carries `Cache-Control: public, max-age=31536000, immutable`
   plus an `ETag` derived from the parameters, and answers a matching
   `If-None-Match` with `304`.

This is a stylized 2D drawing, not a 3D render: `rx` and `ry` are accepted but
have no effect, `rz` rotates the drawing in the image plane, and `torusknot`
is drawn as a torus.

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
| `rz`           | `rotz`               | degrees, `-360` – `360`            | `0`                 |
| `zoom`         | `z`                  | `0.25` – `4`                       | `1`                 |
| `light`        | `l`                  | `0` – `4`                          | `1`                 |
| `wireframe`    | `wire`               | `0` / `1` (bare key means on)      | off                 |

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

No special configuration: the default build command (`next build`) and the
default Node.js runtime are all this needs.

```bash
vercel --prod
```

If the project previously used the WebGPU version, set the Build Command back
to the default and remove any `LD_LIBRARY_PATH`, `VGPU_*` or `VK_*`
environment variables.
