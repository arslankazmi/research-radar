import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHuggingFaceAdapter } from "../../src/sources/huggingface.js";
import { fakeHttp, fakeDeps } from "./helpers.js";
import type { SourceConfig } from "../../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(__dirname, "../fixtures");

function loadFixture(name: string): string {
  return readFileSync(join(fixtureDir, name), "utf-8");
}

const cfg: SourceConfig = {
  id: "hf-trending",
  type: "model",
  adapter: "huggingface",
  options: { sort: "trending", limit: 3 },
};

describe("createHuggingFaceAdapter", () => {
  it("parses 3 models from fixture", async () => {
    const json = loadFixture("huggingface.json");
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    expect(items).toHaveLength(3);
  });

  it("sets sourceType to model", async () => {
    const json = loadFixture("huggingface.json");
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    for (const item of items) {
      expect(item.sourceType).toBe("model");
    }
  });

  it("parses title and url correctly", async () => {
    const json = loadFixture("huggingface.json");
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.title).toBe("mistralai/Mistral-7B-v0.1");
    expect(first.url).toBe("https://huggingface.co/mistralai/Mistral-7B-v0.1");
  });

  it("parses summary from cardData.summary", async () => {
    const json = loadFixture("huggingface.json");
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.summary).toContain("Mistral 7B");
  });

  it("puts stars-equivalent in extra.trendingScore", async () => {
    const json = loadFixture("huggingface.json");
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.extra?.trendingScore).toBe(98.5);
    expect(first.extra?.downloads).toBe(5000000);
    expect(first.extra?.likes).toBe(12000);
  });

  it("parses published as ISO-8601", async () => {
    const json = loadFixture("huggingface.json");
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp(json)));
    const items = await adapter.fetch();

    const first = items[0];
    if (!first) throw new Error("no items");
    expect(first.published).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(first.published).toBe(new Date("2023-09-27T12:00:00.000Z").toISOString());
  });

  it("returns empty array for empty array response", async () => {
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp("[]")));
    const items = await adapter.fetch();
    expect(items).toHaveLength(0);
  });

  it("throws on non-OK HTTP", async () => {
    const adapter = createHuggingFaceAdapter(cfg, fakeDeps(fakeHttp("", { ok: false, status: 429 })));
    await expect(adapter.fetch()).rejects.toThrow("HuggingFace HTTP 429");
  });
});
