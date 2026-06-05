import type { Item, ScoredItem, InterestProfile } from "../types.js";
import type { Llm, Logger } from "../contracts.js";

// ---------------------------------------------------------------------------
// keywordScore — pure, exported
// ---------------------------------------------------------------------------

/** Tokenize text into lowercase alpha tokens, length >= 2. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/** Extract salient tokens from a free-text interest description. */
function interestTokens(interests: string): string[] {
  const stopwords = new Set([
    "and", "or", "the", "a", "an", "of", "in", "for", "on", "with",
    "to", "is", "are", "was", "be", "by", "as", "at", "from", "that",
    "this", "it", "its", "about", "more", "like", "such", "any", "all",
    "we", "our", "their", "into", "also", "can", "has", "have", "been",
    "using", "which", "these", "those", "than", "up", "practical",
  ]);
  return tokenize(interests).filter((t) => !stopwords.has(t) && t.length >= 3);
}

export function keywordScore(
  item: Item,
  profile: InterestProfile
): { score: number; reason: string } {
  const profileTokens = new Set([
    ...profile.keywords.map((k) => k.toLowerCase()),
    ...interestTokens(profile.interests),
  ]);

  const itemTokens = new Set(tokenize(`${item.title} ${item.summary}`));
  const matched: string[] = [];

  for (const t of itemTokens) {
    if (profileTokens.has(t)) {
      matched.push(t);
    }
  }

  // Normalize: profileTokens size as denominator, cap at 10
  const denom = Math.max(profileTokens.size, 1);
  const raw = matched.length / denom;
  // Scale: 10 when >=15% overlap (arbitrary but reasonable for keyword matching)
  const score = Math.min(10, Math.round((raw / 0.15) * 10));
  const reason =
    matched.length > 0
      ? `Matched terms: ${matched.slice(0, 8).join(", ")}`
      : "No keyword matches";

  return { score, reason };
}

// ---------------------------------------------------------------------------
// isMuted — check item against muted topics
// ---------------------------------------------------------------------------

function isMuted(item: Item, mutedTopics: string[]): boolean {
  if (mutedTopics.length === 0) return false;
  const haystack = `${item.title} ${item.summary}`.toLowerCase();
  return mutedTopics.some((topic) => haystack.includes(topic.toLowerCase()));
}

// ---------------------------------------------------------------------------
// LLM judge helpers
// ---------------------------------------------------------------------------

interface LlmJudgeResult {
  id: string;
  score: number;
  reason: string;
}

function buildPrompt(items: Item[], profile: InterestProfile): string {
  const upExemplars = profile.exemplars
    .filter((e) => e.label === "up")
    .slice(-5);
  const downExemplars = profile.exemplars
    .filter((e) => e.label === "down")
    .slice(-5);

  const fewShotLines: string[] = [];
  for (const e of upExemplars) {
    fewShotLines.push(`👍 "${e.title}"${e.summary ? ` — ${e.summary.slice(0, 120)}` : ""}`);
  }
  for (const e of downExemplars) {
    fewShotLines.push(`👎 "${e.title}"${e.summary ? ` — ${e.summary.slice(0, 120)}` : ""}`);
  }

  const candidateLines = items.map((item, i) => {
    const summary = item.summary.slice(0, 200);
    return `${i + 1}. id=${item.id} | title=${item.title} | summary=${summary}`;
  });

  const fewShotBlock =
    fewShotLines.length > 0
      ? `\n\nFew-shot preference examples:\n${fewShotLines.join("\n")}`
      : "";

  return [
    `You are a research relevance judge. Score each candidate item 0..10 against the user's interests.`,
    ``,
    `User interests: ${profile.interests}${fewShotBlock}`,
    ``,
    `Candidates:`,
    ...candidateLines,
    ``,
    `Return ONLY a JSON array (no prose, no markdown fences) in this exact shape:`,
    `[{"id":"<id>","score":<0-10>,"reason":"<one sentence>"},...]`,
    `One entry per candidate, in any order.`,
  ].join("\n");
}

