/**
 * Stage-by-stage timing of the headless pipeline.
 *
 * Each step prints before it starts, so a hang or a failure is attributable to
 * one stage (device acquisition, renderer init, draw, readback) rather than to
 * the pipeline as a whole. Useful when bringing the endpoint up on a new host
 * or a new Dawn build.
 */

import {
  BoxGeometry,
  Mesh,
  MeshStandardMaterial,
  DirectionalLight,
  PerspectiveCamera,
  RenderTarget,
  RGBAFormat,
  Scene,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu';

const t0 = performance.now();
const step = (label: string) => console.log(`[${String(Math.round(performance.now() - t0)).padStart(6)}ms] ${label}`);

step('importing vgpu/node');
const { init } = await import('vgpu/node');

step('init() — acquiring Dawn device');
const gpu = await init();
step(`device ready: ${JSON.stringify(gpu.adapter)}`);

step('constructing WebGPURenderer');
const renderer = new WebGPURenderer({
  device: gpu.gpu,
  canvas: { width: 64, height: 64, style: {} } as unknown as HTMLCanvasElement,
  antialias: false,
  alpha: true,
  outputType: UnsignedByteType,
});

step('renderer.init()');
const globals = globalThis as { self?: unknown };
globals.self = { requestAnimationFrame: () => 0, cancelAnimationFrame: () => undefined };
await renderer.init();
delete globals.self;
step('renderer initialized');

step('building scene');
const scene = new Scene();
const mesh = new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial({ color: 0xff8800 }));
scene.add(mesh);
const light = new DirectionalLight(0xffffff, 3);
light.position.set(2, 3, 4);
scene.add(light);
const camera = new PerspectiveCamera(35, 1, 0.1, 100);
camera.position.set(0, 0, 3);
camera.lookAt(0, 0, 0);

step('creating render target');
const target = new RenderTarget(64, 64, {
  format: RGBAFormat,
  type: UnsignedByteType,
  depthBuffer: true,
});

step('renderAsync');
renderer.setSize(64, 64, false);
renderer.setOutputRenderTarget(target);
renderer.setRenderTarget(target);
await renderer.renderAsync(scene, camera);
step('render submitted');

step('readRenderTargetPixelsAsync');
const pixels = (await renderer.readRenderTargetPixelsAsync(target, 0, 0, 64, 64)) as Uint8Array;
step(`readback complete: ${pixels.length} bytes`);

let nonZero = 0;
for (let i = 0; i < pixels.length; i += 4) {
  if (pixels[i] !== 0 || pixels[i + 1] !== 0 || pixels[i + 2] !== 0) nonZero++;
}
step(`non-black pixels: ${nonZero}`);

step('disposing');
target.dispose();
await renderer.dispose();
await gpu.dispose();
step('done');
process.exit(0);
