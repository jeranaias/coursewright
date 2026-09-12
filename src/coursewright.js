// Coursewright — generate a complete, cited course from objectives and your source passages.
// Each objective carries a grounding passage; Coursewright writes a micro-lesson, a labeled diagram,
// pre/post checks, and flashcards for it — cite-or-refuse throughout, and every artifact is
// mechanically verified against its passage before it ships — then a capstone scenario with
// coaching, discussion prompts, and an instructor summary. Returns plain JSON. No database required.
import { chunk, match, tokens } from './retrieve.js';
const ENDPOINT = process.env.COURSEWRIGHT_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
const TEXT = process.env.COURSEWRIGHT_MODEL || 'google/gemini-3-flash-preview';
const DIAG = process.env.COURSEWRIGHT_DIAGRAM_MODEL || 'google/gemini-3.1-pro-preview';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GROUND = 'Use ONLY the provided source passage; every claim must be supported by it. If unsupported, output {"refused":true,"reason":"..."}.';

/**
 * Mechanically check that generated text is grounded in its source passage, by token overlap:
 * the fraction of `text`'s distinct content words that also appear in `passage`. This does not
 * trust the model's own `refused` flag — it measures the artifact against the source directly, so
 * fabricated standards or numbers that never appear in the passage drag the score below the floor.
 * @param {string} text The generated artifact text.
 * @param {string} passage The source passage it must be grounded in.
 * @param {number} [threshold=0.4] Minimum fraction of `text`'s content words found in `passage`.
 * @returns {{grounded:boolean, overlap:number, matched:number, total:number}}
 */
export function verifyGrounding(text, passage, threshold = 0.4) {
  const t = [...new Set(tokens(text))];
  const p = new Set(tokens(passage));
  if (!t.length) return { grounded: false, overlap: 0, matched: 0, total: 0 };
  let matched = 0;
  for (const w of t) if (p.has(w)) matched++;
  const overlap = matched / t.length;
  return { grounded: overlap >= threshold, overlap, matched, total: t.length };
}

/**
 * True when a model response cannot ground a lesson — an explicit refusal, a request error,
 * or empty content. Used to skip the rest of a section instead of emitting empty artifacts.
 * @param {object} resp Parsed model response.
 * @returns {boolean}
 */
export function isRefusal(resp) {
  return !resp || resp.refused === true || !!resp.error || !resp.lesson;
}

// A human-readable reason a model response can't be used, or null when it's usable.
function refusalReason(resp) {
  if (!resp) return 'empty response';
  if (resp.error) return `unavailable (${resp.error})`;
  if (resp.refused === true) return resp.reason || 'not supported by the provided passage';
  return null;
}

// The default network ask. Kept injectable (see makeAsk / the `ask`/`fetch` build options) so the
// generation path is testable without a live endpoint.
function makeAsk(fetchImpl) {
  const doFetch = fetchImpl || globalThis.fetch;
  return async function ask(model, system, user, tries = 4, timeoutMs = 90000) {
    const KEY = process.env.COURSEWRIGHT_API_KEY || process.env.OPENROUTER_API_KEY;
    if (!KEY) return { error: 'set COURSEWRIGHT_API_KEY (or OPENROUTER_API_KEY)' };
    for (let a = 1; a <= tries; a++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await doFetch(ENDPOINT, { method: 'POST', signal: ctrl.signal,
          headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, temperature: 0.2, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }) });
        if ((res.status === 429 || res.status === 503) && a < tries) { await sleep(3000 * a); continue; }
        if (!res.ok) return { error: `HTTP ${res.status}` };
        const t = (await res.json()).choices?.[0]?.message?.content ?? '';
        try { return JSON.parse(t); } catch {}
        const m = t.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} }
        return { error: 'no-json' };
      } catch (e) {
        if (a < tries) { await sleep(3000 * a); continue; }
        return { error: e?.name === 'AbortError' ? 'timeout' : String(e) };
      } finally { clearTimeout(timer); }
    }
    return { error: 'failed' };
  };
}

