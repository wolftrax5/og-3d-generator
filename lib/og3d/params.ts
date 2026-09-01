/**
 * Query-parameter contract for the OG image endpoint.
 *
 * Every value is optional: a bare `/api/og-3d` request must still produce an
 * image. Anything unparseable falls back to its default instead of failing the
 * request, because an OG endpoint is consumed by crawlers that will not retry.
 */

export const SHAPES = [
  'cube',
  'sphere',
  'torus',
  'torusknot',
  'cone',
  'cylinder',
  'capsule',
  'icosahedron',
  'octahedron',
  'tetrahedron',
  'dodecahedron',
  'ring',
  'plane',
] as const;

export type Shape = (typeof SHAPES)[number];

/** Aliases so callers can use the names they already know. */
const SHAPE_ALIASES: Record<string, Shape> = {
  box: 'cube',
  ball: 'sphere',
  donut: 'torus',
  knot: 'torusknot',
  ico: 'icosahedron',
  octa: 'octahedron',
  tetra: 'tetrahedron',
  dodeca: 'dodecahedron',
  pill: 'capsule',
  quad: 'plane',
};

export interface OgParams {
  shape: Shape;
  /** Six-digit hex, no leading `#`. */
  color: string;
  /** Six-digit hex, or `null` for a transparent background. */
  background: string | null;
  roughness: number;
  metalness: number;
  width: number;
  height: number;
  /** Rotation applied to the mesh, in degrees. */
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  /** >1 pushes the camera back, <1 pulls it in. */
  zoom: number;
  /** Multiplier over the 3-point rig's base intensities. */
  light: number;
  wireframe: boolean;
  /** Supersampling factor; the frame renders at N× and is box-filtered down. */
  supersample: number;
}

export const DEFAULTS: OgParams = {
  shape: 'cube',
  color: 'ffffff',
  background: '0b1020',
  roughness: 0.35,
  metalness: 0.15,
  width: 1200,
  height: 630,
  rotationX: -20,
  rotationY: 35,
  rotationZ: 0,
  zoom: 1,
  light: 1,
  wireframe: false,
  supersample: 2,
};

export const LIMITS = {
  minSize: 64,
  maxSize: 2048,
  /**
   * Ceiling on the supersampled render, which drives both GPU time and the size
   * of the readback the CPU then has to filter down. Kept above
   * `maxSize * maxSize` so the largest output is always renderable at 1x and the
   * budget can be honoured by lowering the supersample factor alone.
   */
  maxRenderPixels: 6_000_000,
  maxSupersample: 3,
} as const;

