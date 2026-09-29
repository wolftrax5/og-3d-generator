import assert from 'node:assert/strict';
import { test } from 'node:test';

import { blobPathname, isRenderJob, jobKey, toJob } from '../lib/og3d/job.ts';
import { DEFAULTS, parseParams } from '../lib/og3d/params.ts';

const parse = (query: string) => parseParams(new URLSearchParams(query));

test('a job key is stable for the same parameters', () => {
  const job = toJob(parse('shape=sphere&color=ff0000'));
  assert.equal(jobKey(job), jobKey({ ...job }));
  assert.notEqual(jobKey(job), jobKey({ ...job, color: '00ff00' }));
});

test('the blob pathname is the key under og/', () => {
  const job = toJob(DEFAULTS);
  assert.equal(blobPathname(job), `og/${jobKey(job)}.png`);
});

test('parsed params round-trip into a render job', () => {
  const job = toJob(parse('shape=knot&rx=10&ry=-20&ss=1'));
  assert.equal(isRenderJob(job), true);
  assert.equal(job.shape, 'torusknot');
  assert.equal(job.rotationX, 10);
  assert.equal(job.rotationY, -20);
  assert.equal(job.supersample, 1);
});

test('a queue payload missing fields is rejected', () => {
  assert.equal(isRenderJob(null), false);
  assert.equal(isRenderJob({ shape: 'cube' }), false);
  assert.equal(isRenderJob({ ...toJob(DEFAULTS), shape: 'dragon' }), false);
});
