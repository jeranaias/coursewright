# 📐 Coursewright

[![CI](https://github.com/jeranaias/coursewright/actions/workflows/ci.yml/badge.svg)](https://github.com/jeranaias/coursewright/actions/workflows/ci.yml) [![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Generate a complete, cited course from objectives and your own source documents.**

Hand Coursewright a set of learning objectives — each paired with the passage that grounds it — and it
builds the whole course: a micro-lesson, an optional labeled diagram, a pre-test, a parallel-form
post-test, and flashcards for every objective, then a capstone applied **scenario with coaching**,
higher-order **discussion prompts**, and an **instructor summary**.

Every fact comes from the passage you supplied. If a passage doesn't support an objective, that piece
refuses instead of inventing — so the whole course stays defensible. A section whose passage can't
ground it comes back as `{ "title": "…", "refused": true, "reason": "…" }` rather than a fabricated lesson.

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
      "diagram": { "title": "…", "elements": [ … ] } }
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
