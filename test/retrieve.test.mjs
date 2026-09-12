import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunk, match } from '../src/coursewright.js';

const docs = [
  'Trigger control is a smooth, consistent rearward squeeze of the trigger while maintaining aim until the bullet leaves the muzzle.\n\nA pace count is the number of paces it takes to walk one hundred meters over known-distance ground.',
];

test('chunk splits documents into passages', () => {
  const c = chunk(docs);
  assert.ok(c.length >= 1);
  assert.ok(c[0].text.length > 0);
});

test('match picks the passage that covers the objective', () => {
  const c = chunk(docs);
  const hit = match('Explain trigger control and the squeeze', c);
  assert.ok(hit);
  assert.match(hit.text, /trigger/i);
});

test('match returns null when the objective is not covered', () => {
  const c = chunk(docs);
  const hit = match('Describe hypersonic reentry vehicle thermal protection', c);
  assert.equal(hit, null);
});

test('chunk packs paragraphs and splits when a chunk exceeds maxWords', () => {
  const para = (label) => `${label} ` + 'word '.repeat(30).trim();
  const doc = [para('alpha'), para('bravo'), para('charlie')].join('\n\n');
  const c = chunk(doc, 40); // ~31 words per paragraph, so each chunk holds one paragraph
  assert.equal(c.length, 3);
  assert.match(c[0].text, /alpha/);
  assert.match(c[2].text, /charlie/);
});

test('chunk keeps the source from object documents', () => {
  const c = chunk({ text: 'A short passage about tides and the moon.', source: 'Field Guide' });
  assert.equal(c.length, 1);
  assert.equal(c[0].source, 'Field Guide');
});

test('chunk skips null, empty, and text-less documents', () => {
  const c = chunk([null, '', { source: 'no text here' }, 'Real content about maps.']);
  assert.equal(c.length, 1);
  assert.match(c[0].text, /maps/);
});

test('match ranks by keyword overlap across chunks', () => {
  const chunks = [
    { text: 'Baking bread requires yeast, flour, water, and patient proofing.', source: 'A' },
    { text: 'Navigation uses a map, a compass, and a known pace count over terrain.', source: 'B' },
  ];
  const hit = match('Use a map and compass to navigate terrain', chunks);
  assert.ok(hit);
  assert.equal(hit.source, 'B');
  assert.ok(hit.score > 0);
});

test('match returns null for an objective with no usable keywords', () => {
  const c = chunk(docs);
  assert.equal(match('a an the of to', c), null);
  assert.equal(match('', c), null);
});
