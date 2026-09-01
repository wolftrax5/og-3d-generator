import type { NextRequest } from 'next/server';

import { paramsFingerprint, parseParams } from '@/lib/og3d/params';
import { encodePng } from '@/lib/og3d/png';
import { renderFrame } from '@/lib/og3d/renderer';

// Dawn is a native addon, so this route needs the Node.js runtime.
export const runtime = 'nodejs';

// The response is derived from the query string, which the Edge cache keys on.
export const dynamic = 'force-dynamic';

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';

export async function GET(request: NextRequest): Promise<Response> {
  const params = parseParams(request.nextUrl.searchParams);
  const etag = `"${hash(paramsFingerprint(params))}"`;

  if (request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { 'Cache-Control': IMMUTABLE_CACHE, ETag: etag },
    });
  }

  try {
    const started = performance.now();
    const frame = await renderFrame(params);
    const png = encodePng({ width: frame.width, height: frame.height, rgba: frame.rgba });
    const elapsed = Math.round(performance.now() - started);

    return new Response(new Uint8Array(png), {
      status: 200,
      headers: {
        'Content-Type': 'image/png',
        'Content-Length': String(png.byteLength),
        'Cache-Control': IMMUTABLE_CACHE,
        ETag: etag,
        'Server-Timing': `render;dur=${elapsed}`,
      },
    });
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

/** FNV-1a, enough to key an ETag on a parameter set. */
function hash(input: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}
