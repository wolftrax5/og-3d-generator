/**
 * CPU-side pixel post-processing between GPU readback and PNG encoding.
 */

/**
 * WebGPU requires `bytesPerRow` in a texture-to-buffer copy to be a multiple of
 * 256, so Three.js hands back rows padded to that alignment. Strip the padding
 * to get a tightly packed RGBA buffer.
 *
 * The source may be short by the padding of its final row: the copy only needs
 * `(height - 1) * stride + width * 4` bytes.
 */
export function depadRows(source: Uint8Array, width: number, height: number): Uint8Array {
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

/**
 * Box-filters an N× oversampled frame down to its final size.
 *
 * Color channels are averaged weighted by alpha. A plain average would pull the
 * fully transparent background's RGB (which the GPU clears to zero) into edge
 * pixels and leave a dark halo around the silhouette on a transparent
 * background.
 */
export function downsample(
  source: Uint8Array,
  width: number,
  height: number,
  factor: number,
): Uint8Array {
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
          const alpha = source[i + 3] as number;
          r += (source[i] as number) * alpha;
          g += (source[i + 1] as number) * alpha;
          b += (source[i + 2] as number) * alpha;
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
