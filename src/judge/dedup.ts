import type { Item } from "../types.js";

/** Normalize a title for near-duplicate detection. */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize a normalized title into a set of tokens. */
function titleTokens(normalized: string): Set<string> {
  return new Set(normalized.split(" ").filter((t) => t.length > 0));
}

/** Jaccard similarity between two sets. */
function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const t of a) {
    if (b.has(t)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate items:
 * 1. Collapse exact `id` duplicates (keep the item with the longer summary).
 * 2. Collapse near-duplicate titles (normalized token Jaccard >= 0.9), keeping the longer summary.
 */
export function dedupe(items: Item[]): Item[] {
  // Step 1: exact id dedup
  const byId = new Map<string, Item>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing || item.summary.length > existing.summary.length) {
      byId.set(item.id, item);
    }
  }

  const deduped = Array.from(byId.values());

  // Step 2: near-duplicate title dedup
  // Greedy: for each item, check if it's a near-dupe of any already-kept item
  const kept: Item[] = [];
  const keptNorm: Array<{ tokens: Set<string>; idx: number }> = [];

  for (const item of deduped) {
    const norm = normalizeTitle(item.title);
    const tokens = titleTokens(norm);

    let isDupe = false;
    for (let i = 0; i < keptNorm.length; i++) {
      const candidate = keptNorm[i];
      if (!candidate) continue;
      if (jaccard(tokens, candidate.tokens) >= 0.9) {
        // Near dupe found — keep the one with the longer summary
        const existing = kept[candidate.idx];
        if (existing && item.summary.length > existing.summary.length) {
          kept[candidate.idx] = item;
          keptNorm[i] = { tokens, idx: candidate.idx };
        }
        isDupe = true;
        break;
      }
    }

    if (!isDupe) {
      const idx = kept.length;
      kept.push(item);
      keptNorm.push({ tokens, idx });
    }
  }

  return kept;
}
