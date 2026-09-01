/**
 * Minimal PNG encoder built on `node:zlib`.
 *
 * Written out by hand rather than pulled from a dependency so the function
 * bundle stays small and the encode path has no native or WASM component
 * beyond zlib, which Node already links.
 *
 * Emits an 8-bit RGBA (color type 6) non-interlaced image.
 */

import { deflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = buildCrcTable();

function buildCrcTable(): Int32Array {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
}

function crc32(data: Buffer): number {
  let crc = -1;
  for (let i = 0; i < data.length; i++) {
    crc = (crc >>> 8) ^ (CRC_TABLE[(crc ^ data[i]!) & 0xff] as number);
  }
  return (crc ^ -1) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);

  const typeAndPayload = Buffer.concat([Buffer.from(type, 'latin1'), payload]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndPayload), 0);

  return Buffer.concat([length, typeAndPayload, crc]);
}

export interface EncodePngOptions {
  width: number;
  height: number;
  /** Tightly packed RGBA bytes, `width * height * 4` in length, top row first. */
  rgba: Uint8Array;
  /** zlib level; 6 is a good size/latency trade-off for a cached response. */
  compressionLevel?: number;
}

export function encodePng({
  width,
  height,
  rgba,
  compressionLevel = 6,
}: EncodePngOptions): Buffer {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`encodePng: expected ${expected} bytes of RGBA, received ${rgba.length}`);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type: truecolor with alpha
  ihdr.writeUInt8(0, 10); // compression: deflate
  ihdr.writeUInt8(0, 11); // filter method: adaptive
  ihdr.writeUInt8(0, 12); // interlace: none

  const idatPayload = deflateSync(applyFilters(rgba, width, height), {
    level: compressionLevel,
  });

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatPayload),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Prefixes each scanline with a filter byte. Filter 1 (Sub) predicts each byte
 * from its left neighbour, which compresses the large flat regions typical of a
 * rendered OG card far better than filter 0, at a negligible CPU cost.
 */
function applyFilters(rgba: Uint8Array, width: number, height: number): Buffer {
  const stride = width * 4;
  const out = Buffer.alloc(height * (stride + 1));

  for (let y = 0; y < height; y++) {
    const src = y * stride;
    const dst = y * (stride + 1);

    out[dst] = 1;

    // First pixel of the row has no left neighbour, so it is copied verbatim.
    for (let x = 0; x < 4 && x < stride; x++) {
      out[dst + 1 + x] = rgba[src + x] as number;
    }
    for (let x = 4; x < stride; x++) {
      out[dst + 1 + x] = ((rgba[src + x] as number) - (rgba[src + x - 4] as number)) & 0xff;
    }
  }

  return out;
}
