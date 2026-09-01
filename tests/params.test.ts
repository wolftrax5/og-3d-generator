import assert from 'node:assert/strict';
import { test } from 'node:test';

import { DEFAULTS, LIMITS, paramsFingerprint, parseParams } from '../lib/og3d/params.ts';

const parse = (query: string) => parseParams(new URLSearchParams(query));

test('an empty query yields the documented defaults', () => {
  assert.deepEqual(parse(''), DEFAULTS);
});

test('shapes resolve through canonical names and aliases', () => {
  assert.equal(parse('shape=sphere').shape, 'sphere');
  assert.equal(parse('shape=SPHERE').shape, 'sphere');
  assert.equal(parse('shape=box').shape, 'cube');
  assert.equal(parse('shape=donut').shape, 'torus');
  assert.equal(parse('s=knot').shape, 'torusknot');
});

test('an unknown shape falls back rather than failing', () => {
  assert.equal(parse('shape=dragon').shape, DEFAULTS.shape);
});

test('colors accept hex, short hex, a leading hash and names', () => {
  assert.equal(parse('color=ff0000').color, 'ff0000');
  assert.equal(parse('color=%23FF0000').color, 'ff0000');
  assert.equal(parse('color=f00').color, 'ff0000');
  assert.equal(parse('color=blue').color, '3b82f6');
  assert.equal(parse('c=abc').color, 'aabbcc');
});

test('a malformed color falls back to the default', () => {
  assert.equal(parse('color=notacolor').color, DEFAULTS.color);
  assert.equal(parse('color=12345').color, DEFAULTS.color);
});

test('background accepts transparency keywords', () => {
  assert.equal(parse('bg=transparent').background, null);
  assert.equal(parse('bg=none').background, null);
  assert.equal(parse('bg=101010').background, '101010');
});

test('numeric ranges are clamped, not rejected', () => {
  assert.equal(parse('roughness=5').roughness, 1);
  assert.equal(parse('roughness=-3').metalness, DEFAULTS.metalness);
  assert.equal(parse('roughness=-3').roughness, 0);
  assert.equal(parse('metalness=0.5').metalness, 0.5);
  assert.equal(parse('zoom=99').zoom, 4);
  assert.equal(parse('light=0').light, 0);
});

test('non-numeric values fall back instead of becoming NaN', () => {
  assert.equal(parse('roughness=abc').roughness, DEFAULTS.roughness);
  assert.equal(parse('w=').width, DEFAULTS.width);
  assert.equal(parse('w=Infinity').width, DEFAULTS.width);
});

test('dimensions are clamped to the supported range and rounded', () => {
  assert.equal(parse('w=10&h=10').width, LIMITS.minSize);
  assert.equal(parse('w=99999').width, LIMITS.maxSize);
  assert.equal(parse('w=800.6').width, 801);
});

test('boolean flags accept bare presence and explicit values', () => {
  assert.equal(parse('wireframe').wireframe, true);
  assert.equal(parse('wireframe=1').wireframe, true);
  assert.equal(parse('wireframe=false').wireframe, false);
  assert.equal(parse('wire=yes').wireframe, true);
  assert.equal(parse('wireframe=maybe').wireframe, DEFAULTS.wireframe);
});

test('supersampling is reduced to stay inside the render budget', () => {
  const big = parse(`w=${LIMITS.maxSize}&h=${LIMITS.maxSize}&ss=3`);
  assert.equal(big.supersample, 1);

  assert.equal(parse('w=1200&h=630&ss=2').supersample, 2);
  assert.equal(parse('w=1200&h=630&ss=3').supersample, 2, '3x of 1200x630 exceeds the budget');
});

test('the render budget holds for every reachable size and supersample factor', () => {
  const sizes = [LIMITS.minSize, 630, 800, 1200, 1600, LIMITS.maxSize];

  for (const w of sizes) {
    for (const h of sizes) {
      for (let ss = 1; ss <= LIMITS.maxSupersample; ss++) {
        const p = parse(`w=${w}&h=${h}&ss=${ss}`);
        const renderPixels = p.width * p.supersample * p.height * p.supersample;
        assert.ok(
          renderPixels <= LIMITS.maxRenderPixels,
          `${w}x${h} at ss=${ss} resolved to ${renderPixels} render pixels`,
        );
        assert.ok(p.supersample >= 1, 'supersample must never drop below 1');
      }
    }
  }
});

test('long and short parameter spellings agree', () => {
  assert.deepEqual(
    parse('shape=torus&color=ff0000&roughness=0.2&metalness=0.8&width=800&height=400'),
    parse('s=torus&c=ff0000&r=0.2&m=0.8&w=800&h=400'),
  );
});

test('fingerprints differ for different parameters and match for equal ones', () => {
  assert.equal(paramsFingerprint(parse('shape=cube')), paramsFingerprint(parse('shape=box')));
  assert.notEqual(paramsFingerprint(parse('shape=cube')), paramsFingerprint(parse('shape=sphere')));
  assert.notEqual(
    paramsFingerprint(parse('color=ff0000')),
    paramsFingerprint(parse('color=00ff00')),
  );
});
