import { DEFAULTS, LIMITS, SHAPES } from '@/lib/og3d/params';

const EXAMPLES: { label: string; query: string }[] = [
  { label: 'defaults', query: '' },
  { label: 'polished metal knot', query: 'shape=torusknot&color=c0c6d4&metalness=1&roughness=0.15' },
  { label: 'matte indigo sphere', query: 'shape=sphere&color=6366f1&roughness=0.9&metalness=0' },
  { label: 'transparent background', query: 'shape=icosahedron&color=22c55e&bg=transparent' },
  { label: 'wireframe torus', query: 'shape=torus&color=f97316&wireframe=1&bg=0b1020' },
  { label: 'named color + rotation', query: 'shape=capsule&color=cyan&rx=-35&ry=60&zoom=0.9' },
  { label: 'square, tighter crop', query: 'shape=dodecahedron&color=eab308&w=800&h=800&zoom=0.8' },
  { label: 'low light, high metal', query: 'shape=cone&color=f43f5e&light=0.6&metalness=0.85' },
];

const PARAM_DOCS: { name: string; aliases: string; values: string; fallback: string }[] = [
  { name: 'shape', aliases: 's', values: SHAPES.join(', '), fallback: DEFAULTS.shape },
  { name: 'color', aliases: 'c', values: 'rrggbb, rgb, or a named color', fallback: DEFAULTS.color },
  {
    name: 'bg',
    aliases: 'background',
    values: 'rrggbb, or transparent',
    fallback: DEFAULTS.background ?? 'transparent',
  },
  { name: 'roughness', aliases: 'r', values: '0 – 1', fallback: String(DEFAULTS.roughness) },
  { name: 'metalness', aliases: 'm', values: '0 – 1', fallback: String(DEFAULTS.metalness) },
  {
    name: 'width',
    aliases: 'w',
    values: `${LIMITS.minSize} – ${LIMITS.maxSize}`,
    fallback: String(DEFAULTS.width),
  },
  {
    name: 'height',
    aliases: 'h',
    values: `${LIMITS.minSize} – ${LIMITS.maxSize}`,
    fallback: String(DEFAULTS.height),
  },
  {
    name: 'rx / ry / rz',
    aliases: 'rotx, roty, rotz',
    values: 'degrees, -360 – 360',
    fallback: `${DEFAULTS.rotationX} / ${DEFAULTS.rotationY} / ${DEFAULTS.rotationZ}`,
  },
  { name: 'zoom', aliases: 'z', values: '0.25 – 4', fallback: String(DEFAULTS.zoom) },
  { name: 'light', aliases: 'l', values: '0 – 4', fallback: String(DEFAULTS.light) },
  { name: 'wireframe', aliases: 'wire', values: '0 or 1', fallback: 'off' },
  {
    name: 'ss',
    aliases: 'supersample',
    values: `1 – ${LIMITS.maxSupersample}`,
    fallback: String(DEFAULTS.supersample),
  },
];

export default function Home() {
  return (
    <main className="page">
      <p className="eyebrow">Serverless · WebGPU · Zero assets</p>
      <h1>3D OpenGraph Image Generator</h1>
      <p className="lede">
        <code>GET /api/og-3d</code> renders a Three.js primitive on a headless WebGPU device, encodes
        the frame as a PNG in-process, and serves it with immutable caching. No GLTF files, no
        textures, no headless browser — the whole scene is generated in memory from the query string.
      </p>

      <h2>Examples</h2>
      <div className="grid">
        {EXAMPLES.map((example) => {
          const url = example.query ? `/api/og-3d?${example.query}` : '/api/og-3d';
          return (
            <figure className="card" key={example.label}>
              {/* Intentionally a plain img: the endpoint under test should not be
                  proxied through the Next.js image optimizer. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={example.label} width={1200} height={630} loading="lazy" />
              <figcaption>{example.query || '(no parameters)'}</figcaption>
            </figure>
          );
        })}
      </div>

      <h2>Parameters</h2>
      <table>
        <thead>
          <tr>
            <th>Parameter</th>
            <th>Alias</th>
            <th>Accepts</th>
            <th>Fallback</th>
          </tr>
        </thead>
        <tbody>
          {PARAM_DOCS.map((param) => (
            <tr key={param.name}>
              <td>
                <code>{param.name}</code>
              </td>
              <td>
                <code>{param.aliases}</code>
              </td>
              <td>{param.values}</td>
              <td>
                <code>{param.fallback}</code>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="note">
        Every parameter is optional and every invalid value falls back to its default, so a bare
        request always returns an image. Crawlers do not retry a failed OpenGraph fetch.
      </p>
    </main>
  );
}
