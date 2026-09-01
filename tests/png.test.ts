import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { test } from 'node:test';

import { encodePng } from '../lib/og3d/png.ts';
import { depadRows, downsample } from '../lib/og3d/pixels.ts';

function readChunks(png: Buffer): { type: string; data: Buffer }[] {
  const chunks: { type: string; data: Buffer }[] = [];
  let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.toString('latin1', offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 12 + length;
  }
  return chunks;
}

/** Reverses the Sub filter so decoded scanlines can be compared to the input. */
function decodeScanlines(idat: Buffer, width: number, height: number): Uint8Array {
  const raw = inflateSync(idat);
  const stride = width * 4;
  const out = new Uint8Array(width * height * 4);

  for (let y = 0; y < height; y++) {
    const src = y * (stride + 1);
    const filter = raw[src];
    assert.equal(filter, 1, 'expected Sub filter');
    for (let x = 0; x < stride; x++) {
      const left = x >= 4 ? out[y * stride + x - 4]! : 0;
      out[y * stride + x] = (raw[src + 1 + x]! + left) & 0xff;
    }
  }
  return out;
}

test('encodePng emits a valid signature, chunk order and IHDR', () => {
  const width = 3;
  const height = 2;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) & 0xff;

  const png = encodePng({ width, height, rgba });

  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'PNG signature',
  );

  const chunks = readChunks(png);
  assert.deepEqual(
    chunks.map((c) => c.type),
    ['IHDR', 'IDAT', 'IEND'],
  );

  const ihdr = chunks[0]!.data;
  assert.equal(ihdr.readUInt32BE(0), width);
  assert.equal(ihdr.readUInt32BE(4), height);
  assert.equal(ihdr.readUInt8(8), 8, 'bit depth');
  assert.equal(ihdr.readUInt8(9), 6, 'color type RGBA');
  assert.equal(ihdr.readUInt8(12), 0, 'non-interlaced');
});

test('encodePng round-trips pixel data losslessly', () => {
  const width = 17;
  const height = 5;
  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 31 + 11) & 0xff;

  const png = encodePng({ width, height, rgba });
  const idat = readChunks(png).find((c) => c.type === 'IDAT')!.data;

  assert.deepEqual([...decodeScanlines(idat, width, height)], [...rgba]);
});

test('encodePng CRCs match the chunk contents', () => {
  const png = encodePng({ width: 2, height: 2, rgba: new Uint8Array(16).fill(200) });

  // Corrupting one byte of IDAT must invalidate its stored CRC.
  const chunks = readChunks(png);
  const idatIndex = png.indexOf(Buffer.from('IDAT', 'latin1'));
  const before = png.readUInt32BE(idatIndex + 4 + chunks[1]!.data.length);
  const copy = Buffer.from(png);
  copy[idatIndex + 4] = (copy[idatIndex + 4]! + 1) & 0xff;
  const recomputed = encodePng({ width: 2, height: 2, rgba: new Uint8Array(16).fill(201) });

  assert.notEqual(before, recomputed.readUInt32BE(idatIndex + 4 + chunks[1]!.data.length));
});

test('encodePng rejects a mismatched buffer length', () => {
  assert.throws(
    () => encodePng({ width: 4, height: 4, rgba: new Uint8Array(10) }),
    /expected 64 bytes of RGBA, received 10/,
  );
});

test('depadRows strips 256-byte row alignment', () => {
  const width = 3; // 12 bytes per row, padded to 256
  const height = 2;
  const stride = 256;
  const padded = new Uint8Array(stride * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width * 4; x++) {
      padded[y * stride + x] = y * 100 + x;
    }
    // Padding region holds garbage that must not survive.
    padded.fill(0xff, y * stride + width * 4, (y + 1) * stride);
  }

  const packed = depadRows(padded, width, height);
  assert.equal(packed.length, width * height * 4);
  assert.deepEqual([...packed.subarray(0, 12)], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(
    [...packed.subarray(12, 24)],
    [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
  );
});

test('depadRows tolerates a short final row', () => {
  const width = 64; // 256 bytes per row: already aligned
  const height = 3;
  const source = new Uint8Array(256 * height).fill(9);
  const packed = depadRows(source, width, height);
  assert.equal(packed.length, width * height * 4);
});

test('depadRows is a no-op when rows are already aligned', () => {
  const width = 64;
  const height = 2;
  const source = new Uint8Array(width * height * 4).fill(3);
  assert.equal(depadRows(source, width, height), source);
});

test('downsample averages a 2x block', () => {
  const rgba = new Uint8Array([
    // 2x2 opaque block: values 0, 100, 200, 100 per channel
    0, 0, 0, 255, 100, 100, 100, 255, 200, 200, 200, 255, 100, 100, 100, 255,
  ]);

  const out = downsample(rgba, 1, 1, 2);
  assert.deepEqual([...out], [100, 100, 100, 255]);
});

test('downsample weights color by alpha so transparent edges do not darken', () => {
  // Three transparent black samples plus one opaque white sample.
  const rgba = new Uint8Array([
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 255, 255,
  ]);

  const out = downsample(rgba, 1, 1, 2);
  assert.deepEqual(
    [...out.subarray(0, 3)],
    [255, 255, 255],
    'color must stay white, not average toward black',
  );
  assert.equal(out[3], 64, 'alpha is the plain mean of the four samples');
});

test('downsample returns the source untouched at factor 1', () => {
  const rgba = new Uint8Array(16).fill(7);
  assert.equal(downsample(rgba, 2, 2, 1), rgba);
});