/** Named colors that are convenient in a URL, kept small on purpose. */
const NAMED_COLORS: Record<string, string> = {
  black: '000000',
  white: 'ffffff',
  red: 'ef4444',
  orange: 'f97316',
  amber: 'f59e0b',
  yellow: 'eab308',
  lime: '84cc16',
  green: '22c55e',
  emerald: '10b981',
  teal: '14b8a6',
  cyan: '06b6d4',
  sky: '0ea5e9',
  blue: '3b82f6',
  indigo: '6366f1',
  violet: '8b5cf6',
  purple: 'a855f7',
  fuchsia: 'd946ef',
  pink: 'ec4899',
  rose: 'f43f5e',
  slate: '64748b',
  gray: '6b7280',
  grey: '6b7280',
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseNumber(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw === null || raw.trim() === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function parseInteger(raw: string | null, fallback: number, min: number, max: number): number {
  return Math.round(parseNumber(raw, fallback, min, max));
}

function parseBoolean(raw: string | null, fallback: boolean): boolean {
  if (raw === null) return fallback;
  const value = raw.trim().toLowerCase();
  if (value === '' || value === '1' || value === 'true' || value === 'yes') return true;
  if (value === '0' || value === 'false' || value === 'no') return false;
  return fallback;
}

function parseShape(raw: string | null): Shape {
  if (raw === null) return DEFAULTS.shape;
  const value = raw.trim().toLowerCase();
  if ((SHAPES as readonly string[]).includes(value)) return value as Shape;
  return SHAPE_ALIASES[value] ?? DEFAULTS.shape;
}

/**
 * Accepts `rgb`, `rrggbb`, either with a leading `#` (or url-encoded `%23`),
 * plus the named colors above. Returns six lowercase hex digits.
 */
export function parseHexColor(raw: string | null, fallback: string): string {
  if (raw === null) return fallback;
  const value = raw.trim().toLowerCase().replace(/^#/, '');
  if (value in NAMED_COLORS) return NAMED_COLORS[value] as string;
  if (/^[0-9a-f]{6}$/.test(value)) return value;
  if (/^[0-9a-f]{3}$/.test(value)) {
    return value
      .split('')
      .map((c) => c + c)
      .join('');
  }
  return fallback;
}

function parseBackground(raw: string | null): string | null {
  if (raw === null) return DEFAULTS.background;
  const value = raw.trim().toLowerCase();
  if (value === 'none' || value === 'transparent' || value === 'alpha') return null;
  return parseHexColor(value, DEFAULTS.background ?? 'ffffff');
}

/** Reads the first present key, so short and long spellings both work. */
function pick(params: URLSearchParams, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null) return value;
  }
  return null;
}

export function parseParams(searchParams: URLSearchParams): OgParams {
  const width = parseInteger(
    pick(searchParams, 'width', 'w'),
    DEFAULTS.width,
    LIMITS.minSize,
    LIMITS.maxSize,
  );
  const height = parseInteger(
    pick(searchParams, 'height', 'h'),
    DEFAULTS.height,
    LIMITS.minSize,
    LIMITS.maxSize,
  );

  const requestedSupersample = parseInteger(
    pick(searchParams, 'ss', 'supersample'),
    DEFAULTS.supersample,
    1,
    LIMITS.maxSupersample,
  );

  return {
    shape: parseShape(pick(searchParams, 'shape', 's')),
    color: parseHexColor(pick(searchParams, 'color', 'c'), DEFAULTS.color),
    background: parseBackground(pick(searchParams, 'bg', 'background')),
    roughness: parseNumber(pick(searchParams, 'roughness', 'r'), DEFAULTS.roughness, 0, 1),
    metalness: parseNumber(pick(searchParams, 'metalness', 'm'), DEFAULTS.metalness, 0, 1),
    width,
    height,
    rotationX: parseNumber(pick(searchParams, 'rx', 'rotx'), DEFAULTS.rotationX, -360, 360),
    rotationY: parseNumber(pick(searchParams, 'ry', 'roty'), DEFAULTS.rotationY, -360, 360),
    rotationZ: parseNumber(pick(searchParams, 'rz', 'rotz'), DEFAULTS.rotationZ, -360, 360),
    zoom: parseNumber(pick(searchParams, 'zoom', 'z'), DEFAULTS.zoom, 0.25, 4),
    light: parseNumber(pick(searchParams, 'light', 'l'), DEFAULTS.light, 0, 4),
    wireframe: parseBoolean(pick(searchParams, 'wireframe', 'wire'), DEFAULTS.wireframe),
    supersample: capSupersample(width, height, requestedSupersample),
  };
}

/** Drops the supersample factor until the render stays inside the pixel budget. */
function capSupersample(width: number, height: number, requested: number): number {
  let factor = requested;
  while (factor > 1 && width * factor * height * factor > LIMITS.maxRenderPixels) {
    factor -= 1;
  }
  return factor;
}

/** Stable identity for a parameter set, used as the response ETag. */
export function paramsFingerprint(params: OgParams): string {
  const parts = [
    params.shape,
    params.color,
    params.background ?? 'none',
    params.roughness,
    params.metalness,
    params.width,
    params.height,
    params.rotationX,
    params.rotationY,
    params.rotationZ,
    params.zoom,
    params.light,
    params.wireframe ? 'wire' : 'solid',
    params.supersample,
  ];
  return parts.join('|');
}
