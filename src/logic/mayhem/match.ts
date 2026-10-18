import type { MayhemAugment } from './types';

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const row = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) row[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prev = i - 1;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + cost);
      prev = tmp;
    }
  }
  return row[b.length];
}

const UI_NOISE_LINE =
  /^(reroll|silver|gold|prismatic|choose|pick|select|augment|augments|aram mayhem|double click|click to|confirm|ok|yes|no)$/i;

/** Shop chrome / rarity labels — not augment card titles. */
export function isMayhemOcrNoiseLine(line: string): boolean {
  const n = normalizeName(line);
  if (n.length < 3) return true;
  if (UI_NOISE_LINE.test(n)) return true;
  if (n === 'quest') return true;
  if (n.startsWith('pick an')) return true;
  if (n.startsWith('choose an')) return true;
  return false;
}

function scoreLine(line: string, aug: MayhemAugment): number {
  const ln = normalizeName(line);
  const name = normalizeName(aug.name);
  const slug = normalizeName(aug.slug.replace(/-/g, ' '));
  if (!ln || ln.length < 3) return 999;

  if (name.startsWith('quest ') && (ln === 'quest' || ln === 'quests')) return 999;

  if (ln === name || ln === slug) return 0;
  if (name.includes(ln) || ln.includes(name)) {
    const longer = name.length >= ln.length ? name : ln;
    const shorter = name.length >= ln.length ? ln : name;
    if (shorter.length < longer.length * 0.65) return 999;
    if (name.startsWith('quest ') && !ln.includes('quest')) return 999;
    return 1;
  }
  if (slug.includes(ln) || ln.includes(slug)) {
    const longer = slug.length >= ln.length ? slug : ln;
    const shorter = slug.length >= ln.length ? ln : slug;
    if (shorter.length < longer.length * 0.65) return 999;
    return 2;
  }
  const dist = levenshtein(ln, name);
  const maxLen = Math.max(ln.length, name.length);
  if (maxLen > 0 && dist / maxLen <= 0.32) return 3 + dist;
  return 999;
}

const MAX_LINE_SCORE = 4;
const CORPUS_NAME_MIN = 5;

function bestAugmentForLine(
  line: string,
  augments: MayhemAugment[]
): { id: string; score: number } | null {
  let best: { id: string; score: number } | null = null;
  for (const aug of augments) {
    const s = scoreLine(line, aug);
    if (s >= 10) continue;
    if (!best || s < best.score) best = { id: aug.id, score: s };
  }
  if (!best || best.score > MAX_LINE_SCORE) return null;
  return best;
}

/** Multiple distinct augments can appear on one OCR line when cards are close together. */
function augmentHitsOnLine(line: string, augments: MayhemAugment[]): string[] {
  const hits: Array<{ id: string; score: number }> = [];
  for (const aug of augments) {
    const s = scoreLine(line, aug);
    if (s <= MAX_LINE_SCORE) hits.push({ id: aug.id, score: s });
  }
  hits.sort((a, b) => a.score - b.score || a.id.localeCompare(b.id));
  const out: string[] = [];
  for (const h of hits) {
    if (!out.includes(h.id)) out.push(h.id);
  }
  return out;
}

/** Find augment titles in merged OCR text, left-to-right (card order). */
function augmentIdsFromCorpus(
  corpus: string,
  augments: MayhemAugment[],
  exclude: Set<string>
): string[] {
  const hits: Array<{ id: string; pos: number; len: number }> = [];
  for (const aug of augments) {
    if (exclude.has(aug.id)) continue;
    const name = normalizeName(aug.name);
    if (name.length < CORPUS_NAME_MIN) continue;
    const pos = corpus.indexOf(name);
    if (pos < 0) continue;
    hits.push({ id: aug.id, pos, len: name.length });
  }
  hits.sort((a, b) => a.pos - b.pos || b.len - a.len);
  const out: string[] = [];
  for (const h of hits) {
    if (out.includes(h.id)) continue;
    out.push(h.id);
    if (out.length >= 3) break;
  }
  return out;
}

function pushUnique(out: string[], id: string): void {
  if (!out.includes(id)) out.push(id);
}

/**
 * Match OCR lines to augment ids (up to 3 distinct offers).
 * Each offer should come from its own OCR line when possible — avoids phantom picks from UI words like "Quest".
 */
export function matchAugmentsFromOcr(ocrText: string, augments: MayhemAugment[]): string[] {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3 && !isMayhemOcrNoiseLine(l));

  const out: string[] = [];

  for (const line of lines) {
    const onLine = augmentHitsOnLine(line, augments);
    if (onLine.length) {
      for (const id of onLine) {
        pushUnique(out, id);
        if (out.length >= 3) return out;
      }
      continue;
    }
    const hit = bestAugmentForLine(line, augments);
    if (hit) {
      pushUnique(out, hit.id);
      if (out.length >= 3) return out;
    }
  }

  if (out.length >= 3) return out;

  const corpus = normalizeName(ocrText.replace(/\r?\n/g, ' '));
  for (const id of augmentIdsFromCorpus(corpus, augments, new Set(out))) {
    pushUnique(out, id);
    if (out.length >= 3) break;
  }

  return out;
}
