/**
 * Vendors a macOS 14-compatible Dawn binary into `.vgpu/macos14/`.
 *
 * No-op on Linux, Windows, and macOS 15+. Failures are warnings: the renderer
 * will retry the download on the first request rather than breaking `npm install`.
 */

import { ensureCompatibleDawnBinary, needsMacos14Dawn } from '../lib/og3d/dawn.ts';

if (!needsMacos14Dawn()) {
  process.exit(0);
}

try {
  const path = await ensureCompatibleDawnBinary();
  if (path) console.log(`og-3d: macOS 14 Dawn ready at ${path}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.warn(`og-3d: could not vendor macOS 14 Dawn (${message}); first render will retry`);
}
