/**
 * Headless Three.js rendering on top of a vgpu (Dawn-backed) WebGPU device.
 *
 * Three's `WebGLRenderer` cannot be used here: there is no WebGL context in a
 * Node serverless runtime, and vgpu provides a WebGPU device. `WebGPURenderer`
 * from `three/webgpu` accepts an externally owned `GPUDevice`, which is exactly
 * the seam vgpu fits into.
 *
 * The device, the renderer and the render targets are cached at module scope so
 * a warm invocation only pays for the frame itself. Renders are serialized
 * because a `Renderer` carries mutable per-frame state that concurrent requests
 * would interleave.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  LinearSRGBColorSpace,
  NoToneMapping,
  RenderTarget,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu';

import type { OgParams } from './params.ts';
import { depadRows, downsample } from './pixels.ts';
import { buildScene } from './scene.ts';

/** Three only reads `width`/`height`/`style` off the canvas when rendering to a target. */
interface StubCanvas {
  width: number;
  height: number;
  style: Record<string, string>;
  getContext: (id: string) => never;
}

function createStubCanvas(width: number, height: number): StubCanvas {
  return {
    width,
    height,
    style: {},
    getContext: (id: string) => {
      // Reaching here means something tried to present to a swap chain, which
      // this endpoint never does. Failing loudly beats rendering a blank frame.
      throw new Error(`og-3d: no canvas in this runtime (requested "${id}" context)`);
    },
  };
}

/**
 * `Renderer.init()` constructs Three's internal animation loop, which reads
 * `self` at construction time and immediately calls `requestAnimationFrame` on
 * it. There is no browser global here, so init needs a host object to find.
 *
 * The stub is installed only for the duration of `init()` and then removed:
 * leaving a `self` global behind would make every other library in the process
 * that feature-detects `typeof self !== 'undefined'` believe it is in a browser.
 * The callbacks are never scheduled, since frames are driven explicitly by
 * `renderAsync()` rather than by a loop.
 */
async function withAnimationFrameStub<T>(fn: () => Promise<T>): Promise<T> {
  const globals = globalThis as { self?: unknown };
  const hadSelf = 'self' in globals;
  if (hadSelf) return fn();

  globals.self = {
    requestAnimationFrame: () => 0,
    cancelAnimationFrame: () => undefined,
  };

  try {
    return await fn();
  } finally {
    delete globals.self;
  }
}

interface RendererContext {
  renderer: WebGPURenderer;
  targets: Map<string, RenderTarget>;
  dispose: () => Promise<void>;
}

let contextPromise: Promise<RendererContext> | null = null;

/** Serializes renders against the single shared renderer. */
let queue: Promise<unknown> = Promise.resolve();

/** Bounded so a caller passing many sizes cannot grow GPU memory without limit. */
const MAX_CACHED_TARGETS = 4;

/** Kept in sync with `scripts/vendor-gpu-runtime.sh` and `next.config.ts`. */
const VENDORED_CACHE_DIR = '.vgpu';

/**
 * A serverless Linux function has no GPU and no vendor Vulkan ICD, so vgpu
 * falls back to a cached lavapipe (CPU) renderer. Its cache root defaults to
 * `$HOME/.cache`, which is not writable or populated there — point it at the
 * copy vendored into the deployment by `npm run vgpu:vendor` instead.
 *
 * Only set when the operator has not chosen a root explicitly.
 */
function useVendoredGpuCache(): void {
  if (process.env.VGPU_CACHE_DIR !== undefined) return;

  const vendored = join(process.cwd(), VENDORED_CACHE_DIR);
  if (existsSync(vendored)) {
    process.env.VGPU_CACHE_DIR = vendored;
  }
}

async function createContext(): Promise<RendererContext> {
  useVendoredGpuCache();

  // Imported lazily: `vgpu/node` loads the native Dawn addon on import, which
  // must not happen while the route module is merely being analyzed at build.
  const { init } = await import('vgpu/node');

  const gpu = await init();

  const renderer = new WebGPURenderer({
    device: gpu.gpu,
    canvas: createStubCanvas(1, 1) as unknown as HTMLCanvasElement,
    antialias: false,
    alpha: true,
    // Pins the "preferred canvas format" so Three never calls
    // `navigator.gpu.getPreferredCanvasFormat()`, which does not exist here.
    outputType: UnsignedByteType,
  });

  renderer.toneMapping = NoToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;

  await withAnimationFrameStub(() => renderer.init());

  const targets = new Map<string, RenderTarget>();

  return {
    renderer,
    targets,
    dispose: async () => {
      for (const target of targets.values()) target.dispose();
      targets.clear();
      await renderer.dispose();
      await gpu.dispose();
    },
  };
}

