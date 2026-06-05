import { describe, it, expect } from "vitest";
import type { Item, ScoredItem, InterestProfile } from "../../src/types.js";
import type { Llm, LlmRequest, LlmResponse } from "../../src/contracts.js";
import { keywordScore, scoreItems } from "../../src/judge/judge.js";
import { dedupe } from "../../src/judge/dedup.js";
import { applyReaction, parseReaction } from "../../src/feedback/feedback.js";
import { precisionAtK, runGoldenEval } from "../../src/eval/precision.js";
import { defaultProfile } from "../../src/profile/profile.js";
import { stableId } from "../../src/util/id.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<Item> & { id?: string }): Item {
  const id = overrides.id ?? stableId(overrides.url ?? `https://example.com/${Math.random()}`);
  return {
    id,
    title: overrides.title ?? "Untitled",
    url: overrides.url ?? `https://example.com/${id}`,
    source: overrides.source ?? "test",
    sourceType: overrides.sourceType ?? "paper",
    summary: overrides.summary ?? "",
    published: overrides.published ?? new Date().toISOString(),
    ...overrides,
  };
}

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

const mlProfile: InterestProfile = {
  ...defaultProfile(),
  interests: "large language models transformers fine-tuning alignment inference quantization",
  keywords: ["llm", "transformer", "finetune", "alignment", "inference", "quantization"],
  mutedTopics: [],
  exemplars: [],
};

// ---------------------------------------------------------------------------
// keywordScore
// ---------------------------------------------------------------------------

describe("keywordScore", () => {
  it("ranks an on-topic item above an off-topic one", () => {
    const onTopic = makeItem({
      url: "https://example.com/1",
      title: "Efficient LLM quantization for faster inference",
      summary: "We present techniques for quantizing large language models to reduce inference cost.",
    });
    const offTopic = makeItem({
      url: "https://example.com/2",
      title: "Growing tomatoes in your garden",
      summary: "A guide to growing vegetables at home without any special equipment.",
    });

    const { score: onScore } = keywordScore(onTopic, mlProfile);
    const { score: offScore } = keywordScore(offTopic, mlProfile);

    expect(onScore).toBeGreaterThan(offScore);
  });

  it("returns a reason naming matched terms for on-topic item", () => {
    const item = makeItem({
      url: "https://example.com/3",
      title: "Transformer alignment paper",
      summary: "Alignment of transformer models using RLHF",
    });
    const { reason } = keywordScore(item, mlProfile);
    expect(reason).toMatch(/transformer|alignment/i);
  });

  it("returns score 0 and 'No keyword matches' for completely off-topic", () => {
    const item = makeItem({
      url: "https://example.com/4",
      title: "Cookie recipes for holidays",
      summary: "Bake delicious cookies for the festive season.",
    });
    const profile: InterestProfile = {
      ...mlProfile,
      interests: "xyz abc",
      keywords: ["xyz"],
    };
    const { score, reason } = keywordScore(item, profile);
    expect(score).toBe(0);
    expect(reason).toBe("No keyword matches");
  });
});

// ---------------------------------------------------------------------------
// Muted topics suppressed by scoreItems
// ---------------------------------------------------------------------------

