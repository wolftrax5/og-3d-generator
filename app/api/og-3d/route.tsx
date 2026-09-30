import { ImageResponse } from 'next/og';
import type { NextRequest } from 'next/server';

import { findCachedPng } from '@/lib/og3d/cache';
import { enqueueRender } from '@/lib/og3d/enqueue';
import { jobKey, toJob } from '@/lib/og3d/job';
import { parseParams, type OgParams, type Shape } from '@/lib/og3d/params';

// The response is derived from the query string, which the Edge cache keys on.
export const dynamic = 'force-dynamic';

const FINAL_CACHE = 'public, max-age=31536000, immutable';
/** The Satori frame is a stand-in. Keep it short so the GPU PNG can replace it. */
const PREVIEW_CACHE = 'public, max-age=60, stale-while-revalidate=600';

export async function GET(request: NextRequest): Promise<Response> {
  const params = parseParams(request.nextUrl.searchParams);
  const job = toJob(params);
  const key = jobKey(job);
  const finalEtag = `"${key}"`;
  const previewEtag = `W/"${key}-satori"`;
  const inm = request.headers.get('if-none-match');

  try {
    const cached = await findCachedPng(job);
    if (cached) {
      if (inm === finalEtag) {
        return new Response(null, {
          status: 304,
          headers: { 'Cache-Control': FINAL_CACHE, ETag: finalEtag },
        });
      }
      const upstream = await fetch(cached.url);
      if (upstream.ok) {
        return new Response(await upstream.arrayBuffer(), {
          headers: {
            'Content-Type': 'image/png',
            'Cache-Control': FINAL_CACHE,
            ETag: finalEtag,
          },
        });
      }
      console.error('og-3d: cached png fetch failed', upstream.status);
    }
  } catch (error) {
    console.error('og-3d: cache read failed', error);
  }

  // Idempotent: repeated preview hits do not enqueue a second render.
  await enqueueRender(params);

  if (inm === previewEtag) {
    return new Response(null, {
      status: 304,
      headers: { 'Cache-Control': PREVIEW_CACHE, ETag: previewEtag },
    });
  }

  try {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            background: params.background ? `#${params.background}` : 'transparent',
          }}
        >
          <ShapeArt params={params} />
        </div>
      ),
      {
        width: params.width,
        height: params.height,
        headers: { 'Cache-Control': PREVIEW_CACHE, ETag: previewEtag },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('og-3d: render failed', error);

    // Never cache a failure: the next request should get a real attempt.
    return new Response(JSON.stringify({ error: 'render failed', detail: message }, null, 2), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      },
    });
  }
}

type Tone = 'hi' | 'mid' | 'lo';
type Facet = [points: string, tone: Tone];

function radialFacets(sides: number, tones: Tone[]): Facet[] {
  const points = Array.from({ length: sides }, (_, i) => {
    const angle = (i / sides) * 2 * Math.PI - Math.PI / 2;
    return `${(82 * Math.cos(angle)).toFixed(1)},${(82 * Math.sin(angle)).toFixed(1)}`;
  });
  return points.map((p, i) => [`0,0 ${p} ${points[(i + 1) % sides]}`, tones[i % tones.length]!]);
}

const FACETS: Partial<Record<Shape, Facet[]>> = {
  cube: [
    ['0,-80 70,-40 0,0 -70,-40', 'hi'],
    ['-70,-40 0,0 0,80 -70,40', 'mid'],
    ['70,-40 0,0 0,80 70,40', 'lo'],
  ],
  octahedron: [
    ['0,-85 -60,0 0,15', 'hi'],
    ['0,-85 60,0 0,15', 'mid'],
    ['-60,0 0,15 0,85', 'mid'],
    ['60,0 0,15 0,85', 'lo'],
  ],
  tetrahedron: [
    ['0,-80 -75,60 10,30', 'hi'],
    ['0,-80 75,60 10,30', 'lo'],
    ['-75,60 75,60 10,30', 'mid'],
  ],
  icosahedron: radialFacets(6, ['hi', 'hi', 'mid', 'lo', 'lo', 'mid']),
  dodecahedron: radialFacets(5, ['hi', 'mid', 'lo', 'lo', 'mid']),
  plane: [['-85,10 20,-45 85,-10 -20,45', 'mid']],
};

