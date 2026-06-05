import type { ScoredItem } from "../types.js";

/**
 * Precision at K: fraction of the top-k ranked items that are relevant.
 * ranked must be ordered by descending score (as returned by scoreItems).
 */
export function precisionAtK(
  ranked: ScoredItem[],
  relevantIds: Set<string>,
  k: number
): number {
  if (k <= 0) return 0;
  const topK = ranked.slice(0, k);
  const relevant = topK.filter((item) => relevantIds.has(item.id)).length;
  return relevant / k;
}

/**
 * Run precision@K evaluation over a set of gold labels.
 * Returns an object keyed by "p@K" for each k in ks (default [5, 10]).
 */
export function runGoldenEval(
  scored: ScoredItem[],
  labels: { id: string; relevant: boolean }[],
  ks: number[] = [5, 10]
): { [k: string]: number } {
  const relevantIds = new Set(
    labels.filter((l) => l.relevant).map((l) => l.id)
  );

  // Sort descending by score
  const ranked = [...scored].sort((a, b) => b.score - a.score);

  const result: { [k: string]: number } = {};
  for (const k of ks) {
    result[`p@${k}`] = precisionAtK(ranked, relevantIds, k);
  }
  return result;
}
