/**
 * Renders one frame to a PNG on disk, using the exact pipeline the route uses.
 *
 * Usage:
 *   node scripts/render.ts "shape=torusknot&color=6366f1" out.png
 *
 * This is the fastest way to confirm the Dawn device, the Three.js bridge and
 * the encoder all work on a given machine without booting Next.js.
 */

import { writeFile } from 'node:fs/promises';
import { argv } from 'node:process';

import { parseParams } from '../lib/og3d/params.ts';
import { encodePng } from '../lib/og3d/png.ts';
import { disposeRenderer, renderFrame } from '../lib/og3d/renderer.ts';

const query = argv[2] ?? '';
const output = argv[3] ?? 'out.png';

const params = parseParams(new URLSearchParams(query));
console.log('params:', params);

const started = performance.now();
const frame = await renderFrame(params);
const rendered = performance.now();

const png = encodePng({ width: frame.width, height: frame.height, rgba: frame.rgba });
const encoded = performance.now();

await writeFile(output, png);
await disposeRenderer();

console.log(
  `wrote ${output}: ${frame.width}x${frame.height}, ${(png.byteLength / 1024).toFixed(1)} KiB ` +
    `(render ${Math.round(rendered - started)}ms, encode ${Math.round(encoded - rendered)}ms)`,
);

// Dawn keeps handles that hold the event loop open, so a CLI run would never
// exit on its own. A long-lived server process wants exactly that behaviour,
// which is why the renderer module does not force it.
process.exit(0);
