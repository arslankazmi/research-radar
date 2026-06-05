import { describe, it, expect, vi } from "vitest";
import { runRadar } from "../../src/pipeline.js";
import type { HttpClient, HttpResponse, Llm } from "../../src/contracts.js";
import type { RadarConfig, InterestProfile } from "../../src/types.js";
import { defaultProfile } from "../../src/profile/profile.js";

// ─── Fixtures ───────────────────────────────────────────────────────────────

const ARXIV_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
  <entry>
    <id>https://arxiv.org/abs/2401.10001</id>
    <title>Transformer Fine-Tuning with LoRA: A Deep Dive</title>
    <summary>We analyze low-rank adaptation for transformer fine-tuning and propose improved initialization strategies that accelerate convergence on NLP benchmarks.</summary>
    <published>2024-01-15T00:00:00Z</published>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2401.10001"/>
    <author><name>Alice Wu</name></author>
    <category term="cs.LG"/>
  </entry>
  <entry>
    <id>https://arxiv.org/abs/2401.10002</id>
    <title>Scaling RLHF to Frontier Models</title>
    <summary>Reinforcement learning from human feedback at scale: reward model training, PPO stability, and alignment evaluation across model sizes.</summary>
    <published>2024-01-14T00:00:00Z</published>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2401.10002"/>
    <author><name>Bob Chen</name></author>
    <category term="cs.CL"/>
  </entry>