/** Mixes toward white for t > 0 and toward black for t < 0. */
function tone(hex: string, t: number): string {
  const n = Number.parseInt(hex, 16);
  const target = t > 0 ? 255 : 0;
  const k = Math.min(1, Math.abs(t));
  const channel = (shift: number) => {
    const c = (n >> shift) & 255;
    return Math.round(c + (target - c) * k);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function ringPath(rx: number, ry: number, irx: number, iry: number): string {
  return (
    `M ${-rx} 0 A ${rx} ${ry} 0 1 0 ${rx} 0 A ${rx} ${ry} 0 1 0 ${-rx} 0 Z ` +
    `M ${-irx} 0 A ${irx} ${iry} 0 1 0 ${irx} 0 A ${irx} ${iry} 0 1 0 ${-irx} 0 Z`
  );
}

function ShapeArt({ params }: { params: OgParams }) {
  const { color, metalness, roughness, light, wireframe, zoom, rotationZ } = params;
  const size = Math.round((Math.min(params.width, params.height) * 0.75) / zoom);

  const colors: Record<Tone, string> = {
    hi: tone(color, Math.min(1, (0.25 + 0.5 * metalness) * light)),
    mid: tone(color, (light - 1) * 0.3 - 0.15),
    lo: tone(color, -(0.45 + 0.35 * metalness)),
  };

  const paint = (fill: string) =>
    wireframe ? { fill: 'none', stroke: colors.hi, strokeWidth: 2 } : { fill };

  const facets = FACETS[params.shape];
  let body;

  if (facets) {
    body = facets.map(([points, t], i) => <polygon key={i} points={points} {...paint(colors[t])} />);
  } else {
    switch (params.shape) {
      case 'torus':
      case 'torusknot':
        body = <path d={ringPath(85, 55, 40, 20)} fillRule="evenodd" {...paint('url(#radial)')} />;
        break;
      case 'ring':
        body = <path d={ringPath(85, 45, 62, 30)} fillRule="evenodd" {...paint('url(#radial)')} />;
        break;
      case 'cone':
        body = [
          <polygon key="side" points="0,-85 70,55 -70,55" {...paint('url(#linear)')} />,
          <ellipse key="base" cx={0} cy={55} rx={70} ry={18} {...paint(colors.lo)} />,
        ];
        break;
      case 'cylinder':
        body = [
          <rect key="side" x={-60} y={-60} width={120} height={120} {...paint('url(#linear)')} />,
          <ellipse key="bottom" cx={0} cy={60} rx={60} ry={18} {...paint('url(#linear)')} />,
          <ellipse key="top" cx={0} cy={-60} rx={60} ry={18} {...paint(colors.hi)} />,
        ];
        break;
      case 'capsule':
        body = <rect x={-45} y={-80} width={90} height={160} rx={45} {...paint('url(#linear)')} />;
        break;
      default:
        body = <circle cx={0} cy={0} r={80} {...paint('url(#radial)')} />;
    }
  }

  const highlightStop = `${Math.round((0.1 + 0.5 * roughness) * 100)}%`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="-100 -100 200 200"
      style={{ transform: `rotate(${rotationZ}deg)` }}
    >
      <defs>
        <radialGradient id="radial" cx="35%" cy="30%" r="75%">
          <stop offset="0%" stopColor={colors.hi} />
          <stop offset={highlightStop} stopColor={colors.mid} />
          <stop offset="100%" stopColor={colors.lo} />
        </radialGradient>
        <linearGradient id="linear" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={colors.lo} />
          <stop offset="35%" stopColor={colors.hi} />
          <stop offset="100%" stopColor={colors.lo} />
        </linearGradient>
      </defs>
      {body}
    </svg>
  );
}
