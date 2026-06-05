import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createRssAdapter } from "../../src/sources/rss.js";
import { fakeHttp, fakeDeps } from "./helpers.js";
import type { SourceConfig } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

const rssCfg: SourceConfig = {
  id: "karpathy-blog",
  type: "post",
  adapter: "rss",
  options: { url: "https://karpathy.github.io/feed.xml" },
};

const atomCfg: SourceConfig = {
  id: "anthropic-research",
  type: "post",
  adapter: "rss",
  options: { url: "https://www.anthropic.com/research.atom" },
};

describe("createRssAdapter — RSS 2.0", () => {
  it("parses 3 items from RSS fixture", async () => {
    const xml = loadFixture("rss.xml");
    const adapter = createRssAdapter(rssCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    expect(items).toHaveLength(3);
  });

  it("sets sourceType to post", async () => {
    const xml = loadFixture("rss.xml");
    const adapter = createRssAdapter(rssCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.sourceType).toBe("post");
    }
  });

  it("parses title and url correctly", async () => {
    const xml = loadFixture("rss.xml");
    const adapter = createRssAdapter(rssCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.title).toBe("The Unreasonable Effectiveness of Recurrent Neural Networks");
    expect(first.url).toBe("https://karpathy.github.io/2015/05/21/rnn-effectiveness/");
  });

  it("parses summary from description", async () => {
    const xml = loadFixture("rss.xml");
    const adapter = createRssAdapter(rssCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.summary).toContain("magical");
  });

  it("parses published as ISO-8601", async () => {
    const xml = loadFixture("rss.xml");
    const adapter = createRssAdapter(rssCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("sets author from dc:creator", async () => {
    const xml = loadFixture("rss.xml");
    const adapter = createRssAdapter(rssCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.authors).toEqual(["Andrej Karpathy"]);
  });

  it("has unique ids", async () => {
    const xml = loadFixture("rss.xml");
    const adapter = createRssAdapter(rssCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const ids = items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("createRssAdapter — Atom", () => {
  it("parses 3 entries from Atom fixture", async () => {
    const xml = loadFixture("atom.xml");
    const adapter = createRssAdapter(atomCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    expect(items).toHaveLength(3);
  });

  it("sets sourceType to post", async () => {
    const xml = loadFixture("atom.xml");
    const adapter = createRssAdapter(atomCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.sourceType).toBe("post");
    }
  });

  it("parses title and url correctly from Atom", async () => {
    const xml = loadFixture("atom.xml");
    const adapter = createRssAdapter(atomCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.title).toBe("Constitutional AI: Harmlessness from AI Feedback");
    expect(first.url).toBe(
      "https://www.anthropic.com/research/constitutional-ai-harmlessness-from-ai-feedback",
    );
  });

  it("parses summary from Atom summary element", async () => {
    const xml = loadFixture("atom.xml");
    const adapter = createRssAdapter(atomCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.summary).toContain("harmless");
  });

  it("parses published as ISO-8601", async () => {
    const xml = loadFixture("atom.xml");
    const adapter = createRssAdapter(atomCfg, fakeDeps(fakeHttp(xml)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.published).toBe(new Date("2022-12-15T00:00:00Z").toISOString());
  });

  it("throws on missing url option", () => {
    expect(() =>
      createRssAdapter(
        { id: "bad", type: "post", adapter: "rss", options: {} },
        fakeDeps(fakeHttp("")),
      ),
    ).toThrow(/requires options\.url/);
  });

  it("throws on non-OK HTTP", async () => {
    const adapter = createRssAdapter(atomCfg, fakeDeps(fakeHttp("", { ok: false, status: 404 })));
    await expect(adapter.fetch()).rejects.toThrow("RSS fetch HTTP 404");
  });
});