// Fire a progress callback without ever letting a throwing callback abort the build.
function safeEmit(emit, evt) {
  if (typeof emit !== 'function') return;
  try { emit(evt); } catch {}
}

async function genSection(obj, opts, emit, ask) {
  const title = obj.title || obj.objective || 'Untitled';
  const section = { title, cite: obj.cite || null };

  // No usable passage means nothing can be grounded — refuse the section rather than prompting the
  // model with the string "undefined".
  if (typeof obj.passage !== 'string' || !obj.passage.trim()) {
    section.refused = true;
    section.reason = 'no grounding passage supplied';
    safeEmit(emit, { ok: false, kind: 'lesson', section: title, reason: section.reason });
    return section;
  }
  const passage = obj.passage;
  const src = `Source passage:\n"${passage}"\n${obj.cite ? 'Citation: ' + obj.cite : ''}\nObjective: ${obj.objective || ''}`;

  const lesson = await ask(TEXT, `You are an instructor writing a micro-lesson. Factual claims must come ONLY from the passage — never invent standards or numbers not present. You MAY add brief framing (why it matters, one coaching cue) consistent with the passage. If unsupported, output {"refused":true,"reason":"..."}. Output JSON only: {"refused":false,"lesson":"<4-7 sentences: the concept and why it matters; the most common error and how to correct it; a coaching cue>"}`, `${src}\nWrite the micro-lesson.`);
  // Gate the lesson on BOTH the model's own refusal AND a mechanical grounding check, so an
  // ungrounded lesson the model happily returned (refused:false) is still rejected.
  const lessonReason = refusalReason(lesson) || (!lesson.lesson ? 'empty lesson'
    : (!verifyGrounding(lesson.lesson, passage).grounded ? 'lesson not grounded in the passage' : null));
  if (lessonReason) {
    section.refused = true;
    section.reason = lessonReason;
    safeEmit(emit, { ok: false, kind: 'lesson', section: title, reason: lessonReason });
    return section;
  }
  section.lesson = lesson.lesson;
  section.refusals = {};
  safeEmit(emit, { ok: true, kind: 'lesson', section: title });

  if (opts.diagrams !== false) {
    const d = await ask(DIAG, `${GROUND} You are a technical diagram author. Output JSON only: {"refused":false,"title":"...","viewBox":"0 0 340 200","elements":[...]}. Types: circle{type,cx,cy,r,stroke,fill}; rect{type,x,y,w,h,fill,stroke}; line{type,x1,y1,x2,y2,stroke}; text{type,x,y,text}. Include a label for each key part. Colors MUST be one of "dim","glow","glow2","danger","readout","none".`, `${src}\nProduce a labeled schematic diagram for a learner.`, 4, 120000);
    const labelText = d && Array.isArray(d.elements) ? [d.title, ...d.elements.map((e) => e && e.text).filter(Boolean)].join(' ') : '';
    const dReason = refusalReason(d) || (!d.elements ? 'no diagram produced'
      : (!verifyGrounding(labelText, passage).grounded ? 'diagram labels not grounded in the passage' : null));
    if (dReason) { section.refusals.diagram = dReason; safeEmit(emit, { ok: false, kind: 'diagram', section: title, reason: dReason }); }
    else { section.diagram = d; safeEmit(emit, { ok: true, kind: 'diagram', section: title }); }
  }

  for (const phase of ['pre', 'post']) {
    const t = await ask(TEXT, `${GROUND} Output JSON only: {"refused":false,"items":[{"stem":"...","options":["A","B","C","D"],"answerIndex":0,"rationale":"..."}]}`,
      `${src}\nWrite TWO multiple-choice questions${phase === 'post' ? ' (a PARALLEL FORM vs a pre-test, same objective)' : ''} testing this objective, grounded, with keyed answers.`);
    // Verify the stems + rationales (the load-bearing, source-derived text) against the passage;
    // distractor options are meant to be wrong, so they're not part of the grounding check.
    const items = Array.isArray(t.items) ? t.items : [];
    const claimText = items.map((q) => `${q.stem || ''} ${q.rationale || ''}`).join(' ');
    const tReason = refusalReason(t) || (!items.length ? 'no questions produced'
      : (!verifyGrounding(claimText, passage).grounded ? 'questions not grounded in the passage' : null));
    if (tReason) { section.refusals[phase] = tReason; safeEmit(emit, { ok: false, kind: phase + '-test', section: title, reason: tReason }); }
    else {
      section[phase] = items.map((q) => ({ stem: q.stem, options: q.options, answer: q.answerIndex, rationale: q.rationale }));
      safeEmit(emit, { ok: true, kind: phase + '-test', section: title });
    }
  }

  const fc = await ask(TEXT, `${GROUND} Output JSON only: {"refused":false,"cards":[{"front":"...","back":"..."}]}`, `${src}\nWrite THREE study flashcards (front/back) from the passage.`);
  const cards = Array.isArray(fc.cards) ? fc.cards : [];
  const cardText = cards.map((c) => `${c.front || ''} ${c.back || ''}`).join(' ');
  const fcReason = refusalReason(fc) || (!cards.length ? 'no flashcards produced'
    : (!verifyGrounding(cardText, passage).grounded ? 'flashcards not grounded in the passage' : null));
  if (fcReason) { section.refusals.flashcards = fcReason; safeEmit(emit, { ok: false, kind: 'flashcards', section: title, reason: fcReason }); }
  else { section.flashcards = cards.map((c) => ({ front: c.front, back: c.back })); safeEmit(emit, { ok: true, kind: 'flashcards', section: title }); }
  return section;
}

