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
