// Turn raw documents into per-objective grounding passages, so you can go straight from source
// material to a course without hand-picking excerpts. Zero-dependency keyword ranking.
const STOP = new Set('a an the of to and or in on for with by is are be as at from that this it its into'.split(' '));
const tokens = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

/** Split documents into passage-sized chunks (~180 words), packing paragraphs. */
export function chunk(documents, maxWords = 180) {
  const texts = Array.isArray(documents) ? documents : [documents];
  const chunks = [];
  for (const doc of texts) {
    const src = typeof doc === 'string' ? '' : (doc.source || '');
    const text = typeof doc === 'string' ? doc : doc.text;
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

/** Best-matching chunk for an objective (keyword overlap). Returns { text, source, score } or null. */
export function match(objective, chunks) {
  const q = new Set(tokens(objective));
  if (!q.size) return null;
  let best = null;
  for (const c of chunks) { const t = new Set(tokens(c.text)); let s = 0; q.forEach((w) => { if (t.has(w)) s++; }); const score = s / q.size; if (!best || score > best.score) best = { ...c, score }; }
  return best && best.score > 0 ? best : null;
}