async function genApply(objectives, title, emit, ask) {
  const grounded = objectives.filter((o) => typeof o.passage === 'string' && o.passage.trim());
  if (!grounded.length) return {};
  const ctx = grounded.slice(0, 6).map((g, i) => `[${i + 1}] ${g.passage}`).join('\n\n');
  const passages = grounded.map((g) => g.passage).join('\n');
  const out = {};
  const sc = await ask(TEXT, `${GROUND} Design ONE realistic applied scenario exercise for "${title}" plus the coaching a strong instructor would give. Output JSON only: {"refused":false,"situation":"<2-4 sentences>","task":"<the decision or product the learner must produce>","coaching":"<3-5 sentences citing passage numbers like [1]>"}`, `Passages:\n${ctx}\n\nWrite the scenario and coaching.`);
  if (!refusalReason(sc) && sc.situation && verifyGrounding(`${sc.situation} ${sc.task || ''} ${sc.coaching || ''}`, passages).grounded) {
    out.scenario = { situation: sc.situation, task: sc.task, coaching: sc.coaching }; safeEmit(emit, { ok: true, kind: 'scenario' });
  } else safeEmit(emit, { ok: false, kind: 'scenario', reason: refusalReason(sc) || 'scenario not grounded in the passages' });
  const dp = await ask(TEXT, `${GROUND} Write THREE open-ended discussion prompts for "${title}" that push analysis and evaluation. Output JSON only: {"refused":false,"prompts":["...","...","..."]}`, `Passages:\n${ctx}\n\nWrite the discussion prompts.`);
  if (!refusalReason(dp) && Array.isArray(dp.prompts) && verifyGrounding(dp.prompts.join(' '), passages).grounded) {
    out.discussion = dp.prompts; safeEmit(emit, { ok: true, kind: 'discussion' });
  } else safeEmit(emit, { ok: false, kind: 'discussion', reason: refusalReason(dp) || 'discussion prompts not grounded in the passages' });
  // The instructor summary is grounded too: it is given the actual passages as context AND the GROUND
  // instruction, then verified against them — no ungrounded overview of objective strings.
  const su = await ask(TEXT, `${GROUND} You summarize a generated course for the instructor who will review it. Output JSON only: {"refused":false,"summary":"<4-6 sentences: what it covers, its objectives, how the pieces fit, what to review first>"}`, `Course: "${title}".\nObjectives:\n${grounded.map((g, i) => `${i + 1}. ${g.objective}`).join('\n')}\n\nSource passages:\n${ctx}\n\nWrite the summary.`);
  if (!refusalReason(su) && su.summary && verifyGrounding(su.summary, passages).grounded) {
    out.summary = su.summary; safeEmit(emit, { ok: true, kind: 'summary' });
  } else safeEmit(emit, { ok: false, kind: 'summary', reason: refusalReason(su) || 'summary not grounded in the passages' });
  return out;
}

