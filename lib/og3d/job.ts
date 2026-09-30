/**
 * The message published to the `og-renders` topic.
 *
 * It is the parsed parameter set, so the sandbox renderer and the public
 * route agree on one shape. `pathname` is derived, not sent: the blob key
 * and the queue idempotency key both come from the fingerprint.
 */

import { SHAPES, paramsFingerprint, type OgParams, type Shape } from './params.ts';

export const RENDER_TOPIC = 'og-renders';

/** Bump when the sandbox image (packages or system libraries) must be rebuilt. */
export const RENDERER_READY = '1';

export const RENDERER_NAME = 'og-renderer';

export interface RenderJob {
  shape: Shape;
  color: string;
  background: string | null;
  roughness: number;
  metalness: number;
  width: number;
  height: number;
  rotationX: number;
  rotationY: number;
  rotationZ: number;
  zoom: number;
  light: number;
  wireframe: boolean;
  supersample: number;
}

export function toJob(params: OgParams): RenderJob {
  return {
    shape: params.shape,
    color: params.color,
    background: params.background,
    roughness: params.roughness,
    metalness: params.metalness,
    width: params.width,
    height: params.height,
    rotationX: params.rotationX,
    rotationY: params.rotationY,
    rotationZ: params.rotationZ,
    zoom: params.zoom,
    light: params.light,
    wireframe: params.wireframe,
    supersample: params.supersample,
  };
}

export function isRenderJob(value: unknown): value is RenderJob {
  if (value === null || typeof value !== 'object') return false;
  const job = value as Partial<RenderJob>;
  return (
    typeof job.shape === 'string' &&
    (SHAPES as readonly string[]).includes(job.shape) &&
    typeof job.color === 'string' &&
    (job.background === null || typeof job.background === 'string') &&
    typeof job.roughness === 'number' &&
    typeof job.metalness === 'number' &&
    typeof job.width === 'number' &&
    typeof job.height === 'number' &&
    typeof job.rotationX === 'number' &&
    typeof job.rotationY === 'number' &&
    typeof job.rotationZ === 'number' &&
    typeof job.zoom === 'number' &&
    typeof job.light === 'number' &&
    typeof job.wireframe === 'boolean' &&
    typeof job.supersample === 'number'
  );
}

/** FNV-1a. Short enough for an ETag, a blob pathname, and a queue idempotency key. */
export function hash(input: string): string {
  let value = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    value ^= input.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return (value >>> 0).toString(36);
}

export function jobKey(job: RenderJob): string {
  return hash(paramsFingerprint(job));
}

/** Public blob pathname for a finished frame. Stable for a given parameter set. */
export function blobPathname(job: RenderJob): string {
  return `og/${jobKey(job)}.png`;
}
