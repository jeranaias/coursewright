import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCourse, verifyGrounding, isRefusal } from '../src/coursewright.js';

const PASSAGE = 'Trigger control is a smooth, consistent rearward squeeze of the trigger while maintaining aim and stabilization until the bullet leaves the muzzle.';

// A mocked `ask` that returns well-grounded artifacts derived from the passage. Routes on the user
// prompt so every stage (lesson/diagram/tests/flashcards/scenario/discussion/summary) gets an answer.
function groundedAsk(passage = PASSAGE) {
  return async (_model, _system, user) => {
    if (/micro-lesson/.test(user)) return { refused: false, lesson: passage + ' This matters because a jerked trigger disturbs aim; the fix is a smooth rearward squeeze.' };
    if (/diagram/.test(user)) return { refused: false, title: 'Trigger control', viewBox: '0 0 340 200', elements: [{ type: 'text', x: 10, y: 10, text: 'trigger squeeze muzzle aim' }] };
    if (/multiple-choice/.test(user)) return { refused: false, items: [{ stem: 'What describes trigger control squeeze?', options: ['smooth rearward squeeze', 'a jerk', 'no aim', 'random'], answerIndex: 0, rationale: 'a smooth rearward squeeze while maintaining aim until the bullet leaves the muzzle' }] };
    if (/flashcards/.test(user)) return { refused: false, cards: [{ front: 'trigger control', back: 'smooth rearward squeeze maintaining aim until the bullet leaves the muzzle' }] };
    if (/scenario/.test(user)) return { refused: false, situation: 'A shooter jerks the trigger and loses aim before the bullet leaves the muzzle.', task: 'demonstrate a smooth rearward squeeze', coaching: 'maintain aim and stabilization until the bullet leaves the muzzle [1]' };
    if (/discussion/.test(user)) return { refused: false, prompts: ['Analyze how a rearward squeeze maintains aim until the bullet leaves the muzzle.', 'Evaluate trigger control versus stabilization.', 'Why does a jerked trigger disturb aim?'] };
    if (/summary/.test(user)) return { refused: false, summary: 'This course covers trigger control: a smooth rearward squeeze maintaining aim and stabilization until the bullet leaves the muzzle.' };
    return { error: 'unexpected-prompt' };
  };
}

const spec = () => ({ title: 'Marksmanship', objectives: [{ objective: 'Explain trigger control.', title: 'Trigger Control', passage: PASSAGE, cite: 'Ch.8' }] });

test('verifyGrounding passes grounded text and fails fabricated text', () => {
  assert.equal(verifyGrounding('a smooth rearward squeeze of the trigger until the bullet leaves the muzzle', PASSAGE).grounded, true);
  assert.equal(verifyGrounding('The rifle fires a 5.56mm cartridge at 940 meters per second per NATO standard.', PASSAGE).grounded, false);
  assert.equal(verifyGrounding('', PASSAGE).grounded, false);
});

test('a grounded build produces every artifact (mocked ask, no network)', async () => {
  const events = [];
  const course = await buildCourse(spec(), (e) => events.push(e), { ask: groundedAsk() });
  const s = course.sections[0];
  assert.equal(s.refused, undefined);
  assert.match(s.lesson, /squeeze/);
  assert.ok(s.diagram && s.diagram.elements.length > 0);
  assert.equal(s.pre.length, 1);
  assert.equal(s.post.length, 1);
  assert.equal(s.flashcards.length, 1);
  assert.deepEqual(s.refusals, {});
  assert.ok(course.scenario && course.discussion && course.summary);
  assert.ok(events.some((e) => e.kind === 'lesson' && e.ok === true));
});

test('a model refusal gates the whole section (isRefusal wired in)', async () => {
  const ask = async (_m, _s, user) => /micro-lesson/.test(user) ? { refused: true, reason: 'not in passage' } : { error: 'should-not-reach' };
  const course = await buildCourse(spec(), null, { ask });
  const s = course.sections[0];
  assert.equal(s.refused, true);
  assert.equal(s.reason, 'not in passage');
  assert.equal(s.lesson, undefined);
  // The section gate mirrors isRefusal on the lesson response.
  assert.equal(isRefusal({ refused: true, reason: 'not in passage' }), true);
});

test('an ungrounded lesson is rejected even when the model says refused:false', async () => {
  // The model returns refused:false but the lesson has nothing to do with the passage; the
  // mechanical grounding gate must still refuse the section rather than trusting the flag.
  const ask = async (_m, _s, user) => /micro-lesson/.test(user)
    ? { refused: false, lesson: 'Photosynthesis converts sunlight into chemical energy inside chloroplasts of green plants.' }
    : { error: 'should-not-reach' };
  const s = (await buildCourse(spec(), null, { ask })).sections[0];
  assert.equal(s.refused, true);
  assert.match(s.reason, /not grounded/);
});

test('an error/timeout on the lesson refuses the section with the reason surfaced', async () => {
  const ask = async (_m, _s, user) => /micro-lesson/.test(user) ? { error: 'timeout' } : { error: 'x' };
  const s = (await buildCourse(spec(), null, { ask })).sections[0];
  assert.equal(s.refused, true);
  assert.match(s.reason, /timeout/);
});

test('a per-artifact refusal is surfaced without sinking the section', async () => {
  // Lesson is grounded, but the diagram refuses; the section survives and records the reason.
  const base = groundedAsk();
  const ask = async (model, system, user) => /diagram/.test(user) ? { refused: true, reason: 'no schematic possible' } : base(model, system, user);
  const events = [];
  const s = (await buildCourse(spec(), (e) => events.push(e), { ask })).sections[0];
  assert.equal(s.refused, undefined);
  assert.match(s.lesson, /squeeze/);
  assert.equal(s.diagram, undefined);
  assert.equal(s.refusals.diagram, 'no schematic possible');
  assert.ok(events.some((e) => e.kind === 'diagram' && e.ok === false && e.reason === 'no schematic possible'));
});

test('a missing/empty passage refuses the section without prompting the model', async () => {
  let called = false;
  const ask = async () => { called = true; return { refused: false, lesson: 'x' }; };
  const spec2 = { title: 'T', objectives: [{ objective: 'Explain X.', title: 'X', passage: '   ' }] };
  const s = (await buildCourse(spec2, null, { ask })).sections[0];
  assert.equal(s.refused, true);
  assert.match(s.reason, /no grounding passage/);
  assert.equal(called, false, 'the model must not be called for an empty passage');
});

test('a throwing emit callback cannot abort the build', async () => {
  const boom = () => { throw new Error('progress handler blew up'); };
  const course = await buildCourse(spec(), boom, { ask: groundedAsk() });
  assert.ok(course.sections[0].lesson, 'build completes despite a throwing emit');
});