/** Extract first JSON array from a string, even if wrapped in prose or fences. */
function extractJsonArray(text: string): LlmJudgeResult[] | null {
  // Strip markdown fences
  const stripped = text.replace(/```(?:json)?/g, "").replace(/```/g, "");
  // Find first [ ... ]
  const start = stripped.indexOf("[");
  if (start === -1) return null;
  // Walk to find matching ]
  let depth = 0;
  let end = -1;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end === -1) return null;
  const slice = stripped.slice(start, end + 1);
  try {
    const parsed = JSON.parse(slice) as unknown;
    if (!Array.isArray(parsed)) return null;
    // Validate shape
    return (parsed as LlmJudgeResult[]).filter(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof r.id === "string" &&
        typeof r.score === "number" &&
        typeof r.reason === "string"
    );
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// scoreItems
// ---------------------------------------------------------------------------

export async function scoreItems(
  items: Item[],
  profile: InterestProfile,
  deps: { llm?: Llm; logger: Logger; maxItemsToScore?: number }
): Promise<ScoredItem[]> {
  const { llm, logger, maxItemsToScore = 40 } = deps;

  // Apply mute filter first — these always get score 0
  const muted: ScoredItem[] = [];
  const candidates: Item[] = [];

  for (const item of items) {
    if (isMuted(item, profile.mutedTopics)) {
      muted.push({
        ...item,
        score: 0,
        reason: `Muted topic match`,
        scorer: "keyword",
      });
    } else {
      candidates.push(item);
    }
  }

  if (candidates.length === 0) {
    return muted;
  }

  // If no LLM, go straight to keyword
  if (!llm) {
    logger.warn("scoreItems: no llm provided, using keyword fallback");
    const scored = candidates.map((item) => {
      const { score, reason } = keywordScore(item, profile);
      return { ...item, score, reason, scorer: "keyword" as const };
    });
    return [...muted, ...scored];
  }

  // Pre-rank by keyword if over limit
  let toScore = candidates;
  let overflow: ScoredItem[] = [];

  if (candidates.length > maxItemsToScore) {
    const withKw = candidates.map((item) => ({
      item,
      ...keywordScore(item, profile),
    }));
    withKw.sort((a, b) => b.score - a.score);
    toScore = withKw.slice(0, maxItemsToScore).map((x) => x.item);
    overflow = withKw.slice(maxItemsToScore).map(({ item, score, reason }) => ({
      ...item,
      score,
      reason,
      scorer: "keyword" as const,
    }));
  }

  // Try LLM judge
  try {
    const prompt = buildPrompt(toScore, profile);
    const response = await llm.complete({
      messages: [{ role: "user", content: prompt }],
      model: undefined,
      temperature: 0,
    });

    const results = extractJsonArray(response.text);
    if (!results || results.length === 0) {
      throw new Error("LLM returned no parseable JSON array");
    }

    // Map results back by id
    const resultById = new Map<string, LlmJudgeResult>(results.map((r) => [r.id, r]));

    const scored: ScoredItem[] = toScore.map((item) => {
      const r = resultById.get(item.id);
      if (r) {
        const clampedScore = Math.max(0, Math.min(10, Math.round(r.score)));
        return { ...item, score: clampedScore, reason: r.reason, scorer: "llm" as const };
      }
      // Missing from response — use keyword
      const { score, reason } = keywordScore(item, profile);
      return { ...item, score, reason, scorer: "keyword" as const };
    });

    return [...muted, ...scored, ...overflow];
  } catch (err) {
    logger.warn(
      `scoreItems: LLM judge failed (${String(err)}), falling back to keyword for all candidates`
    );
    const scored = candidates.map((item) => {
      const { score, reason } = keywordScore(item, profile);
      return { ...item, score, reason, scorer: "keyword" as const };
    });
    return [...muted, ...scored];
  }
}
