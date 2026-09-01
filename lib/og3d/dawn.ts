/**
 * Resolves a Dawn `.node` binary that can actually `dlopen` on this host.
 *
 * `webgpu@0.4.0` (what vgpu pins) ships `darwin-universal.dawn.node` built
 * against the macOS 15 SDK. On macOS 14 the dynamic linker fails looking for
 * `MTLLogStateDescriptor`. Linux / Vercel keep the stock 0.4.0 binary.
 *
 * On Darwin < 24 the compatible binary is vendored from `webgpu@0.3.0` into
 * `.vgpu/macos14/` so `npm install` cannot replace it the way `--no-save` did.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { release as osRelease } from 'node:os';
import { dirname, join } from 'node:path';

/** Kept in sync with `scripts/vendor-gpu-runtime.sh` and `next.config.ts`. */
export const VENDORED_CACHE_DIR = '.vgpu';

/** Last `webgpu` release whose Darwin binary loads on macOS 14. */
const MACOS14_WEBGPU = '0.3.0';

/** Darwin 24 === macOS 15 Sequoia, which introduced `MTLLogStateDescriptor`. */
const MACOS_15_DARWIN = 24;

const MIN_DAWN_BYTES = 1_000_000;

let vendorPromise: Promise<string> | null = null;

export function dawnBinaryFileName(): string {
  const arch = process.platform === 'darwin' ? 'universal' : process.arch;
  return `${process.platform}-${arch}.dawn.node`;
}

export function needsMacos14Dawn(): boolean {
  if (process.platform !== 'darwin') return false;
  const major = Number.parseInt(osRelease().split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major < MACOS_15_DARWIN;
}

export function isStockSequoiaBinary(path: string): boolean {
  return path.includes('darwin-universal.dawn.node');
}

function macos14DawnPath(): string {
  return join(
    process.cwd(),
    VENDORED_CACHE_DIR,
    'macos14',
    `webgpu-${MACOS14_WEBGPU}`,
    `darwin-${process.arch}.dawn.node`,
  );
}

function looksLikeDawnBinary(path: string): boolean {
  try {
    return statSync(path).size >= MIN_DAWN_BYTES;
  } catch {
    return false;
  }
}

export function findStockDawnBinary(): string | undefined {
  const name = dawnBinaryFileName();
  const candidates: string[] = [];

  try {
    const req = createRequire(join(process.cwd(), 'package.json'));
    candidates.push(join(dirname(req.resolve('webgpu')), 'dist', name));
  } catch {
    // cwd may not have a package.json in some traces; fall through.
  }

  candidates.push(join(process.cwd(), 'node_modules', 'webgpu', 'dist', name));
  return candidates.find((path) => existsSync(path));
}

function clearQuarantine(path: string): void {
  try {
    execFileSync('xattr', ['-d', 'com.apple.quarantine', path], { stdio: 'ignore' });
  } catch {
    // Not quarantined, or xattr unavailable — dlopen will tell us if it matters.
  }
}

async function downloadMacos14Dawn(dest: string): Promise<void> {
  const name = `darwin-${process.arch}.dawn.node`;
  const url = `https://registry.npmjs.org/webgpu/-/webgpu-${MACOS14_WEBGPU}.tgz`;
  const destDir = dirname(dest);
  mkdirSync(destDir, { recursive: true });

  const tarball = join(destDir, `${name}.tgz`);
  console.warn(`og-3d: downloading webgpu@${MACOS14_WEBGPU} Dawn for macOS 14 into ${destDir}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`og-3d: failed to download ${url} (${response.status} ${response.statusText})`);
  }

  await writeFile(tarball, Buffer.from(await response.arrayBuffer()));

  try {
    execFileSync(
      'tar',
      ['-xzf', tarball, '-C', destDir, '--strip-components', '2', `package/dist/${name}`],
      { stdio: 'pipe' },
    );
  } finally {
    await unlink(tarball).catch(() => undefined);
  }

  if (!looksLikeDawnBinary(dest)) {
    throw new Error(`og-3d: extracted Dawn binary is missing or too small (${dest})`);
  }

  clearQuarantine(dest);
}

/**
 * Path to a Dawn binary this process can load. Downloads the macOS 14 build
 * once, then reuses `.vgpu/macos14/`.
 */
export async function ensureCompatibleDawnBinary(): Promise<string | undefined> {
  if (needsMacos14Dawn()) {
    if (vendorPromise === null) {
      vendorPromise = (async () => {
        const dest = macos14DawnPath();
        if (!looksLikeDawnBinary(dest)) await downloadMacos14Dawn(dest);
        console.warn(`og-3d: using macOS 14 Dawn at ${dest}`);
        return dest;
      })().catch((error: unknown) => {
        vendorPromise = null;
        throw error;
      });
    }
    return vendorPromise;
  }

  return findStockDawnBinary();
}
