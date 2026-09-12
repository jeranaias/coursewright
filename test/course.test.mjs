import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../src/index.js';
import { buildCourse, fromDocuments, isRefusal } from '../src/coursewright.js';

test('the public entry point re-exports the whole surface', () => {
  for (const name of ['buildCourse', 'fromDocuments', 'chunk', 'match']) {
    assert.equal(typeof api[name], 'function', `index.js should export ${name}`);
  }
});

test('isRefusal flags refusals, errors, and empty content', () => {
  assert.equal(isRefusal({ lesson: 'A real, grounded lesson.' }), false);
  assert.equal(isRefusal({ refused: true, reason: 'unsupported' }), true);
  assert.equal(isRefusal({ error: 'HTTP 500' }), true);
  assert.equal(isRefusal({}), true);
  assert.equal(isRefusal(null), true);
});

test('buildCourse validates its input', async () => {
  await assert.rejects(() => buildCourse(null), TypeError);
  await assert.rejects(() => buildCourse({ objectives: 'not-an-array' }), TypeError);
});

test('buildCourse with no objectives returns an empty course without calling a model', async () => {
  // No objectives means no grounding passages, so no model is contacted regardless of any key.
  const course = await buildCourse({ title: 'Empty Course', objectives: [] });
  assert.equal(course.title, 'Empty Course');
  assert.deepEqual(course.sections, []);
  assert.equal(course.scenario, undefined);
});

test('fromDocuments skips objectives the documents do not cover, never inventing them', async () => {
  const events = [];
  const course = await fromDocuments({
    title: 'Coastal Basics',
    objectives: ['Explain how ocean tides are driven by the moon.'],
    documents: [{ text: 'Sourdough baking relies on wild yeast, flour, water, and time.', source: 'Kitchen Notes' }],
  }, (e) => events.push(e));
  // The one objective is unsupported by the documents, so it is skipped and nothing is generated.
  assert.deepEqual(course.sections, []);
  assert.ok(events.some((e) => e.step === 'skipped'), 'should emit a skipped event for the uncovered objective');
});
