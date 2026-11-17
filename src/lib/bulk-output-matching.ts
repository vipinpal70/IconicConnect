/**
 * Matching a design-output file name to the case it belongs to.
 *
 * Shared by the bulk-upload UI (instant feedback, before any upload) and the bulk match /
 * confirm routes (the authoritative check), so both sides always agree on what "matches".
 *
 * Tiers, strongest first:
 *   exact       – same name as one of the case's scan files, ignoring extension and case
 *                 (the rule the single-case upload enforces)
 *   normalized  – equal after removing separators, copy markers and output suffixes
 *                 ("Smith_J (1).zip", "smith-j_final.stl" → "smithj")
 *   case-number – the file is named after the case number ("IC-1234.zip")
 *   similar     – close but not equal; only ever a suggestion the user must confirm
 */

export type MatchTier = 'exact' | 'normalized' | 'case-number' | 'similar';

/** Tiers strong enough to attach a file without the user explicitly overriding the name check. */
export const AUTO_MATCH_TIERS: ReadonlySet<MatchTier> = new Set(['exact', 'normalized', 'case-number']);

const TIER_RANK: Record<MatchTier, number> = { exact: 0, normalized: 1, 'case-number': 2, similar: 3 };

export interface MatchableCase {
  id: string;
  caseNumber: string | null;
  /** Every scan file name the lab uploaded for the case. */
  scanFileNames: string[];
}

export interface CaseMatch {
  caseId: string;
  tier: MatchTier;
  /** 0–1; 1 for every tier except `similar`. */
  score: number;
}

const SIMILARITY_THRESHOLD = 0.82;
/** Case numbers shorter than this are too easy to hit by accident inside an unrelated name. */
const MIN_CASE_NUMBER_KEY_LENGTH = 4;

// Extensions dropped beyond the last one, so "crown.stl.zip" still compares as "crown".
const STACKED_EXTENSIONS = new Set([
  'zip', 'rar', '7z', 'stl', 'ply', 'obj', 'dcm', '3mf', 'off', 'glb', 'gltf', 'xml', 'html', 'htm', 'pdf',
  'constructioninfo', 'dentalproject',
]);

// Trailing words designers/QC commonly append to an output; removed repeatedly from the end.
const OUTPUT_SUFFIX = /[\s_\-.]*(?:final|design(?:ed)?|output|out|cad|done|finished|completed?|ready|export(?:ed)?|v\d{1,3}|rev\d{1,3}|r\d{1,2})$/i;
const COPY_SUFFIX = /[\s_\-.]*(?:\(\d{1,3}\)|copy(?:[\s_-]*\d{1,3})?|-\s*copy)$/i;
const COPY_PREFIX = /^(?:copy\s+of\s+)/i;

function baseName(name: string): string {
  return (name.split(/[\\/]/).pop() ?? name).normalize('NFKC').trim();
}

/** Lower-case name without directory or extension — the single-upload comparison key. */
export function exactKey(name: string): string {
  const base = baseName(name);
  const dot = base.lastIndexOf('.');
  return (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase();
}

/** Separator-, suffix- and copy-marker-insensitive key. */
export function looseKey(name: string): string {
  let stem = exactKey(name);
  // Stacked extensions: "crown.stl" (from "crown.stl.zip") → "crown"
  for (let dot = stem.lastIndexOf('.'); dot > 0 && STACKED_EXTENSIONS.has(stem.slice(dot + 1)); dot = stem.lastIndexOf('.')) {
    stem = stem.slice(0, dot);
  }
  stem = stem.replace(COPY_PREFIX, '');
  // Peel suffixes in any order ("_final (1)", "(1)_final"), but never down to an empty name
  for (let i = 0; i < 6; i++) {
    const next = stem.replace(COPY_SUFFIX, '').replace(OUTPUT_SUFFIX, '');
    if (next === stem || next.replace(/[\s_\-.]/g, '') === '') break;
    stem = next;
  }
  return stem.replace(/[\s_\-.()[\]]+/g, '');
}

/**
 * Normalized edit similarity (1 = identical). Uses optimal-string-alignment distance so a swapped
 * pair of letters ("Jhon"/"John") — the most common typo in patient names — counts as one edit.
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const width = b.length + 1;
  let prevPrev = new Array<number>(width).fill(0);
  let prev = Array.from({ length: width }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = new Array<number>(width);
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        row[j] = Math.min(row[j], prevPrev[j - 2] + 1);
      }
    }
    prevPrev = prev;
    prev = row;
  }
  return 1 - prev[b.length] / Math.max(a.length, b.length);
}

/** How (if at all) one output file relates to one case. */
export function matchFileToCase(fileName: string, c: MatchableCase): CaseMatch | null {
  const exact = exactKey(fileName);
  const loose = looseKey(fileName);
  let best: CaseMatch | null = null;
  const consider = (m: CaseMatch) => {
    if (!best || TIER_RANK[m.tier] < TIER_RANK[best.tier] || (m.tier === best.tier && m.score > best.score)) best = m;
  };

  for (const scan of c.scanFileNames) {
    if (exactKey(scan) === exact) return { caseId: c.id, tier: 'exact', score: 1 };
    const scanLoose = looseKey(scan);
    if (!scanLoose || !loose) continue;
    if (scanLoose === loose) {
      consider({ caseId: c.id, tier: 'normalized', score: 1 });
    } else {
      const score = similarity(loose, scanLoose);
      if (score >= SIMILARITY_THRESHOLD) consider({ caseId: c.id, tier: 'similar', score });
    }
  }

  if (c.caseNumber) {
    const caseKey = looseKey(c.caseNumber);
    if (caseKey.length >= MIN_CASE_NUMBER_KEY_LENGTH && loose === caseKey) {
      consider({ caseId: c.id, tier: 'case-number', score: 1 });
    }
  }
  return best;
}

export type MatchStatus = 'matched' | 'ambiguous' | 'suggested' | 'unmatched';

export interface FileMatchResult {
  status: MatchStatus;
  /** Set only when exactly one case matched at an auto-match tier. */
  matchedCaseId: string | null;
  tier: MatchTier | null;
  /** Best-first: all cases at the winning tier (or the top similar suggestions). */
  candidateIds: string[];
}

const MAX_SUGGESTIONS = 5;

export function matchFile(fileName: string, cases: MatchableCase[]): FileMatchResult {
  const matches = cases
    .map((c) => matchFileToCase(fileName, c))
    .filter((m): m is CaseMatch => m !== null)
    .sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier] || b.score - a.score);

  if (matches.length === 0) return { status: 'unmatched', matchedCaseId: null, tier: null, candidateIds: [] };

  const tier = matches[0].tier;
  if (tier === 'similar') {
    return {
      status: 'suggested',
      matchedCaseId: null,
      tier,
      candidateIds: matches.slice(0, MAX_SUGGESTIONS).map((m) => m.caseId),
    };
  }
  const top = matches.filter((m) => m.tier === tier);
  return top.length === 1
    ? { status: 'matched', matchedCaseId: top[0].caseId, tier, candidateIds: [top[0].caseId] }
    : { status: 'ambiguous', matchedCaseId: null, tier, candidateIds: top.map((m) => m.caseId) };
}

/** True when attaching `fileName` to this case needs the user's explicit "use anyway". */
export function needsNameOverride(fileName: string, c: MatchableCase): boolean {
  const m = matchFileToCase(fileName, c);
  return !m || !AUTO_MATCH_TIERS.has(m.tier);
}
