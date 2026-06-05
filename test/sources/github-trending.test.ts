import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createGithubTrendingAdapter } from "../../src/sources/github-trending.js";
import { fakeHttp, fakeDeps } from "./helpers.js";
import type { SourceConfig } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

const cfg: SourceConfig = {
  id: "github-ml",
  type: "repo",
  adapter: "github-trending",
  options: { since: "daily", topic: "machine-learning" },
};

describe("createGithubTrendingAdapter", () => {
  it("parses 3 repos from fixture", async () => {
    const json = loadFixture("github.json");
    const adapter = createGithubTrendingAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    expect(items).toHaveLength(3);
  });

  it("sets sourceType to repo", async () => {
    const json = loadFixture("github.json");
    const adapter = createGithubTrendingAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.sourceType).toBe("repo");
    }
  });

  it("parses title, url, and stars correctly", async () => {
    const json = loadFixture("github.json");
    const adapter = createGithubTrendingAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.title).toBe("huggingface/transformers");
    expect(first.url).toBe("https://github.com/huggingface/transformers");
    expect(first.extra?.stars).toBe(120000);
  });

  it("puts stars in extra.stars", async () => {
    const json = loadFixture("github.json");
    const adapter = createGithubTrendingAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(typeof item.extra?.stars).toBe("number");
    }
  });

  it("parses description as summary", async () => {
    const json = loadFixture("github.json");
    const adapter = createGithubTrendingAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.summary).toContain("Transformers");
  });

  it("parses published as ISO-8601", async () => {
    const json = loadFixture("github.json");
    const adapter = createGithubTrendingAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("returns empty on missing items array", async () => {
    const adapter = createGithubTrendingAdapter(
      cfg,
      fakeDeps(fakeHttp(JSON.stringify({ total_count: 0 }))),
    );
    const items = await adapter.fetch();
    expect(items).toHaveLength(0);
  });

  it("throws on non-OK HTTP", async () => {
    const adapter = createGithubTrendingAdapter(cfg, fakeDeps(fakeHttp("", { ok: false, status: 403 })));
    await expect(adapter.fetch()).rejects.toThrow("GitHub search HTTP 403");
  });
});
