import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createAdapter, buildAdapters, fetchAll } from "../../src/sources/registry.js";
import { fakeHttp, fakeDeps, fakeLogger } from "./helpers.js";
import type { SourceConfig, Item } from "../../src/types.js";
import type { SourceAdapter } from "../../src/contracts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

describe("createAdapter", () => {
  it("creates an arxiv adapter", () => {
    const cfg: SourceConfig = {
      id: "test-arxiv",
      type: "paper",
      adapter: "arxiv",
      options: { categories: ["cs.LG"] },
    };
    const xml = loadFixture("arxiv.xml");
    const adapter = createAdapter(cfg, fakeDeps(fakeHttp(xml)));
    expect(adapter.id).toBe("test-arxiv");
    expect(adapter.type).toBe("paper");
  });

  it("creates a huggingface adapter", () => {
    const cfg: SourceConfig = { id: "hf", type: "model", adapter: "huggingface" };
    const adapter = createAdapter(cfg, fakeDeps(fakeHttp("[]")));
    expect(adapter.id).toBe("hf");
  });

  it("creates a github-trending adapter", () => {
    const cfg: SourceConfig = { id: "gh", type: "repo", adapter: "github-trending" };
    const adapter = createAdapter(cfg, fakeDeps(fakeHttp("{}")));
    expect(adapter.id).toBe("gh");
  });

  it("creates a hackernews adapter", () => {
    const cfg: SourceConfig = { id: "hn", type: "post", adapter: "hackernews" };
    const adapter = createAdapter(cfg, fakeDeps(fakeHttp('{"hits":[]}')));
    expect(adapter.id).toBe("hn");
  });

  it("creates an rss adapter", () => {
    const cfg: SourceConfig = {
      id: "rss",
      type: "post",
      adapter: "rss",
      options: { url: "https://example.com/feed.xml" },
    };
    const adapter = createAdapter(cfg, fakeDeps(fakeHttp("")));
    expect(adapter.id).toBe("rss");
  });

  it("creates a scrape adapter", () => {
    const cfg: SourceConfig = {
      id: "scrape",
      type: "post",
      adapter: "scrape",
      options: { url: "https://example.com" },
    };
    const adapter = createAdapter(cfg, fakeDeps(fakeHttp("<html></html>")));
    expect(adapter.id).toBe("scrape");
  });
});

describe("buildAdapters", () => {
  it("skips disabled adapters", () => {
    const configs: SourceConfig[] = [
      { id: "enabled", type: "post", adapter: "hackernews" },
      { id: "disabled", type: "post", adapter: "hackernews", enabled: false },
    ];
    const adapters = buildAdapters(configs, fakeDeps(fakeHttp('{"hits":[]}')));
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.id).toBe("enabled");
  });

  it("returns all enabled adapters", () => {
    const configs: SourceConfig[] = [
      { id: "a1", type: "post", adapter: "hackernews" },
      { id: "a2", type: "post", adapter: "hackernews" },
    ];
    const adapters = buildAdapters(configs, fakeDeps(fakeHttp('{"hits":[]}')));
    expect(adapters).toHaveLength(2);
  });
});

describe("fetchAll — failure isolation", () => {
  it("a throwing adapter does not sink the others", async () => {
    const xml = loadFixture("arxiv.xml");

    // Good adapter returns 3 items
    const goodAdapter: SourceAdapter = {
      id: "good",
      type: "paper",
      fetch: async (): Promise<Item[]> => {
        const { createArxivAdapter } = await import("../../src/sources/arxiv.js");
        const cfg: SourceConfig = {
          id: "good",
          type: "paper",
          adapter: "arxiv",
          options: { categories: ["cs.LG"] },
        };
        return createArxivAdapter(cfg, fakeDeps(fakeHttp(xml))).fetch();
      },
    };

    // Bad adapter always throws
    const badAdapter: SourceAdapter = {
      id: "bad",
      type: "post",
      fetch: async (): Promise<Item[]> => {
        throw new Error("connection refused");
      },
    };

    const logger = fakeLogger();
    const items = await fetchAll([goodAdapter, badAdapter], logger);

    // Good adapter contributes its items
    expect(items.length).toBeGreaterThan(0);
    // Bad adapter logged a warning
    expect(logger.warns.some((w) => w.includes("bad"))).toBe(true);
    expect(logger.warns.some((w) => w.includes("connection refused"))).toBe(true);
  });

  it("returns flat array of all items from multiple adapters", async () => {
    const hnJson = loadFixture("hackernews.json");
    const arxivXml = loadFixture("arxiv.xml");

    const { createHackerNewsAdapter } = await import("../../src/sources/hackernews.js");
    const { createArxivAdapter } = await import("../../src/sources/arxiv.js");

    const hnCfg: SourceConfig = { id: "hn", type: "post", adapter: "hackernews" };
    const arxivCfg: SourceConfig = {
      id: "arxiv",
      type: "paper",
      adapter: "arxiv",
      options: { categories: ["cs.LG"] },
    };

    const adapters: SourceAdapter[] = [
      createHackerNewsAdapter(hnCfg, fakeDeps(fakeHttp(hnJson))),
      createArxivAdapter(arxivCfg, fakeDeps(fakeHttp(arxivXml))),
    ];

    const logger = fakeLogger();
    const items = await fetchAll(adapters, logger);

    // 3 HN + 3 arXiv = 6
    expect(items).toHaveLength(6);
    expect(logger.warns).toHaveLength(0);
  });

  it("all adapters fail → returns empty array with warnings", async () => {
    const bad1: SourceAdapter = {
      id: "bad1",
      type: "post",
      fetch: async () => { throw new Error("err1"); },
    };
    const bad2: SourceAdapter = {
      id: "bad2",
      type: "paper",
      fetch: async () => { throw new Error("err2"); },
    };

    const logger = fakeLogger();
    const items = await fetchAll([bad1, bad2], logger);

    expect(items).toHaveLength(0);
    expect(logger.warns).toHaveLength(2);
  });
});
