import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHackerNewsAdapter } from "../../src/sources/hackernews.js";
import { fakeHttp, fakeDeps } from "./helpers.js";
import type { SourceConfig } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

const cfg: SourceConfig = {
  id: "hn-ml",
  type: "post",
  adapter: "hackernews",
  options: { query: "machine learning", minPoints: 100 },
};

describe("createHackerNewsAdapter", () => {
  it("parses 3 hits from fixture", async () => {
    const json = loadFixture("hackernews.json");
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    expect(items).toHaveLength(3);
  });

  it("sets sourceType to post", async () => {
    const json = loadFixture("hackernews.json");
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.sourceType).toBe("post");
    }
  });

  it("parses title and url correctly", async () => {
    const json = loadFixture("hackernews.json");
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.title).toBe("Show HN: I built an open-source LLM evaluation framework");
    expect(first.url).toBe("https://github.com/example/llm-eval");
  });

  it("parses published as ISO-8601", async () => {
    const json = loadFixture("hackernews.json");
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.published).toBe(new Date("2025-01-15T10:30:00.000Z").toISOString());
  });

  it("stores points in extra", async () => {
    const json = loadFixture("hackernews.json");
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.extra?.points).toBe(342);
  });

  it("sets author correctly", async () => {
    const json = loadFixture("hackernews.json");
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.authors).toEqual(["hacker1"]);
  });

  it("summary is empty string (HN has no body)", async () => {
    const json = loadFixture("hackernews.json");
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.summary).toBe("");
    }
  });

  it("returns empty on missing hits", async () => {
    const adapter = createHackerNewsAdapter(
      cfg,
      fakeDeps(fakeHttp(JSON.stringify({ hits: [], nbHits: 0 }))),
    );
    const items = await adapter.fetch();
    expect(items).toHaveLength(0);
  });

  it("throws on non-OK HTTP", async () => {
    const adapter = createHackerNewsAdapter(cfg, fakeDeps(fakeHttp("", { ok: false, status: 500 })));
    await expect(adapter.fetch()).rejects.toThrow("HackerNews Algolia HTTP 500");
  });
});
