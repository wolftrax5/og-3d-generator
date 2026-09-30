/**
 * One-shot WebGPU frame. Runs inside the Vercel Sandbox, where lavapipe is
 * installed on the guest and `vgpu/node` can open a Dawn device. The function
 * that boots the sandbox does not link Dawn itself.
 *
 *   node render.mjs job.json out.png
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

import {
  AmbientLight,
  BoxGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  LinearSRGBColorSpace,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  RenderTarget,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  UnsignedByteType,
  WebGPURenderer,
} from 'three/webgpu';

const CAMERA_FOV = 35;

const [jobPath, outPath] = process.argv.slice(2);
if (!jobPath || !outPath) {
  console.error('usage: node render.mjs job.json out.png');
  process.exit(1);
}

const params = JSON.parse(readFileSync(jobPath, 'utf8'));

function configureHeadlessGpu() {
  process.env.XDG_RUNTIME_DIR ??= '/tmp';
  // Empty Dawn flags do not enumerate lavapipe on a display-less guest.
  process.env.VGPU_DAWN_FLAGS ??= 'backend=vulkan';
}

function createStubCanvas(width, height) {
  return {
    width,
    height,
    style: {},
    getContext: (id) => {
      throw new Error(`og-3d: no canvas in this runtime (requested "${id}" context)`);
    },
  };
}

async function withAnimationFrameStub(fn) {
  const globals = globalThis;
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

function createGeometry(shape) {
  switch (shape) {
    case 'cube':
      return new BoxGeometry(1, 1, 1, 1, 1, 1);
    case 'sphere':
      return new SphereGeometry(0.72, 64, 48);
    case 'torus':
      return new TorusGeometry(0.55, 0.22, 48, 96);
    case 'torusknot':
      return new TorusKnotGeometry(0.5, 0.16, 160, 32);
    case 'cone':
      return new ConeGeometry(0.62, 1.2, 64, 1);
    case 'cylinder':
      return new CylinderGeometry(0.5, 0.5, 1.1, 64, 1);
    case 'capsule':
      return new CapsuleGeometry(0.38, 0.7, 24, 32);
    case 'icosahedron':
      return new IcosahedronGeometry(0.72, 0);
    case 'octahedron':
      return new OctahedronGeometry(0.78, 0);
    case 'tetrahedron':
      return new TetrahedronGeometry(0.85, 0);
    case 'dodecahedron':
      return new DodecahedronGeometry(0.74, 0);
    case 'ring':
      return new RingGeometry(0.34, 0.72, 96, 1);
    case 'plane':
      return new PlaneGeometry(1.2, 1.2, 1, 1);
    default:
      return new BoxGeometry(1, 1, 1);
  }
}

function buildScene(job) {
  const scene = new Scene();
  if (job.background !== null) scene.background = new Color(`#${job.background}`);

  const geometry = createGeometry(job.shape);
  const flat = job.shape === 'plane' || job.shape === 'ring';
  const material = new MeshStandardMaterial({
    color: new Color(`#${job.color}`),
    roughness: job.roughness,
    metalness: job.metalness,
    wireframe: job.wireframe,
    ...(flat ? { side: DoubleSide } : {}),
  });

  const mesh = new Mesh(geometry, material);
  mesh.rotation.set(
    MathUtils.degToRad(job.rotationX),
    MathUtils.degToRad(job.rotationY),
    MathUtils.degToRad(job.rotationZ),
  );
  scene.add(mesh);

  const lights = new Group();
  const key = new DirectionalLight(0xffffff, 2.2 * job.light);
  key.position.set(2.6, 3.2, 2.8);
  const fill = new DirectionalLight(0xbcd4ff, 0.8 * job.light);
  fill.position.set(-3.0, 0.4, 1.8);
  const rim = new DirectionalLight(0xffe9c4, 1.4 * job.light);
  rim.position.set(-1.2, 1.6, -3.2);
  lights.add(key, fill, rim, new AmbientLight(0xffffff, 0.35 * job.light));
  scene.add(lights);

  const aspect = job.width / job.height;
  const camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 100);
  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius ?? 1;
  const verticalFov = MathUtils.degToRad(CAMERA_FOV);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const distance = (radius / Math.sin(limitingFov / 2)) * 1.35 * job.zoom;
  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  return {
    scene,
    camera,
    dispose: () => {
      geometry.dispose();
      material.dispose();
      scene.clear();
    },
  };
}

function depadRows(source, width, height) {
  const rowBytes = width * 4;
  const paddedStride = Math.ceil(rowBytes / 256) * 256;
  if (paddedStride === rowBytes) {
    return source.length === rowBytes * height ? source : source.subarray(0, rowBytes * height);
  }
  const out = new Uint8Array(rowBytes * height);
  for (let y = 0; y < height; y++) {
    const start = y * paddedStride;
    out.set(source.subarray(start, start + rowBytes), y * rowBytes);
  }
  return out;
}

function downsample(source, width, height, factor) {
  if (factor <= 1) return source;
  const srcWidth = width * factor;
  const out = new Uint8Array(width * height * 4);
  const samples = factor * factor;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < factor; sy++) {
        const rowStart = ((y * factor + sy) * srcWidth + x * factor) * 4;
        for (let sx = 0; sx < factor; sx++) {
          const i = rowStart + sx * 4;
          const alpha = source[i + 3];
          r += source[i] * alpha;
          g += source[i + 1] * alpha;
          b += source[i + 2] * alpha;
          a += alpha;
        }
      }
      const dst = (y * width + x) * 4;
      if (a === 0) {
        out[dst] = 0;
        out[dst + 1] = 0;
        out[dst + 2] = 0;
        out[dst + 3] = 0;
      } else {
        out[dst] = Math.round(r / a);
        out[dst + 1] = Math.round(g / a);
        out[dst + 2] = Math.round(b / a);
        out[dst + 3] = Math.round(a / samples);
      }
    }
  }
  return out;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(data) {
  let crc = -1;
  for (let i = 0; i < data.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ data[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const typeAndPayload = Buffer.concat([Buffer.from(type, 'latin1'), payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndPayload), 0);
  return Buffer.concat([length, typeAndPayload, crc]);
}

function encodePng(width, height, rgba) {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`encodePng: expected ${expected} bytes of RGBA, received ${rgba.length}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  const stride = width * 4;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    const src = y * stride;
    const dst = y * (stride + 1);
    filtered[dst] = 1;
    for (let x = 0; x < 4 && x < stride; x++) filtered[dst + 1 + x] = rgba[src + x];
    for (let x = 4; x < stride; x++) {
      filtered[dst + 1 + x] = (rgba[src + x] - rgba[src + x - 4]) & 0xff;
    }
  }
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(filtered, { level: 6 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

configureHeadlessGpu();

const { init } = await import('vgpu/node');
const gpu = await init();

const factor = params.supersample;
const renderWidth = params.width * factor;
const renderHeight = params.height * factor;

const renderer = new WebGPURenderer({
  device: gpu.gpu,
  canvas: createStubCanvas(1, 1),
  antialias: false,
  alpha: true,
  outputType: UnsignedByteType,
});
renderer.toneMapping = NoToneMapping;
renderer.outputColorSpace = SRGBColorSpace;
await withAnimationFrameStub(() => renderer.init());

const target = new RenderTarget(renderWidth, renderHeight, {
  format: RGBAFormat,
  type: UnsignedByteType,
  colorSpace: LinearSRGBColorSpace,
  depthBuffer: true,
  stencilBuffer: false,
  generateMipmaps: false,
});

const built = buildScene(params);

try {
  renderer.setSize(renderWidth, renderHeight, false);
  if (params.background === null) renderer.setClearColor(0x000000, 0);
  else renderer.setClearColor(Number.parseInt(params.background, 16), 1);

  renderer.setOutputRenderTarget(target);
  renderer.setRenderTarget(target);
  renderer.render(built.scene, built.camera);

  const padded = await renderer.readRenderTargetPixelsAsync(target, 0, 0, renderWidth, renderHeight);
  const packed = depadRows(padded, renderWidth, renderHeight);
  const rgba = downsample(packed, params.width, params.height, factor);
  writeFileSync(outPath, encodePng(params.width, params.height, rgba));
} finally {
  renderer.setRenderTarget(null);
  renderer.setOutputRenderTarget(null);
  built.dispose();
  target.dispose();
  await renderer.dispose();
  await gpu.dispose();
}
