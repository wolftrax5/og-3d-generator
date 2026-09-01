/**
 * Decodes a PNG produced by `lib/og3d/png.ts` and prints sampled pixels.
 *
 * Deliberately only understands what the encoder emits (8-bit RGBA, Sub
 * filter, single IDAT) — it exists to check the encoder and the color pipeline,
 * not to be a general PNG reader.
 *
 * Usage: node scripts/inspect-png.ts out.png
 */

import { readFileSync } from 'node:fs';
import { argv } from 'node:process';
import { inflateSync } from 'node:zlib';

const path = argv[2];
if (path === undefined) {
  console.error('usage: node scripts/inspect-png.ts <file.png>');
  process.exit(1);
}

const png = readFileSync(path);

const chunks: { type: string; data: Buffer }[] = [];
let offset = 8;
while (offset < png.length) {
  const length = png.readUInt32BE(offset);
  chunks.push({
    type: png.toString('latin1', offset + 4, offset + 8),
    data: png.subarray(offset + 8, offset + 8 + length),
  });
  offset += 12 + length;
}

const ihdr = chunks.find((c) => c.type === 'IHDR')!.data;
const width = ihdr.readUInt32BE(0);
const height = ihdr.readUInt32BE(4);

const idat = Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data));
const raw = inflateSync(idat);

const stride = width * 4;
const rgba = new Uint8Array(width * height * 4);
for (let y = 0; y < height; y++) {
  const src = y * (stride + 1);
  if (raw[src] !== 1) throw new Error(`row ${y}: unexpected filter ${raw[src]}`);
  for (let x = 0; x < stride; x++) {
    const left = x >= 4 ? rgba[y * stride + x - 4]! : 0;
    rgba[y * stride + x] = (raw[src + 1 + x]! + left) & 0xff;
  }
}

const at = (x: number, y: number) => {
  const i = (y * width + x) * 4;
  return [rgba[i]!, rgba[i + 1]!, rgba[i + 2]!, rgba[i + 3]!] as const;
};

const hex = (p: readonly number[]) =>
  p
    .slice(0, 3)
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');

console.log(`${path}: ${width}x${height}, ${(png.length / 1024).toFixed(1)} KiB`);

const samples: [string, readonly number[]][] = [
  ['top-left corner', at(2, 2)],
  ['top-right corner', at(width - 3, 2)],
  ['bottom-left corner', at(2, height - 3)],
  ['bottom-right corner', at(width - 3, height - 3)],
  ['center', at(width >> 1, height >> 1)],
];

for (const [label, pixel] of samples) {
  console.log(
    `  ${label.padEnd(20)} rgba(${pixel.join(', ')})  #${hex(pixel)}`,
  );
}

// Vertical asymmetry check: a lit scene is brighter near the key light, so a
// flipped readback would show the bright band on the wrong side.
let topSum = 0;
let bottomSum = 0;
for (let x = 0; x < width; x++) {
  for (let y = 0; y < 8; y++) {
    topSum += at(x, y)[0] + at(x, y)[1] + at(x, y)[2];
    const by = height - 1 - y;
    bottomSum += at(x, by)[0] + at(x, by)[1] + at(x, by)[2];
  }
}
console.log(`  top strip mean ${(topSum / (width * 8 * 3)).toFixed(2)}`);
console.log(`  bottom strip mean ${(bottomSum / (width * 8 * 3)).toFixed(2)}`);

let opaque = 0;
for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! > 250) opaque++;
console.log(`  fully opaque pixels: ${opaque} / ${width * height}`);
