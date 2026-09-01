/**
 * Builds the scene entirely from Three.js primitives generated in memory.
 *
 * Nothing here touches the network or the filesystem: no GLTF, no textures, no
 * HDR environment. That keeps a cold start bounded by module load plus device
 * acquisition rather than by asset fetches.
 */

import {
  AmbientLight,
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DirectionalLight,
  DodecahedronGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  MathUtils,
  Mesh,
  MeshStandardMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  SphereGeometry,
  TetrahedronGeometry,
  TorusGeometry,
  TorusKnotGeometry,
} from 'three/webgpu';

import type { OgParams, Shape } from './params.ts';

const CAMERA_FOV = 35;

export interface BuiltScene {
  scene: Scene;
  camera: PerspectiveCamera;
  /** Everything allocated for this frame, released after readback. */
  dispose: () => void;
}

function createGeometry(shape: Shape): BufferGeometry {
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
  }
}

/**
 * Flat geometries (plane, ring) have no thickness, so they need two-sided
 * shading to survive an off-axis camera.
 */
function isFlat(shape: Shape): boolean {
  return shape === 'plane' || shape === 'ring';
}

export function buildScene(params: OgParams): BuiltScene {
  const scene = new Scene();

  if (params.background !== null) {
    scene.background = new Color(`#${params.background}`);
  }

  const geometry = createGeometry(params.shape);
  const material = new MeshStandardMaterial({
    color: new Color(`#${params.color}`),
    roughness: params.roughness,
    metalness: params.metalness,
    wireframe: params.wireframe,
    ...(isFlat(params.shape) ? { side: DoubleSide } : {}),
  });

  const mesh = new Mesh(geometry, material);
  mesh.rotation.set(
    MathUtils.degToRad(params.rotationX),
    MathUtils.degToRad(params.rotationY),
    MathUtils.degToRad(params.rotationZ),
  );
  scene.add(mesh);

  const lights = createLightRig(params.light);
  scene.add(lights);

  const camera = createFramingCamera(geometry, params);

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

/**
 * Classic key / fill / rim rig plus a little ambient. Without an environment
 * map, a metallic MeshStandardMaterial has nothing to reflect, so the ambient
 * term keeps high-metalness values from going black.
 */
function createLightRig(intensity: number): Group {
  const group = new Group();

  // Intensities are tuned so that the brightest albedo this endpoint can be
  // asked for (white, `color=ffffff`) still lands below 1.0 and keeps its
  // shading. A hotter key looks better on saturated colors but clips the
  // default to a flat white silhouette.
  const key = new DirectionalLight(0xffffff, 2.2 * intensity);
  key.position.set(2.6, 3.2, 2.8);
  group.add(key);

  const fill = new DirectionalLight(0xbcd4ff, 0.8 * intensity);
  fill.position.set(-3.0, 0.4, 1.8);
  group.add(fill);

  const rim = new DirectionalLight(0xffe9c4, 1.4 * intensity);
  rim.position.set(-1.2, 1.6, -3.2);
  group.add(rim);

  // Without an environment map a metallic surface has nothing to reflect, so
  // this term is what keeps high `metalness` values from rendering black.
  group.add(new AmbientLight(0xffffff, 0.35 * intensity));

  return group;
}

/**
 * Frames the mesh from its bounding sphere so every primitive fills a similar
 * portion of the canvas regardless of its authored dimensions.
 */
function createFramingCamera(geometry: BufferGeometry, params: OgParams): PerspectiveCamera {
  const aspect = params.width / params.height;
  const camera = new PerspectiveCamera(CAMERA_FOV, aspect, 0.1, 100);

  geometry.computeBoundingSphere();
  const radius = geometry.boundingSphere?.radius ?? 1;

  const verticalFov = MathUtils.degToRad(CAMERA_FOV);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspect);
  const limitingFov = Math.min(verticalFov, horizontalFov);

  // 1.35 leaves margin so the silhouette never touches the edges.
  const distance = (radius / Math.sin(limitingFov / 2)) * 1.35 * params.zoom;

  camera.position.set(0, 0, distance);
  camera.lookAt(0, 0, 0);
  camera.updateProjectionMatrix();

  return camera;
}
