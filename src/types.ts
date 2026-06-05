/**
 * Shared domain types for research-radar.
 *
 * These types are deliberately framework-agnostic — they have NO dependency on the
 * OpenClaw plugin SDK so the entire pipeline can be unit-tested and run via the CLI
 * without the OpenClaw runtime. The thin plugin entry (src/plugin/*) adapts the SDK
 * to these types.
 */

/** The four kinds of things the radar surfaces. */
export type SourceType = "paper" | "model" | "repo" | "post";

/** Which built-in adapter implementation a configured source uses. */
export type AdapterKind =
  | "arxiv"
  | "huggingface"
  | "github-trending"
  | "hackernews"
  | "rss"
  | "scrape";

/** A normalized item from any source. Adapters MUST return this shape. */
export interface Item {
  /** Stable id, derived from the canonical URL (see util/stableId). Used for dedup + references. */
  id: string;
  title: string;
  /** Canonical link to the item. */
  url: string;
  /** Configured source id this came from, e.g. "arxiv-cs-lg", "gwern". */
  source: string;
  sourceType: SourceType;
  /** Abstract / description / blurb. May be empty string if the source has none. */
  summary: string;
  /** ISO-8601 timestamp of publication. */
  published: string;
  authors?: string[];
  tags?: string[];
  /** Source-specific extras, e.g. { stars: 1200 } for repos, { downloads, likes } for models. */
  extra?: Record<string, unknown>;
}

/** An item after the relevance judge has scored it. */
export interface ScoredItem extends Item {
  /** Relevance 0..10 against the user's interest profile. */
  score: number;
  /** Short rationale from the judge (one sentence). */
  reason: string;
  /** Which scorer produced the score. */
  scorer: "llm" | "keyword";
}

/** A single learned preference example, captured from in-chat 👍/👎. */
export interface Exemplar {
  title: string;
  summary?: string;
  /** 👍 => "up", 👎 => "down". */
  label: "up" | "down";
  /** Optional topic/source tag for grouping. */
  topic?: string;
  /** ISO-8601 timestamp the feedback was given. */
  at: string;
}

/** The user's interest profile + learned state. Persisted as JSON in the workspace. */
export interface InterestProfile {
  /** Natural-language description of what the user cares about. */
  interests: string;
  /** Optional explicit keywords to boost. */
  keywords: string[];
  /** Topics/phrases the user has muted (suppressed from digests). */
  mutedTopics: string[];
  /** Learned 👍/👎 exemplars fed to the judge as few-shot context. */
  exemplars: Exemplar[];
  /** Minimum score (0..10) for an item to appear in the digest. */
  minScore: number;
  /** Max items per digest. */
  topN: number;
}

/** Config for a single configured source. */
export interface SourceConfig {
  /** Unique id across the config, e.g. "arxiv-cs-lg", "gwern". */
  id: string;
  type: SourceType;
  adapter: AdapterKind;
  /** Defaults to true. */
  enabled?: boolean;
  /**
   * Adapter-specific options. Examples:
   *  - arxiv:          { categories: string[]; maxResults?: number }
   *  - huggingface:    { sort?: "trending" | "createdAt"; limit?: number }
   *  - github-trending:{ since?: "daily" | "weekly"; language?: string }
   *  - hackernews:     { query?: string; tags?: string; minPoints?: number }
   *  - rss:            { url: string }
   *  - scrape:         { url: string; linkSelectorHint?: string }
   */
  options?: Record<string, unknown>;
}

/** Top-level plugin/CLI config. */
export interface RadarConfig {
  sources: SourceConfig[];
  delivery?: {
    /** OpenClaw session key the cron turn targets, e.g. "agent:main:main". */
    sessionKey?: string;
    /** Cron expression, e.g. "0 8 * * *". */
    cron?: string;
    /** IANA timezone, e.g. "America/New_York". */
    tz?: string;
  };
  judge?: {
    /** Optional model override; omit to use the agent's configured model. */
    model?: string;
    minScore?: number;
    topN?: number;
    /** Cap on items sent to the LLM judge per run (cost guard). */
    maxItemsToScore?: number;
  };
  /** Where the interest profile JSON lives. */
  profilePath?: string;
  /** Where run state / last-seen ids live. */
  statePath?: string;
}

/** A composed digest, ready to render. */
export interface Digest {
  /** ISO date the digest was generated for. */
  date: string;
  /** Ranked, thresholded items included in this digest. */
  items: ScoredItem[];
  /** Items grouped by sourceType for rendering. */
  groups: DigestGroup[];
  /** How many candidates were considered before ranking/threshold. */
  consideredCount: number;
}

export interface DigestGroup {
  type: SourceType;
  label: string;
  items: ScoredItem[];
}
