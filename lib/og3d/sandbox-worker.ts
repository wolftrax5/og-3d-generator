/**
 * Boots a named sandbox that holds lavapipe, Dawn, and the renderer, then
 * forks a short-lived VM per job so concurrent messages do not share one
 * Three.js device.
 *
 * The named sandbox is snapshotted after install. Later jobs fork that
 * snapshot and only upload the current `render.mjs`, so a script change does
 * not reinstall packages. Bump `RENDERER_READY` when the guest packages change.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Sandbox } from '@vercel/sandbox';

import { findCachedPng, storePng } from './cache.ts';
import { RENDERER_NAME, RENDERER_READY, type RenderJob } from './job.ts';

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const JOB_TIMEOUT_MS = 5 * 60 * 1000;

const INSTALL_SH = `
set -eu
if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  apt-get install -y mesa-vulkan-drivers libvulkan1
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y mesa-vulkan-drivers vulkan-loader
else
  echo "og-3d: no apt-get or dnf on this image" >&2
  exit 1
fi
`.trim();

function sandboxDir(): string {
  return join(process.cwd(), 'sandbox');
}

function rendererFiles(): { path: string; content: Buffer }[] {
  const root = sandboxDir();
  return [
    { path: 'package.json', content: readFileSync(join(root, 'package.json')) },
    { path: 'render.mjs', content: readFileSync(join(root, 'render.mjs')) },
  ];
}

async function runChecked(
  sandbox: Sandbox,
  cmd: string,
  args: string[],
  opts: { sudo?: boolean; env?: Record<string, string> } = {},
): Promise<void> {
  const result = await sandbox.runCommand({ cmd, args, sudo: opts.sudo, env: opts.env });
  if (result.exitCode !== 0) {
    const stderr = await result.stderr();
    throw new Error(`og-3d: \`${cmd} ${args.join(' ')}\` exited ${result.exitCode}\n${stderr}`);
  }
}

async function installRenderer(sandbox: Sandbox): Promise<void> {
  await sandbox.writeFiles([
    ...rendererFiles(),
    { path: 'install.sh', content: Buffer.from(INSTALL_SH), mode: 0o755 },
  ]);
  await runChecked(sandbox, 'bash', ['install.sh'], { sudo: true });
  await runChecked(sandbox, 'npm', ['install', '--omit=dev']);
  await sandbox.writeFiles([{ path: '.og-ready', content: Buffer.from(RENDERER_READY) }]);
}

async function readyMarker(sandbox: Sandbox): Promise<string | null> {
  const buf = await sandbox.readFileToBuffer({ path: '.og-ready' });
  return buf ? buf.toString() : null;
}

/**
 * Leaves `og-renderer` stopped, with a snapshot that includes the guest
 * toolchain. Forks copy that snapshot.
 */
async function ensureRendererSnapshot(): Promise<void> {
  let base = await Sandbox.getOrCreate({
    name: RENDERER_NAME,
    runtime: 'node24',
    resources: { vcpus: 4 },
    timeout: INSTALL_TIMEOUT_MS,
    persistent: true,
    resume: false,
    keepLastSnapshots: { count: 1 },
    tags: { ready: RENDERER_READY },
    onCreate: installRenderer,
  });

  if (base.tags?.ready !== RENDERER_READY) {
    await base.delete();
    base = await Sandbox.getOrCreate({
      name: RENDERER_NAME,
      runtime: 'node24',
      resources: { vcpus: 4 },
      timeout: INSTALL_TIMEOUT_MS,
      persistent: true,
      resume: false,
      keepLastSnapshots: { count: 1 },
      tags: { ready: RENDERER_READY },
      onCreate: installRenderer,
    });
    if (base.tags?.ready !== RENDERER_READY) {
      throw new Error('og-3d: renderer sandbox was recreated without the ready tag');
    }
  }

  if (base.currentSnapshotId) return;

  if ((await readyMarker(base)) !== RENDERER_READY) await installRenderer(base);
  await base.snapshot();
}

async function renderInSandbox(job: RenderJob): Promise<Buffer> {
  await ensureRendererSnapshot();

  const worker = await Sandbox.fork({
    sourceSandbox: RENDERER_NAME,
    persistent: false,
    resources: { vcpus: 2 },
    timeout: JOB_TIMEOUT_MS,
  });

  try {
    if ((await readyMarker(worker)) !== RENDERER_READY) await installRenderer(worker);

    await worker.writeFiles([
      ...rendererFiles(),
      { path: 'job.json', content: Buffer.from(JSON.stringify(job)) },
    ]);

    await runChecked(worker, 'node', ['render.mjs', 'job.json', 'out.png'], {
      env: {
        VGPU_DAWN_FLAGS: 'backend=vulkan',
        XDG_RUNTIME_DIR: '/tmp',
      },
    });

    const png = await worker.readFileToBuffer({ path: 'out.png' });
    if (!png || png.length < 8) throw new Error('og-3d: sandbox wrote no png');
    return png;
  } finally {
    await worker.stop();
  }
}

/** Renders the job unless this exact frame is already stored. */
export async function renderJob(job: RenderJob): Promise<void> {
  if (await findCachedPng(job)) return;
  const png = await renderInSandbox(job);
  await storePng(job, png);
}
