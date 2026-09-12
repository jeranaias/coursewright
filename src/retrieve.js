// Turn raw documents into per-objective grounding passages, so you can go straight from source
// material to a course without hand-picking excerpts. Zero-dependency keyword ranking.
const STOP = new Set('a an the of to and or in on for with by is are be as at from that this it its into'.split(' '));
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Split documents into passage-sized chunks (~180 words), packing whole paragraphs together.
 * @param {string|{text:string,source?:string}|(string|{text:string,source?:string})[]} documents
 *   One document or a list of them. A document is either raw text or `{ text, source }`.
 * @param {number} [maxWords=180] Soft upper bound on words per chunk; a paragraph is never split.
 * @returns {{text:string, source:string}[]} Passage chunks, each tagged with its document's source.
 */
export function chunk(documents, maxWords = 180) {
  const texts = Array.isArray(documents) ? documents : [documents];
  const chunks = [];
  for (const doc of texts) {
    if (doc == null) continue;
    const src = typeof doc === 'string' ? '' : (doc.source || '');
    const text = typeof doc === 'string' ? doc : doc.text;
    if (typeof text !== 'string' || !text.trim()) continue;
    const paras = text.split(/\n\s*\n/).map((s) => s.trim().replace(/[ \t]+/g, ' ')).filter(Boolean);
    let buf = '';
    for (const p of paras) {
      if ((buf + ' ' + p).split(/\s+/).length > maxWords && buf) { chunks.push({ text: buf, source: src }); buf = p; }
      else buf = buf ? buf + '\n' + p : p;
    }
    if (buf) chunks.push({ text: buf, source: src });
  }
  return chunks;
}

/**
 * Find the chunk that best covers an objective, by keyword overlap.
 * @param {string} objective The learning objective to ground.
 * @param {{text:string, source?:string}[]} chunks Candidate passages, e.g. from {@link chunk}.
 * @returns {{text:string, source?:string, score:number}|null} The best chunk (score in 0..1), or
 *   `null` when the objective has no usable keywords or nothing overlaps — never a forced match.
 */
export function match(objective, chunks) {
  const q = new Set(tokens(objective));
  if (!q.size || !Array.isArray(chunks)) return null;
  let best = null;
  for (const c of chunks) { const t = new Set(tokens(c.text)); let s = 0; q.forEach((w) => { if (t.has(w)) s++; }); const score = s / q.size; if (!best || score > best.score) best = { ...c, score }; }
  return best && best.score > 0 ? best : null;
}
