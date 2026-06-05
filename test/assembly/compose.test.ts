import { describe, it, expect } from "vitest";
import { compose, renderMarkdown, renderCanvasCard } from "../../src/digest/compose.js";
import type { ScoredItem, InterestProfile } from "../../src/types.js";

function makeItem(
  id: string,
  score: number,
  sourceType: ScoredItem["sourceType"] = "paper",
  source = "test",
): ScoredItem {
  return {
    id,
    title: `Title for ${id}`,
    url: `https://example.com/${id}`,
    source,
    sourceType,
    summary: `Summary for ${id}`,
    published: "2024-01-15T00:00:00Z",
    score,
    reason: `Matched on ${id}`,
    scorer: "keyword",
  };
}

const baseProfile: InterestProfile = {
  interests: "machine learning llm",
  keywords: ["llm", "transformer"],
  mutedTopics: [],
  exemplars: [],
  minScore: 6,
  topN: 5,
};

describe("compose", () => {
  it("filters items below minScore", () => {
    const items = [makeItem("a", 8), makeItem("b", 5), makeItem("c", 3)];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 3 });
    expect(d.items).toHaveLength(1);
    expect(d.items[0]?.id).toBe("a");
  });

  it("sorts descending by score", () => {
    const items = [makeItem("a", 7), makeItem("b", 9), makeItem("c", 8)];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 3 });
    expect(d.items.map((i) => i.id)).toEqual(["b", "c", "a"]);
  });

  it("respects topN limit", () => {
    const items = Array.from({ length: 10 }, (_, i) => makeItem(`item${i}`, 8));
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 10 });
    expect(d.items).toHaveLength(5); // topN = 5
  });

  it("groups by sourceType", () => {
    const items = [
      makeItem("p1", 9, "paper", "arxiv"),
      makeItem("m1", 8, "model", "hf"),
      makeItem("p2", 7, "paper", "arxiv"),
      makeItem("r1", 7, "repo", "github"),
    ];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 4 });
    const types = d.groups.map((g) => g.type);
    expect(types).toContain("paper");
    expect(types).toContain("model");
    expect(types).toContain("repo");
  });

  it("sets consideredCount correctly", () => {
    const d = compose([], baseProfile, { date: "2024-01-15", consideredCount: 42 });
    expect(d.consideredCount).toBe(42);
  });

  it("returns empty items when nothing passes minScore threshold", () => {
    const items = [makeItem("a", 4), makeItem("b", 2)];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 2 });
    expect(d.items).toHaveLength(0);
    expect(d.groups).toHaveLength(0);
  });

  it("uses custom minScore from profile", () => {
    const profile = { ...baseProfile, minScore: 9 };
    const items = [makeItem("a", 8), makeItem("b", 9), makeItem("c", 10)];
    const d = compose(items, profile, { date: "2024-01-15", consideredCount: 3 });
    expect(d.items).toHaveLength(2);
    expect(d.items.map((i) => i.id)).toContain("b");
    expect(d.items.map((i) => i.id)).toContain("c");
  });
});

describe("renderMarkdown", () => {
  it("numbers items starting at 1 and #N maps to items[N-1]", () => {
    const items = [makeItem("a", 9), makeItem("b", 8), makeItem("c", 7)];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 3 });
    const md = renderMarkdown(d);

    // Item #1 should be the highest-scored item (a)
    expect(md).toContain("**#1**");
    expect(md).toContain("**#2**");
    expect(md).toContain("**#3**");

    // #1 maps to d.items[0] which should be item "a" (score 9 = highest)
    expect(d.items[0]?.id).toBe("a");
    // Verify #1 appears with item a's title
    const n1line = md.split("\n").find((l) => l.includes("**#1**"));
    expect(n1line).toBeDefined();
    expect(n1line).toContain("Title for a");
  });

  it("#N numbering is contiguous", () => {
    const items = [makeItem("a", 9), makeItem("b", 8), makeItem("c", 7), makeItem("d", 6)];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 4 });
    const md = renderMarkdown(d);

    const numbers: number[] = [];
    const regex = /\*\*#(\d+)\*\*/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(md)) !== null) {
      if (match[1]) numbers.push(parseInt(match[1], 10));
    }

    // Should be 1, 2, 3, 4 contiguous
    expect(numbers.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
  });

  it("renders empty digest gracefully", () => {
    const d = compose([], baseProfile, { date: "2024-01-15", consideredCount: 10 });
    const md = renderMarkdown(d);
    expect(md).toContain("No items matched");
    expect(md).toContain("10 items considered");
  });

  it("includes source, link, and reason in each line", () => {
    const items = [makeItem("x", 8, "paper", "arxiv")];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 1 });
    const md = renderMarkdown(d);
    expect(md).toContain("arxiv");
    expect(md).toContain("https://example.com/x");
    expect(md).toContain("Matched on x");
  });

  it("includes date in header", () => {
    const d = compose([], baseProfile, { date: "2024-01-15", consideredCount: 0 });
    const md = renderMarkdown(d);
    expect(md).toContain("2024-01-15");
  });
});

describe("renderCanvasCard", () => {
  it("returns a plain JSON object with expected fields", () => {
    const items = [makeItem("a", 9), makeItem("b", 7)];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 2 });
    const card = renderCanvasCard(d) as Record<string, unknown>;

    expect(card["title"]).toBe("Research Radar");
    expect(card["date"]).toBe("2024-01-15");
    expect(card["consideredCount"]).toBe(2);
    expect(Array.isArray(card["sections"])).toBe(true);
  });

  it("sections contain items with n, title, score, url", () => {
    const items = [makeItem("a", 9, "paper"), makeItem("b", 7, "model")];
    const d = compose(items, baseProfile, { date: "2024-01-15", consideredCount: 2 });
    const card = renderCanvasCard(d) as { sections: Array<{ items: Array<{ n: number; title: string; score: number; url: string }> }> };

    const allItems = card.sections.flatMap((s) => s.items);
    expect(allItems.some((i) => i.n === 1)).toBe(true);
    expect(allItems.some((i) => i.n === 2)).toBe(true);
    expect(allItems[0]).toHaveProperty("title");
    expect(allItems[0]).toHaveProperty("score");
    expect(allItems[0]).toHaveProperty("url");
  });
});
