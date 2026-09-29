/**
 * Publishes one render per parameter set. The idempotency key collapses
 * repeated crawler hits into a single delivery for the message retention
 * window; a failed attempt is still retried by the queue itself.
 */

import { send } from '@vercel/queue';

import { RENDER_TOPIC, jobKey, toJob } from './job.ts';
import type { OgParams } from './params.ts';

export async function enqueueRender(params: OgParams): Promise<void> {
  const job = toJob(params);
  try {
    await send(RENDER_TOPIC, job, { idempotencyKey: jobKey(job) });
  } catch (error) {
    console.error('og-3d: enqueue failed', error);
  }
}
