// Coursewright — generate a complete, cited course from objectives and your source passages.
// Each objective carries a grounding passage; Coursewright writes a micro-lesson, a labeled diagram,
// pre/post checks, and flashcards for it — cite-or-refuse throughout — then a capstone scenario with
// coaching, discussion prompts, and an instructor summary. Returns plain JSON. No database required.
import { chunk, match } from './retrieve.js';
const ENDPOINT = process.env.COURSEWRIGHT_ENDPOINT || 'https://openrouter.ai/api/v1/chat/completions';
const TEXT = process.env.COURSEWRIGHT_MODEL || 'google/gemini-3-flash-preview';
const DIAG = process.env.COURSEWRIGHT_DIAGRAM_MODEL || 'google/gemini-3.1-pro-preview';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GROUND = 'Use ONLY the provided source passage; every claim must be supported by it. If unsupported, output {"refused":true,"reason":"..."}.';

async function ask(model, system, user, tries = 4, timeoutMs = 90000) {
  const KEY = process.env.COURSEWRIGHT_API_KEY || process.env.OPENROUTER_API_KEY;
  if (!KEY) return { error: 'set COURSEWRIGHT_API_KEY (or OPENROUTER_API_KEY)' };
  for (let a = 1; a <= tries; a++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(ENDPOINT, { method: 'POST', signal: ctrl.signal,
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
}

async function genSection(obj, opts, emit) {
  const src = `Source passage:\n"${obj.passage}"\n${obj.cite ? 'Citation: ' + obj.cite : ''}\nObjective: ${obj.objective}`;
  const section = { title: obj.title || obj.objective, cite: obj.cite || null };

  const lesson = await ask(TEXT, `You are an instructor writing a micro-lesson. Doctrinal FACTS must come ONLY from the passage — never invent standards or numbers not present. You MAY add brief framing (why it matters, one coaching cue) consistent with the passage. If unsupported, output {"refused":true,"reason":"..."}. Output JSON only: {"refused":false,"lesson":"<4-7 sentences: the concept and why it matters; the most common error and how to correct it; a coaching cue>"}`, `${src}\nWrite the micro-lesson.`);
  if (lesson.lesson) { section.lesson = lesson.lesson; emit?.({ ok: true, kind: 'lesson', section: section.title }); }

  if (opts.diagrams !== false) {
    const d = await ask(DIAG, `${GROUND} You are a technical diagram author. Output JSON only: {"refused":false,"title":"...","viewBox":"0 0 340 200","elements":[...]}. Types: circle{type,cx,cy,r,stroke,fill}; rect{type,x,y,w,h,fill,stroke}; line{type,x1,y1,x2,y2,stroke}; text{type,x,y,text}. Include a label for each key part. Colors MUST be one of "dim","glow","glow2","danger","readout","none".`, `${src}\nProduce a labeled schematic diagram for a learner.`, 4, 120000);
    if (d.elements) { section.diagram = d; emit?.({ ok: true, kind: 'diagram', section: section.title }); }
  }

  for (const phase of ['pre', 'post']) {
    const t = await ask(TEXT, `${GROUND} Output JSON only: {"refused":false,"items":[{"stem":"...","options":["A","B","C","D"],"answerIndex":0,"rationale":"..."}]}`,
      `${src}\nWrite TWO multiple-choice questions${phase === 'post' ? ' (a PARALLEL FORM vs a pre-test, same objective)' : ''} testing this objective, grounded, with keyed answers.`);
    section[phase] = (t.items || []).map((q) => ({ stem: q.stem, options: q.options, answer: q.answerIndex, rationale: q.rationale }));
    emit?.({ ok: (section[phase] || []).length > 0, kind: phase + '-test', section: section.title });
  }

  const fc = await ask(TEXT, `${GROUND} Output JSON only: {"refused":false,"cards":[{"front":"...","back":"..."}]}`, `${src}\nWrite THREE study flashcards (front/back) from the passage.`);
  section.flashcards = (fc.cards || []).map((c) => ({ front: c.front, back: c.back }));
  emit?.({ ok: section.flashcards.length > 0, kind: 'flashcards', section: section.title });
  return section;
}

async function genApply(objectives, title, emit) {
  const grounded = objectives.filter((o) => o.passage);
  if (!grounded.length) return {};
  const ctx = grounded.slice(0, 6).map((g, i) => `[${i + 1}] ${g.passage}`).join('\n\n');
  const out = {};
  const sc = await ask(TEXT, `${GROUND} Design ONE realistic applied scenario exercise for "${title}" plus the coaching a strong instructor would give. Output JSON only: {"refused":false,"situation":"<2-4 sentences>","task":"<the decision or product the learner must produce>","coaching":"<3-5 sentences citing passage numbers like [1]>"}`, `Passages:\n${ctx}\n\nWrite the scenario and coaching.`);
  if (sc.situation) { out.scenario = { situation: sc.situation, task: sc.task, coaching: sc.coaching }; emit?.({ ok: true, kind: 'scenario' }); }
  const dp = await ask(TEXT, `${GROUND} Write THREE open-ended discussion prompts for "${title}" that push analysis and evaluation. Output JSON only: {"refused":false,"prompts":["...","...","..."]}`, `Passages:\n${ctx}\n\nWrite the discussion prompts.`);
  if (dp.prompts) { out.discussion = dp.prompts; emit?.({ ok: true, kind: 'discussion' }); }
  const su = await ask(TEXT, `You summarize a generated course for the instructor who will review it. Output JSON only: {"summary":"<4-6 sentences: what it covers, its objectives, how the pieces fit, what to review first>"}`, `Course: "${title}". Objectives:\n${grounded.map((g, i) => `${i + 1}. ${g.objective}`).join('\n')}`);
  if (su.summary) { out.summary = su.summary; emit?.({ ok: true, kind: 'summary' }); }
  return out;
}

/**
 * Build a course from objectives that each carry a grounding passage.
 * @param {{ title?: string, objectives: {objective:string, passage:string, cite?:string, title?:string}[] }} spec
 * @param {(evt:object)=>void} [emit] progress callback
 * @returns course JSON: { title, sections:[…], scenario, discussion, summary }
 */
export async function buildCourse(spec, emit) {
  const title = spec.title || 'Generated Course';
  const objectives = spec.objectives || [];
  const sections = [];
  for (const obj of objectives) {
    emit?.({ step: 'section', section: obj.title || obj.objective });
    sections.push(await genSection(obj, spec, emit));
  }
  const apply = await genApply(objectives, title, emit);
  emit?.({ step: 'done' });
  return { title, sections, ...apply };
}

/**
 * Build a course straight from raw documents: chunk them, retrieve the best passage per objective,
 * then generate. Objectives whose topic isn't covered by the documents are skipped (never invented).
 * @param {{ title?: string, objectives: (string|{objective,title?})[], documents: (string|{text,source?})[], diagrams?: boolean }} spec
 */
export async function fromDocuments(spec, emit) {
  const chunks = chunk(spec.documents || []);
  const objectives = [];
  for (const o of (spec.objectives || [])) {
    const objective = typeof o === 'string' ? o : o.objective;
    const hit = match(objective, chunks);
    if (!hit) { emit?.({ step: 'skipped', section: objective }); continue; } // not covered by the sources
    objectives.push({ objective, title: (typeof o === 'object' && o.title) || objective, passage: hit.text, cite: hit.source || null });
  }
  return buildCourse({ title: spec.title, objectives, diagrams: spec.diagrams }, emit);
}

export { chunk, match } from './retrieve.js';