</feed>`;

const HF_FIXTURE = JSON.stringify([
  {
    modelId: "meta-llama/Llama-3-8B-Instruct",
    id: "meta-llama/Llama-3-8B-Instruct",
    pipeline_tag: "text-generation",
    trendingScore: 95.0,
    likes: 8900,
    downloads: 5200000,
    createdAt: "2024-01-12T00:00:00.000Z",
    cardData: { description: "Llama 3 instruction-tuned model for chat and reasoning." },
  },
]);

const GITHUB_FIXTURE = JSON.stringify({
  total_count: 1,
  items: [
    {
      full_name: "huggingface/peft",
      html_url: "https://github.com/huggingface/peft",
      description: "Parameter-Efficient Fine-Tuning library for large language models.",
      stargazers_count: 14200,
      pushed_at: "2024-01-14T00:00:00Z",
      created_at: "2022-12-01T00:00:00Z",
      topics: ["machine-learning", "fine-tuning", "peft"],
    },
  ],
});

// ─── Fake HTTP client ────────────────────────────────────────────────────────

function makeHttpResponse(body: string, status = 200): HttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
}

function fakeHttp(throwOnUrl?: string): HttpClient {
  return {
    async get(url: string): Promise<HttpResponse> {
      if (throwOnUrl && url.includes(throwOnUrl)) {
        throw new Error(`Simulated failure for ${url}`);
      }
      if (url.includes("export.arxiv.org")) {
        return makeHttpResponse(ARXIV_FIXTURE);
      }
      if (url.includes("huggingface.co")) {
        return makeHttpResponse(HF_FIXTURE);
      }
      if (url.includes("api.github.com")) {
        return makeHttpResponse(GITHUB_FIXTURE);
      }
      if (url.includes("hn.algolia.com")) {
        return makeHttpResponse(
          JSON.stringify({ hits: [{ objectID: "99001", title: "LLM Alignment in Practice", url: "https://hn.com/99001", points: 250, created_at: "2024-01-15T10:00:00.000Z", story_text: "Discussion about practical alignment techniques for large language models.", author: "hn_user" }] }),
        );
      }
      // Default: empty RSS
      return makeHttpResponse(`<?xml version="1.0"?><rss version="2.0"><channel><title>Empty</title></channel></rss>`);
    },
  };
}

// ─── Fake LLM that returns keyword-style scored items ────────────────────────

function fakeLlm(items?: Array<{ id: string; score: number; reason: string }>): Llm {
  return {
    async complete(req) {
      // Extract item ids from the prompt
      const idMatches = [...req.messages[0]!.content.matchAll(/id=([a-f0-9]{16})/g)];
      const ids = idMatches.map((m) => m[1]!);

      const results = items ?? ids.map((id) => ({ id, score: 7, reason: "Keyword match in title" }));
      return {
        text: JSON.stringify(results),
        provider: "fake",
        model: "fake-model",
      };
    },
  };
}

// ─── Config with 3 sources ───────────────────────────────────────────────────

function makeConfig(extra: Partial<RadarConfig> = {}): RadarConfig {
  return {
    sources: [
      { id: "arxiv-test", type: "paper", adapter: "arxiv", options: { categories: ["cs.LG"], maxResults: 5 } },
      { id: "hf-test", type: "model", adapter: "huggingface", options: { sort: "trending", limit: 5 } },
      { id: "github-test", type: "repo", adapter: "github-trending", options: { since: "weekly" } },
    ],
    judge: { minScore: 5, topN: 20 },
    ...extra,
  };
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("runRadar — end-to-end with fakes", () => {
  it("returns a Digest with items from multiple sources", async () => {
    const digest = await runRadar({
      config: makeConfig(),
      profile: defaultProfile(),
      http: fakeHttp(),
      llm: fakeLlm(),
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });

    expect(digest.items.length).toBeGreaterThan(0);
    expect(digest.date).toBe("2024-01-15");
    expect(digest.consideredCount).toBeGreaterThan(0);
  });

  it("items are sorted descending by score", async () => {
    const digest = await runRadar({
      config: makeConfig(),
      profile: defaultProfile(),
      http: fakeHttp(),
      llm: fakeLlm(),
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });

    for (let i = 0; i < digest.items.length - 1; i++) {
      const curr = digest.items[i];
      const next = digest.items[i + 1];
      if (curr && next) {
        expect(curr.score).toBeGreaterThanOrEqual(next.score);
      }
    }
  });

  it("groups by sourceType and has at least one group", async () => {
    const digest = await runRadar({
      config: makeConfig(),
      profile: defaultProfile(),
      http: fakeHttp(),
      llm: fakeLlm(),
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });

    expect(digest.groups.length).toBeGreaterThan(0);
    for (const group of digest.groups) {
      expect(group.items.length).toBeGreaterThan(0);
    }
  });

  it("uses keyword scorer when no llm is provided", async () => {
    const digest = await runRadar({
      config: makeConfig(),
      profile: defaultProfile(),
      http: fakeHttp(),
      llm: undefined,
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });

    expect(digest.items.length).toBeGreaterThanOrEqual(0);
    // All scored items should use keyword scorer (if any pass the threshold)
    for (const item of digest.items) {
      expect(item.scorer).toBe("keyword");
    }
  });

  it("isolates a failing source — other sources still yield items", async () => {
    // Make github adapter fail by throwing on github API URL
    const httpWithFailingGithub = fakeHttp("api.github.com");

    const digest = await runRadar({
      config: makeConfig(),
      profile: defaultProfile(),
      http: httpWithFailingGithub,
      llm: fakeLlm(),
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });

    // arxiv and hf should still contribute items
    expect(digest.consideredCount).toBeGreaterThan(0);
    // The warn logger should have been called for the github failure
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("github-test"));
  });

  it("respects minScore from config.judge", async () => {
    // With minScore = 0, all items pass
    const digest = await runRadar({
      config: makeConfig({ judge: { minScore: 0, topN: 100 } }),
      profile: { ...defaultProfile(), minScore: 0 },
      http: fakeHttp(),
      llm: fakeLlm(),
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });
    expect(digest.items.length).toBeGreaterThan(0);

    // With minScore = 11 (impossible), no items pass
    const digestEmpty = await runRadar({
      config: makeConfig({ judge: { minScore: 11, topN: 100 } }),
      profile: { ...defaultProfile(), minScore: 11 },
      http: fakeHttp(),
      llm: fakeLlm(
        // Force scores to 3 so nothing passes
        [
          { id: "placeholder", score: 3, reason: "Low score" },
        ],
      ),
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });
    expect(digestEmpty.items.length).toBe(0);
  });

  it("respects topN limit from config.judge", async () => {
    const digest = await runRadar({
      config: makeConfig({ judge: { minScore: 0, topN: 2 } }),
      profile: { ...defaultProfile(), minScore: 0, topN: 2 },
      http: fakeHttp(),
      llm: fakeLlm(),
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });
    expect(digest.items.length).toBeLessThanOrEqual(2);
  });

  it("muted topics are suppressed (score 0) and excluded from digest above threshold", async () => {
    const profile: InterestProfile = {
      ...defaultProfile(),
      mutedTopics: ["rlhf"],  // "Scaling RLHF" contains this
      minScore: 6,
    };

    const digest = await runRadar({
      config: makeConfig({ judge: { minScore: 6, topN: 20 } }),
      profile,
      http: fakeHttp(),
      llm: undefined, // keyword scorer
      logger,
      now: () => new Date("2024-01-15T00:00:00Z"),
    });

    // No item with "rlhf" in the title should appear in filtered digest
    const rlhfItems = digest.items.filter((i) =>
      i.title.toLowerCase().includes("rlhf"),
    );
    expect(rlhfItems).toHaveLength(0);
  });
});
