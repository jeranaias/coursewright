// Turn raw documents into per-objective grounding passages, so you can go straight from source
// material to a course without hand-picking excerpts. Zero-dependency keyword ranking.
const STOP = new Set('a an the of to and or in on for with by is are be as at from that this it its into'.split(' '));

/**
 * Unicode-aware tokenizer: lowercase, strip anything that is not a letter, number, or space
 * (keeps non-ASCII letters like accented or Arabic script), drop short words and stop words.
 * @param {*} s Any value; coerced to string.
 * @returns {string[]} Content tokens.
 */
export const tokens = (s) => String(s == null ? '' : s).toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));

// Greedily split one oversized paragraph into sentence-grouped pieces, each <= maxWords. A single
// sentence longer than maxWords is hard-split by words so no piece ever exceeds the bound.
function splitParagraph(p, maxWords) {
  const sentences = p.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [p];
  const pieces = [];
  let buf = '';
  const flush = () => { if (buf.trim()) pieces.push(buf.trim()); buf = ''; };
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.split(/\s+/).length > maxWords) {
      flush();
      const words = s.split(/\s+/);
      for (let i = 0; i < words.length; i += maxWords) pieces.push(words.slice(i, i + maxWords).join(' '));
      continue;
    }
    if (buf && (buf + ' ' + s).split(/\s+/).length > maxWords) flush();
    buf = buf ? buf + ' ' + s : s;
  }
  flush();
  return pieces;
}

/**
 * Split documents into passage-sized chunks (~180 words), packing whole paragraphs together.
 * A single paragraph larger than `maxWords` is hard-split by sentence so it never becomes one
 * giant passage.
 * @param {string|{text:string,source?:string}|(string|{text:string,source?:string})[]} documents
 *   One document or a list of them. A document is either raw text or `{ text, source }`.
 * @param {number} [maxWords=180] Soft upper bound on words per chunk.
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
    // Expand any oversized paragraph into sentence-sized units before packing.
    const units = [];
    for (const p of paras) {
      if (p.split(/\s+/).length > maxWords) units.push(...splitParagraph(p, maxWords));
      else units.push(p);
    }
    let buf = '';
    for (const u of units) {
      if ((buf + ' ' + u).split(/\s+/).length > maxWords && buf) { chunks.push({ text: buf, source: src }); buf = u; }
      else buf = buf ? buf + '\n' + u : u;
    }
    if (buf) chunks.push({ text: buf, source: src });
  }
  return chunks;
}

/**
 * Find the chunk that best covers an objective, by IDF-weighted keyword overlap. Rare, distinctive
 * words carry the match; ubiquitous words (control, system, process) barely count. A hit must clear
 * a real floor — a weighted score of at least 0.34 AND at least two overlapping content words — so a
 * single shared common word never forces a false match.
 * @param {string} objective The learning objective to ground.
 * @param {{text:string, source?:string}[]} chunks Candidate passages, e.g. from {@link chunk}.
 * @param {number} [minScore=0.34] Minimum IDF-weighted overlap score (0..1).
 * @param {number} [minOverlap=2] Minimum number of distinct overlapping content words.
 * @returns {{text:string, source?:string, score:number}|null} The best chunk, or `null` when nothing
 *   clears the floor — never a forced match.
 */
export function match(objective, chunks, minScore = 0.34, minOverlap = 2) {
  const q = [...new Set(tokens(objective))];
  if (!q.length || !Array.isArray(chunks) || !chunks.length) return null;
  const chunkTokens = chunks.map((c) => new Set(tokens(c.text)));
  const N = chunks.length;
  // Document frequency of each query token across the candidate chunks, and its IDF weight.
  const idf = {};
  for (const w of q) {
    let df = 0;
    for (const t of chunkTokens) if (t.has(w)) df++;
    idf[w] = Math.log(1 + N / (1 + df));
  }
  const total = q.reduce((sum, w) => sum + idf[w], 0) || 1;
  let best = null;
  for (let i = 0; i < chunks.length; i++) {
    const t = chunkTokens[i];
    let overlap = 0, weight = 0;
    for (const w of q) if (t.has(w)) { overlap++; weight += idf[w]; }
    const score = weight / total;
    if (!best || score > best.score) best = { ...chunks[i], score, overlap };
  }
  if (best && best.score >= minScore && best.overlap >= minOverlap) {
    const { overlap, ...hit } = best;
    return hit;
  }
  return null;
}
