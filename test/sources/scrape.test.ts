import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createScrapeAdapter } from "../../src/sources/scrape.js";
import { fakeHttp, fakeDeps, fakeLogger } from "./helpers.js";
import type { SourceConfig } from "../../src/types.js";
import type { HttpClient, SourceDeps } from "../../src/contracts.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

const cfg: SourceConfig = {
  id: "gwern",
  type: "post",
  adapter: "scrape",
  options: { url: "https://gwern.net" },
};

describe("createScrapeAdapter", () => {
  it("extracts valid links from HTML fixture", async () => {
    const html = loadFixture("scrape.html");
    const adapter = createScrapeAdapter(cfg, fakeDeps(fakeHttp(html)));
    const items = await adapter.fetch();

    // Should get 3 real links (The Scaling Hypothesis, GPT-3, Local Page, Reward Hacking)
    // Skip anchors, js:, mailto: links
    expect(items.length).toBeGreaterThanOrEqual(3);
  });

  it("sets sourceType to post", async () => {
    const html = loadFixture("scrape.html");
    const adapter = createScrapeAdapter(cfg, fakeDeps(fakeHttp(html)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.sourceType).toBe("post");
    }
  });

  it("extracts absolute urls", async () => {
    const html = loadFixture("scrape.html");
    const adapter = createScrapeAdapter(cfg, fakeDeps(fakeHttp(html)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.url).toMatch(/^https?:\/\//);
    }
  });

  it("resolves relative hrefs against base url", async () => {
    const html = loadFixture("scrape.html");
    const adapter = createScrapeAdapter(cfg, fakeDeps(fakeHttp(html)));
    const items = await adapter.fetch();

    // /local-page should be resolved to https://gwern.net/local-page
    const localPageItem = items.find((i) => i.url.includes("local-page"));
    expect(localPageItem).toBeDefined();
    expect(localPageItem?.url).toMatch(/^https:\/\/gwern\.net/);
  });

  it("excludes anchor-only and javascript: links", async () => {
    const html = loadFixture("scrape.html");
    const adapter = createScrapeAdapter(cfg, fakeDeps(fakeHttp(html)));
    const items = await adapter.fetch();

    // None should be # or javascript: links
    for (const item of items) {
      expect(item.url).not.toMatch(/^#/);
      expect(item.url).not.toMatch(/^javascript:/);
      expect(item.url).not.toMatch(/^mailto:/);
    }
  });

  it("returns empty on HTTP error (no throw)", async () => {
    const logger = fakeLogger();
    const deps: SourceDeps = {
      http: fakeHttp("", { ok: false, status: 404 }) as HttpClient,
      logger,
      now: () => new Date("2025-01-15T12:00:00Z"),
    };
    const adapter = createScrapeAdapter(cfg, deps);
    const items = await adapter.fetch();
    expect(items).toHaveLength(0);
    expect(logger.warns.length).toBeGreaterThan(0);
  });

  it("never throws on empty HTML", async () => {
    const adapter = createScrapeAdapter(cfg, fakeDeps(fakeHttp("<html></html>")));
    const items = await adapter.fetch();
    expect(items).toHaveLength(0);
  });

  it("published is the current time from deps.now", async () => {
    const html = loadFixture("scrape.html");
    const adapter = createScrapeAdapter(cfg, fakeDeps(fakeHttp(html)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) return; // OK if empty
    expect(first.published).toBe("2025-01-15T12:00:00.000Z");
  });

  it("throws on missing url option", () => {
    expect(() =>
      createScrapeAdapter(
        { id: "bad", type: "post", adapter: "scrape", options: {} },
        fakeDeps(fakeHttp("")),
      ),
    ).toThrow(/requires options\.url/);
  });
});