function getContext(): Promise<RendererContext> {
  if (contextPromise === null) {
    contextPromise = createContext().catch((error: unknown) => {
      // Do not cache a failed init: the next request should retry, since the
      // usual cause (a missing Dawn binary being fetched) is transient.
      contextPromise = null;
      throw error;
    });
  }
  return contextPromise;
}

function getRenderTarget(context: RendererContext, width: number, height: number): RenderTarget {
  const key = `${width}x${height}`;
  const existing = context.targets.get(key);
  if (existing !== undefined) return existing;

  if (context.targets.size >= MAX_CACHED_TARGETS) {
    const oldestKey = context.targets.keys().next().value as string;
    context.targets.get(oldestKey)?.dispose();
    context.targets.delete(oldestKey);
  }

  const target = new RenderTarget(width, height, {
    format: RGBAFormat,
    type: UnsignedByteType,
    // Deliberately linear. A target tagged sRGB becomes an `rgba8unorm-srgb`
    // GPU texture, so the hardware encodes on write *in addition to* the output
    // pass that `outputColorSpace` drives — the frame comes back encoded twice
    // and visibly washed out. With `rgba8unorm` the output pass is the single
    // encode, and the bytes read back are the final sRGB values the PNG wants.
    colorSpace: LinearSRGBColorSpace,
    depthBuffer: true,
    stencilBuffer: false,
    generateMipmaps: false,
  });

  context.targets.set(key, target);
  return target;
}

export interface RenderedFrame {
  /** Tightly packed RGBA bytes at the requested output size, top row first. */
  rgba: Uint8Array;
  width: number;
  height: number;
}

export async function renderFrame(params: OgParams): Promise<RenderedFrame> {
  const run = queue.then(
    () => renderExclusive(params),
    () => renderExclusive(params),
  );
  // Keep the chain alive regardless of this render's outcome.
  queue = run.catch(() => undefined);
  return run;
}

async function renderExclusive(params: OgParams): Promise<RenderedFrame> {
  const context = await getContext();
  const { renderer } = context;

  const factor = params.supersample;
  const renderWidth = params.width * factor;
  const renderHeight = params.height * factor;

  const target = getRenderTarget(context, renderWidth, renderHeight);
  const { scene, camera, dispose } = buildScene(params);

  try {
    renderer.setSize(renderWidth, renderHeight, false);

    if (params.background === null) {
      renderer.setClearColor(0x000000, 0);
    } else {
      renderer.setClearColor(Number.parseInt(params.background, 16), 1);
    }

    // Marking the target as the output target is what makes Three apply the
    // output color space conversion into it, rather than only when presenting
    // to a canvas.
    renderer.setOutputRenderTarget(target);
    renderer.setRenderTarget(target);

    // `render()` rather than the deprecated `renderAsync()`; the renderer is
    // already initialized, and the readback below orders after the submission.
    renderer.render(scene, camera);

    const padded = (await renderer.readRenderTargetPixelsAsync(
      target,
      0,
      0,
      renderWidth,
      renderHeight,
    )) as Uint8Array;

    // WebGPU render targets are already top-row-first, unlike a WebGL
    // framebuffer read, so no vertical flip is needed here.
    const packed = depadRows(padded, renderWidth, renderHeight);
    const rgba = downsample(packed, params.width, params.height, factor);

    return { rgba, width: params.width, height: params.height };
  } finally {
    renderer.setRenderTarget(null);
    renderer.setOutputRenderTarget(null);
    dispose();
  }
}

/** Exposed for scripts and tests that need a clean shutdown. */
export async function disposeRenderer(): Promise<void> {
  if (contextPromise === null) return;
  const context = await contextPromise.catch(() => null);
  contextPromise = null;
  await context?.dispose();
}
