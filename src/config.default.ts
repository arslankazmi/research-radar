import type { RadarConfig } from "./types.js";

/**
 * Default radar config with all requested sources.
 * Feed URLs are real where known; guessed URLs are marked with `// TODO verify feed url`.
 */
export function defaultConfig(): RadarConfig {
  return {
    sources: [
      // ── arXiv ──────────────────────────────────────────────────────────────
      {
        id: "arxiv-cs-lg",
        type: "paper",
        adapter: "arxiv",
        options: { categories: ["cs.LG"], maxResults: 20 },
      },
      {
        id: "arxiv-cs-cl",
        type: "paper",
        adapter: "arxiv",
        options: { categories: ["cs.CL"], maxResults: 15 },
      },
      {
        id: "arxiv-cs-cv",
        type: "paper",
        adapter: "arxiv",
        options: { categories: ["cs.CV"], maxResults: 10 },
      },

      // ── Hugging Face ───────────────────────────────────────────────────────
      {
        id: "hf-trending",
        type: "model",
        adapter: "huggingface",
        options: { sort: "trending", limit: 20 },
      },

      // ── GitHub Trending ML ─────────────────────────────────────────────────
      {
        id: "github-trending-ml",
        type: "repo",
        adapter: "github-trending",
        options: { since: "weekly", topic: "machine-learning", language: undefined },
      },

      // ── Hacker News ────────────────────────────────────────────────────────
      {
        id: "hackernews-ml",
        type: "post",
        adapter: "hackernews",
        options: { query: "machine learning AI", tags: "story", minPoints: 100 },
      },

      // ── Curated researcher feeds (RSS where a real feed exists) ─────────────
      {
        id: "karpathy",
        type: "post",
        adapter: "rss",
        // Verified: Karpathy moved to Bearblog (2025–); github.io is stale. Bearblog exposes /feed/.
        options: { url: "https://karpathy.bearblog.dev/feed/" },
      },
      {
        id: "google-research",
        type: "post",
        adapter: "rss",
        // Verified: blog.google sections expose an RSS feed at /rss/.
        options: { url: "https://blog.google/technology/research/rss/" },
      },

      // ── Curated researcher feeds (scrape fallback — no public RSS exists) ───
      // Per design decision: prefer RSS, scrape as fallback for feedless sites.
      {
        id: "gwern",
        type: "post",
        adapter: "scrape",
        // gwern.net has no official RSS feed (confirmed). Scrape the "newest docs" index.
        options: { url: "https://gwern.net/doc/newest/index" },
      },
      {
        id: "anthropic-research",
        type: "post",
        adapter: "scrape",
        // Anthropic publishes no public RSS feed (confirmed). Scrape the news index.
        options: { url: "https://www.anthropic.com/news" },
      },
      {
        id: "gwtaylor",
        type: "post",
        adapter: "scrape",
        enabled: false,
        // Graham Taylor (gwtaylor.ca) — feed unconfirmed; disabled by default. If the site
        // exposes a feed, switch adapter to "rss" with the real URL.
        options: { url: "https://www.gwtaylor.ca/" },
      },

      // ── Scrape fallback example ────────────────────────────────────────────
      {
        id: "paperswithcode-trending",
        type: "paper",
        adapter: "scrape",
        enabled: false, // disabled by default; enable if scraping is acceptable
        options: { url: "https://paperswithcode.com/latest" },
      },
    ],

    delivery: {
      sessionKey: "agent:main:main",
      cron: "0 8 * * *",
      tz: "America/New_York",
    },

    judge: {
      minScore: 6,
      topN: 12,
      maxItemsToScore: 40,
    },
  };
}