/**
 * Build a course from objectives that each carry a grounding passage.
 * @param {{ title?: string, diagrams?: boolean, objectives?: {objective:string, passage:string, cite?:string, title?:string}[] }} spec
 *   Course title and the objectives to teach. Each objective supplies the `passage` that grounds it.
 * @param {(evt:object)=>void} [emit] Progress callback; fired as each artifact lands.
 * @param {{ ask?: Function, fetch?: Function }} [options] Inject an `ask(model,system,user,tries,timeoutMs)`
 *   function (or a `fetch` override) to make the generation path testable without a live endpoint.
 * @returns {Promise<object>} Course JSON: `{ title, sections:[…], scenario?, discussion?, summary? }`.
 *   A section whose passage can't ground it comes back as `{ title, cite, refused:true, reason }`;
 *   an ungrounded individual artifact is dropped and its reason recorded under `section.refusals`.
 */
export async function buildCourse(spec, emit, options = {}) {
  if (!spec || typeof spec !== 'object') throw new TypeError('buildCourse(spec): spec must be an object');
  if (spec.objectives != null && !Array.isArray(spec.objectives)) throw new TypeError('buildCourse(spec): spec.objectives must be an array');
  const ask = options.ask || makeAsk(options.fetch);
  const title = spec.title || 'Generated Course';
  const objectives = spec.objectives || [];
  const sections = [];
  for (const obj of objectives) {
    safeEmit(emit, { step: 'section', section: obj.title || obj.objective });
    sections.push(await genSection(obj, spec, emit, ask));
  }
  const apply = await genApply(objectives, title, emit, ask);
  safeEmit(emit, { step: 'done' });
  return { title, sections, ...apply };
}

/**
 * Build a course straight from raw documents: chunk them, retrieve the best passage per objective,
 * then generate. Objectives whose topic isn't covered by the documents are skipped (never invented).
 * @param {{ title?: string, objectives?: (string|{objective:string,title?:string})[], documents?: (string|{text:string,source?:string})[], diagrams?: boolean }} spec
 * @param {(evt:object)=>void} [emit] Progress callback; also fires `{ step:'skipped', section }` per uncovered objective.
 * @param {{ ask?: Function, fetch?: Function }} [options] Same injection points as {@link buildCourse}.
 * @returns {Promise<object>} Course JSON, same shape as {@link buildCourse}.
 */
export async function fromDocuments(spec, emit, options = {}) {
  if (!spec || typeof spec !== 'object') throw new TypeError('fromDocuments(spec): spec must be an object');
  const chunks = chunk(spec.documents || []);
  const objectives = [];
  for (const o of (spec.objectives || [])) {
    const objective = typeof o === 'string' ? o : o.objective;
    const hit = match(objective, chunks);
    if (!hit) { safeEmit(emit, { step: 'skipped', section: objective }); continue; } // not covered by the sources
    objectives.push({ objective, title: (typeof o === 'object' && o.title) || objective, passage: hit.text, cite: hit.source || null });
  }
  return buildCourse({ title: spec.title, objectives, diagrams: spec.diagrams }, emit, options);
}

export { chunk, match } from './retrieve.js';
