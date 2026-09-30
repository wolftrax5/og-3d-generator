/**
 * Finished frames live in Vercel Blob. The public route reads them; the
 * queue consumer writes them. A missing token or a missing object is a
 * cache miss, never a failed OpenGraph response.
 */

import { BlobNotFoundError, head, put } from '@vercel/blob';

import { blobPathname, type RenderJob } from './job.ts';

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function findCachedPng(job: RenderJob): Promise<{ url: string } | null> {
  if (!process.env.BLOB_READ_WRITE_TOKEN) return null;

  try {
    const meta = await head(blobPathname(job));
    return { url: meta.url };
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    console.error('og-3d: blob lookup failed', error);
    return null;
  }
}

export async function storePng(job: RenderJob, png: Buffer): Promise<string> {
  const blob = await put(blobPathname(job), png, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'image/png',
    cacheControlMaxAge: YEAR_SECONDS,
  });
  return blob.url;
}
