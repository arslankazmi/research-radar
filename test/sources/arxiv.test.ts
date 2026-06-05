import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createArxivAdapter } from "../../src/sources/arxiv.js";
import { fakeHttp, fakeDeps } from "./helpers.js";
import type { SourceConfig } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

const cfg: SourceConfig = {
  id: "arxiv-cs-lg",
  type: "paper",
  adapter: "arxiv",
  options: { categories: ["cs.LG"], maxResults: 3 },
};

describe("createArxivAdapter", () => {
  it("parses 3 entries from fixture and returns normalized items", async () => {
    const xml = loadFixture("arxiv.xml");
    const adapter = createArxivAdapter(cfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    expect(items).toHaveLength(3);

    const first = items[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("first item missing");

    expect(first.sourceType).toBe("paper");
    expect(first.source).toBe("arxiv-cs-lg");
    expect(first.title).toBe("Scaling Laws for Neural Language Models Revisited");
    expect(first.url).toBe("http://arxiv.org/abs/2501.00001v1");
    expect(first.id).toHaveLength(16); // stableId returns 16 hex chars
    expect(first.published).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO-8601
    expect(first.authors).toEqual(["Alice Smith", "Bob Jones"]);
    expect(first.summary).toContain("compute-optimal training");
  });

  it("has correct sourceType on all items", async () => {
    const xml = loadFixture("arxiv.xml");
    const adapter = createArxivAdapter(cfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.sourceType).toBe("paper");
    }
  });

  it("returns parsed published dates in ISO-8601", async () => {
    const xml = loadFixture("arxiv.xml");
    const adapter = createArxivAdapter(cfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    // 2025-01-14T18:00:00-05:00 → UTC ISO
    expect(first.published).toBe(new Date("2025-01-14T18:00:00-05:00").toISOString());
  });

  it("throws on non-OK HTTP response", async () => {
    const adapter = createArxivAdapter(cfg, fakeDeps(fakeHttp("", { ok: false, status: 503 })));
    await expect(adapter.fetch()).rejects.toThrow("arXiv HTTP 503");
  });

  it("returns empty array for empty feed", async () => {
    const emptyFeed = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"></feed>`;
    const adapter = createArxivAdapter(cfg, fakeDeps(fakeHttp(emptyFeed)));
    const items = await adapter.fetch();
    expect(items).toHaveLength(0);
  });

  it("adapter id matches config id", async () => {
    const xml = loadFixture("arxiv.xml");
    const adapter = createArxivAdapter(cfg, fakeDeps(fakeHttp(xml)));
    expect(adapter.id).toBe("arxiv-cs-lg");
    expect(adapter.type).toBe("paper");
  });
});
