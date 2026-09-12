# 📐 Coursewright

[![CI](https://github.com/jeranaias/coursewright/actions/workflows/ci.yml/badge.svg)](https://github.com/jeranaias/coursewright/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Generate a complete, cited course from objectives and your own source documents.**

Hand Coursewright a set of learning objectives — each paired with the passage that grounds it — and it
builds the whole course: a micro-lesson, an optional labeled diagram, a pre-test, a parallel-form
post-test, and flashcards for every objective, then a capstone applied **scenario with coaching**,
higher-order **discussion prompts**, and an **instructor summary**.

Every fact comes from the passage you supplied — and that's **enforced mechanically**, not just asked
of the model. Every artifact (lesson, diagram labels, test questions, flashcards, scenario, discussion,
summary) is checked for token overlap against its source passage before it ships, so a fabricated
standard or number the model returned with `refused:false` is still rejected. If a passage doesn't
support an objective, that piece refuses instead of inventing — so the whole course stays defensible.

- A **section** whose passage can't ground its lesson comes back as `{ "title": "…", "refused": true, "reason": "…" }` rather than a fabricated lesson.
- An **individual artifact** that can't be grounded (say the diagram, but the lesson held) is dropped and its reason recorded under `section.refusals`, e.g. `{ "diagram": "diagram labels not grounded in the passage" }`.

It returns plain JSON. No database, no server, no framework.

```js
import { buildCourse } from 'coursewright';

const course = await buildCourse({
  title: 'Rifle Marksmanship Fundamentals',
  objectives: [
    {
      objective: 'Explain trigger control and follow-through.',
      title: 'Trigger Control',
      passage: 'Trigger control is the act of firing the weapon while maintaining aim and stabilization until the bullet leaves the muzzle…',
      cite: 'Marksmanship, Ch.8, p.8-2',
    },
  ],
});
```

```jsonc
{
  "title": "Rifle Marksmanship Fundamentals",
  "sections": [
    { "title": "Trigger Control",
      "lesson": "Trigger control and follow-through are essential to…",
      "pre":  [{ "stem": "…", "options": ["…"], "answer": 0 }],
      "post": [{ "stem": "…", "options": ["…"], "answer": 2 }],
      "flashcards": [{ "front": "…", "back": "…" }],
      "diagram": { "title": "…", "elements": [ … ] },
      "refusals": {} }        // per-artifact refusal reasons, e.g. { "diagram": "…" }; empty when all held
  ],
  "scenario":   { "situation": "…", "task": "…", "coaching": "… [1]" },
  "discussion": ["…", "…", "…"],
  "summary": "This course covers…"
}
```

## Input shape

```jsonc
{
  "title": "…",
  "diagrams": true,                 // optional; drafts diagrams with a stronger model
  "objectives": [
    { "objective": "…",             // what the learner should be able to do
      "title": "…",                 // optional short heading
      "passage": "…",               // the grounding source text (required)
      "cite": "…" }                 // optional citation label
  ]
}
```

> **Where do passages come from?** Anywhere — your own retrieval, a search index, or hand-picked
> excerpts. Coursewright only asks that each objective arrive with the text that grounds it.

## Or: straight from raw documents

Don't want to pre-pick passages? Hand Coursewright the documents and the objectives, and it chunks,
retrieves the best passage per objective, and generates — skipping any objective the documents don't
actually cover (never inventing one):

```js
import { fromDocuments } from 'coursewright';

const course = await fromDocuments({
  title: 'Rifle Marksmanship Fundamentals',
  objectives: ['Explain trigger control and follow-through.', 'Explain natural point of aim.'],
  documents: [{ text: fullManualText, source: 'Marksmanship' }],
});
// objectives not covered by the documents are skipped, not faked
```

## Watch it build

Pass a second `emit` callback to stream progress as each artifact lands — handy for a long run or a
live UI.

```js
await buildCourse(spec, (e) => console.log(e.step || e.kind, e.ok === false ? '(refused)' : ''));
```

## Check grounding yourself

The same mechanical check Coursewright gates every artifact on is exported. `verifyGrounding(text, passage)`
returns the fraction of the text's content words that appear in the passage, and whether that clears the
threshold (default `0.4`). It's pure and deterministic — no model, no network.

```js
import { verifyGrounding, isRefusal } from 'coursewright';

const passage = 'Trigger control is a smooth, consistent rearward squeeze of the trigger while maintaining aim and stabilization until the bullet leaves the muzzle.';

verifyGrounding('a smooth rearward squeeze of the trigger until the bullet leaves the muzzle', passage);
// → { grounded: true, overlap: 1, matched: 8, total: 8 }

verifyGrounding('The rifle fires a 5.56mm cartridge at 940 m/s per NATO standard.', passage);
// → { grounded: false, overlap: 0, … }   ← fabricated numbers don't appear in the passage

isRefusal({ refused: true, reason: 'unsupported' }); // → true
```

## Test without a live endpoint

`buildCourse` and `fromDocuments` take a third `options` argument. Inject an `ask` (or a `fetch`
override) to drive the whole generation path deterministically — no API key, no network:

```js
const ask = async (model, system, user) =>
  /micro-lesson/.test(user) ? { refused: false, lesson: passage + ' Why it matters: …' }
  : { refused: false, items: [], cards: [] };

const course = await buildCourse(spec, null, { ask });
```

## Bring your own model

| Variable | Default |
|---|---|
| `COURSEWRIGHT_API_KEY` | *(required; `OPENROUTER_API_KEY` also accepted)* |
| `COURSEWRIGHT_ENDPOINT` | `https://openrouter.ai/api/v1/chat/completions` |
| `COURSEWRIGHT_MODEL` | `google/gemini-3-flash-preview` |
| `COURSEWRIGHT_DIAGRAM_MODEL` | `google/gemini-3.1-pro-preview` |

## Try it

```bash
npm install coursewright
export COURSEWRIGHT_API_KEY=...
node example/demo.mjs
```

## License

Apache-2.0.