describe("scoreItems — muted topics", () => {
  it("suppresses items whose title/summary matches a muted topic", async () => {
    const mutedProfile: InterestProfile = {
      ...mlProfile,
      mutedTopics: ["blockchain"],
    };

    const items = [
      makeItem({
        url: "https://example.com/5",
        title: "Blockchain and AI convergence",
        summary: "How blockchain technology meets artificial intelligence.",
      }),
      makeItem({
        url: "https://example.com/6",
        title: "Transformer quantization techniques",
        summary: "Efficient quantization of transformer models for fast llm inference.",
      }),
    ];

    const result = await scoreItems(items, mutedProfile, { logger: noopLogger });
    const mutedItem = result.find((i) => i.title.toLowerCase().includes("blockchain"));
    expect(mutedItem).toBeDefined();
    expect(mutedItem!.score).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// dedupe
// ---------------------------------------------------------------------------

describe("dedupe", () => {
  it("collapses exact id duplicates, keeping longer summary", () => {
    const url = "https://example.com/paper1";
    const id = stableId(url);
    const items = [
      makeItem({ id, url, title: "Paper on LLMs", summary: "Short summary." }),
      makeItem({ id, url, title: "Paper on LLMs", summary: "A much longer and more detailed summary." }),
    ];
    const result = dedupe(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.summary).toBe("A much longer and more detailed summary.");
  });

  it("collapses near-duplicate titles with Jaccard >= 0.9", () => {
    const items = [
      makeItem({
        url: "https://example.com/a",
        title: "Efficient Transformer Fine-Tuning Methods",
        summary: "Short.",
      }),
      makeItem({
        url: "https://example.com/b",
        title: "Efficient Transformer Fine-Tuning Methods",
        summary: "This is a longer summary with more content about fine-tuning.",
      }),
    ];
    const result = dedupe(items);
    expect(result).toHaveLength(1);
    expect(result[0]!.summary).toBe(
      "This is a longer summary with more content about fine-tuning."
    );
  });

  it("keeps distinct items separate", () => {
    const items = [
      makeItem({
        url: "https://example.com/c",
        title: "Deep Learning for Vision",
        summary: "Vision models paper.",
      }),
      makeItem({
        url: "https://example.com/d",
        title: "Reinforcement Learning from Human Feedback",
        summary: "RLHF paper.",
      }),
    ];
    const result = dedupe(items);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// applyReaction
// ---------------------------------------------------------------------------

describe("applyReaction", () => {
  const fixedNow = () => new Date("2024-01-01T12:00:00Z");

  it("appends an exemplar for 'up' reaction", () => {
    const profile = defaultProfile();
    const updated = applyReaction(
      profile,
      { title: "Great LLM paper", summary: "About alignment." },
      "up",
      fixedNow
    );
    expect(updated.exemplars).toHaveLength(1);
    expect(updated.exemplars[0]!.label).toBe("up");
    expect(updated.exemplars[0]!.title).toBe("Great LLM paper");
  });

  it("appends an exemplar for 'down' reaction", () => {
    const profile = defaultProfile();
    const updated = applyReaction(
      profile,
      { title: "Boring post", summary: "" },
      "down",
      fixedNow
    );
    expect(updated.exemplars[0]!.label).toBe("down");
  });

  it("caps exemplars at 50", () => {
    let profile = defaultProfile();
    // Add 55 exemplars
    for (let i = 0; i < 55; i++) {
      profile = applyReaction(
        profile,
        { title: `Item ${i}`, summary: "" },
        "up",
        fixedNow
      );
    }
    expect(profile.exemplars).toHaveLength(50);
    // Should keep the last 50
    expect(profile.exemplars[0]!.title).toBe("Item 5");
    expect(profile.exemplars[49]!.title).toBe("Item 54");
  });

  it("mute reaction adds topic to mutedTopics", () => {
    const profile = defaultProfile();
    const updated = applyReaction(
      profile,
      { title: "blockchain nonsense" },
      "mute",
      fixedNow
    );
    expect(updated.mutedTopics).toContain("blockchain nonsense");
    expect(updated.exemplars).toHaveLength(1);
  });

  it("mute reaction does not duplicate an already-muted topic", () => {
    const profile: InterestProfile = {
      ...defaultProfile(),
      mutedTopics: ["blockchain nonsense"],
    };
    const updated = applyReaction(
      profile,
      { title: "blockchain nonsense" },
      "mute",
      fixedNow
    );
    expect(updated.mutedTopics.filter((t) => t === "blockchain nonsense")).toHaveLength(1);
  });

  it("is pure — does not mutate the input profile", () => {
    const profile = defaultProfile();
    const before = JSON.stringify(profile);
    applyReaction(profile, { title: "foo" }, "up", fixedNow);
    expect(JSON.stringify(profile)).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// parseReaction
// ---------------------------------------------------------------------------

describe("parseReaction", () => {
  it("maps 👍 to 'up'", () => {
    expect(parseReaction("👍")).toBe("up");
  });

  it("maps +1 to 'up'", () => {
    expect(parseReaction("+1")).toBe("up");
  });

  it("maps 'more like this' to 'up'", () => {
    expect(parseReaction("more like this")).toBe("up");
  });

  it("maps 'more like' to 'up'", () => {
    expect(parseReaction("more like")).toBe("up");
  });

  it("maps 👎 to 'down'", () => {
    expect(parseReaction("👎")).toBe("down");
  });

  it("maps -1 to 'down'", () => {
    expect(parseReaction("-1")).toBe("down");
  });

  it("maps 'mute X' to 'mute'", () => {
    expect(parseReaction("mute blockchain")).toBe("mute");
  });

  it("maps 🔇 to 'mute'", () => {
    expect(parseReaction("🔇")).toBe("mute");
  });

  it("returns undefined for unrecognized text", () => {
    expect(parseReaction("hello there")).toBeUndefined();
    expect(parseReaction("")).toBeUndefined();
    expect(parseReaction("interesting")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// precisionAtK
// ---------------------------------------------------------------------------

describe("precisionAtK", () => {
  function makeScoredItem(id: string, score: number): ScoredItem {
    return {
      id,
      title: `Item ${id}`,
      url: `https://example.com/${id}`,
      source: "test",
      sourceType: "paper",
      summary: "",
      published: new Date().toISOString(),
      score,
      reason: "test",
      scorer: "keyword",
    };
  }

  it("computes exact p@5 on hand-built example", () => {
    // 10 items, ranked by score descending: ids 1..10
    // Relevant: 1,3,5,7,9
    const ranked = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
      makeScoredItem(String(i), 11 - i)
    );
    const relevantIds = new Set(["1", "3", "5", "7", "9"]);
    // Top 5: ids 1,2,3,4,5 → relevant: 1,3,5 = 3/5 = 0.6
    const p5 = precisionAtK(ranked, relevantIds, 5);
    expect(p5).toBeCloseTo(0.6, 10);
  });

  it("computes exact p@10 on hand-built example", () => {
    const ranked = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
      makeScoredItem(String(i), 11 - i)
    );
    const relevantIds = new Set(["1", "3", "5", "7", "9"]);
    // Top 10: all 10 → relevant: 1,3,5,7,9 = 5/10 = 0.5
    const p10 = precisionAtK(ranked, relevantIds, 10);
    expect(p10).toBeCloseTo(0.5, 10);
  });

  it("returns 0 when k=0", () => {
    const ranked = [makeScoredItem("a", 5)];
    expect(precisionAtK(ranked, new Set(["a"]), 0)).toBe(0);
  });

  it("handles k > ranked length gracefully", () => {
    const ranked = [makeScoredItem("a", 5)];
    // 1 relevant in top 5, but only 1 item → 1/5 = 0.2
    const p = precisionAtK(ranked, new Set(["a"]), 5);
    expect(p).toBeCloseTo(0.2, 10);
  });
});

describe("runGoldenEval", () => {
  it("returns p@5 and p@10 keys by default", () => {
    const scored: ScoredItem[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => ({
      id: String(i),
      title: `Item ${i}`,
      url: `https://example.com/${i}`,
      source: "test",
      sourceType: "paper" as const,
      summary: "",
      published: new Date().toISOString(),
      score: 11 - i,
      reason: "test",
      scorer: "keyword" as const,
    }));
    const labels = scored.map((s) => ({ id: s.id, relevant: parseInt(s.id) % 2 === 1 }));
    const result = runGoldenEval(scored, labels);
    expect(result).toHaveProperty("p@5");
    expect(result).toHaveProperty("p@10");
    expect(result["p@5"]).toBeCloseTo(0.6, 10);
    expect(result["p@10"]).toBeCloseTo(0.5, 10);
  });
});

// ---------------------------------------------------------------------------
// scoreItems with a FAKE Llm returning canned valid JSON
// ---------------------------------------------------------------------------

describe("scoreItems — LLM path", () => {
  const items: Item[] = [
    makeItem({
      id: "id-alpha",
      url: "https://example.com/alpha",
      title: "LLM Alignment Techniques",
      summary: "A survey of RLHF and alignment methods for large language models.",
    }),
    makeItem({
      id: "id-beta",
      url: "https://example.com/beta",
      title: "Gardening tips for spring",
      summary: "Plant tomatoes in warm soil.",
    }),
  ];

  it("returns ScoredItem[] with scorer 'llm' when LLM returns valid JSON", async () => {
    const cannedResponse = JSON.stringify([
      { id: "id-alpha", score: 9, reason: "Highly relevant to LLM alignment interests." },
      { id: "id-beta", score: 1, reason: "Unrelated to ML research." },
    ]);

    const fakeLlm: Llm = {
      async complete(_req: LlmRequest): Promise<LlmResponse> {
        return { text: cannedResponse };
      },
    };

    const result = await scoreItems(items, mlProfile, { llm: fakeLlm, logger: noopLogger });

    expect(result).toHaveLength(2);
    const alpha = result.find((i) => i.id === "id-alpha");
    const beta = result.find((i) => i.id === "id-beta");

    expect(alpha).toBeDefined();
    expect(alpha!.score).toBe(9);
    expect(alpha!.scorer).toBe("llm");
    expect(alpha!.reason).toBe("Highly relevant to LLM alignment interests.");

    expect(beta).toBeDefined();
    expect(beta!.score).toBe(1);
    expect(beta!.scorer).toBe("llm");
  });

  it("uses keyword fallback when no LLM provided", async () => {
    const result = await scoreItems(items, mlProfile, { logger: noopLogger });
    expect(result).toHaveLength(2);
    for (const item of result) {
      expect(item.scorer).toBe("keyword");
    }
  });

  it("falls back to keyword when LLM returns garbage JSON — no throw", async () => {
    const fakeLlm: Llm = {
      async complete(_req: LlmRequest): Promise<LlmResponse> {
        return { text: "Sorry, I cannot answer that. Here's some random text [[[ not json" };
      },
    };

    // scoreItems must NOT throw — if it does, the test will fail naturally
    const result = await scoreItems(items, mlProfile, { llm: fakeLlm, logger: noopLogger });

    expect(result).toBeDefined();
    expect(result.length).toBe(2);
    for (const item of result) {
      expect(item.scorer).toBe("keyword");
    }
  });

  it("falls back to keyword when LLM throws — no throw from scoreItems", async () => {
    const fakeLlm: Llm = {
      async complete(_req: LlmRequest): Promise<LlmResponse> {
        throw new Error("Network error");
      },
    };

    // scoreItems must NOT throw — if it does, the test will fail naturally
    const result = await scoreItems(items, mlProfile, { llm: fakeLlm, logger: noopLogger });

    expect(result).toBeDefined();
    for (const item of result) {
      expect(item.scorer).toBe("keyword");
    }
  });

  it("LLM response wrapped in markdown fences is parsed correctly", async () => {
    const cannedResponse = `\`\`\`json\n${JSON.stringify([
      { id: "id-alpha", score: 8, reason: "Relevant to alignment." },
      { id: "id-beta", score: 2, reason: "Off-topic." },
    ])}\n\`\`\``;

    const fakeLlm: Llm = {
      async complete(_req: LlmRequest): Promise<LlmResponse> {
        return { text: cannedResponse };
      },
    };

    const result = await scoreItems(items, mlProfile, { llm: fakeLlm, logger: noopLogger });
    const alpha = result.find((i) => i.id === "id-alpha");
    expect(alpha!.scorer).toBe("llm");
    expect(alpha!.score).toBe(8);
  });

  it("scores exceed 10 are clamped to 10", async () => {
    const cannedResponse = JSON.stringify([
      { id: "id-alpha", score: 15, reason: "Way too high." },
      { id: "id-beta", score: 1, reason: "Low." },
    ]);

    const fakeLlm: Llm = {
      async complete(_req: LlmRequest): Promise<LlmResponse> {
        return { text: cannedResponse };
      },
    };

    const result = await scoreItems(items, mlProfile, { llm: fakeLlm, logger: noopLogger });
    const alpha = result.find((i) => i.id === "id-alpha");
    expect(alpha!.score).toBe(10);
  });

  it("respects maxItemsToScore — overflow items get keyword scorer", async () => {
    const manyItems: Item[] = Array.from({ length: 5 }, (_, i) =>
      makeItem({
        id: `item-${i}`,
        url: `https://example.com/item-${i}`,
        title: `LLM paper ${i} transformer alignment inference`,
        summary: `Summary for item ${i} about llm and transformer.`,
      })
    );

    // Canned response only for first 2 (maxItemsToScore=2)
    let callCount = 0;
    const fakeLlm: Llm = {
      async complete(req: LlmRequest): Promise<LlmResponse> {
        callCount++;
        // Parse item ids from prompt
        const lines = req.messages[0]!.content.split("\n");
        const ids = lines
          .filter((l) => l.includes("id="))
          .map((l) => {
            const m = l.match(/id=([^\s|]+)/);
            return m ? m[1]! : null;
          })
          .filter(Boolean) as string[];

        return {
          text: JSON.stringify(
            ids.map((id) => ({ id, score: 7, reason: "LLM scored." }))
          ),
        };
      },
    };

    const result = await scoreItems(manyItems, mlProfile, {
      llm: fakeLlm,
      logger: noopLogger,
      maxItemsToScore: 2,
    });

    expect(result).toHaveLength(5);
    // exactly 1 LLM call
    expect(callCount).toBe(1);
    const llmScored = result.filter((i) => i.scorer === "llm");
    const kwScored = result.filter((i) => i.scorer === "keyword");
    expect(llmScored).toHaveLength(2);
    expect(kwScored).toHaveLength(3);
  });
});
