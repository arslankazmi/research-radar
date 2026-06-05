import type { Item, SourceConfig } from "../types.js";
import type { SourceAdapter, SourceDeps, Logger } from "../contracts.js";
import { createArxivAdapter } from "./arxiv.js";
import { createHuggingFaceAdapter } from "./huggingface.js";
import { createGithubTrendingAdapter } from "./github-trending.js";
import { createHackerNewsAdapter } from "./hackernews.js";
import { createRssAdapter } from "./rss.js";
import { createScrapeAdapter } from "./scrape.js";

/**
 * Build a single SourceAdapter from a SourceConfig.
 * Throws if the adapter kind is unknown.
 */
export function createAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter {
  switch (cfg.adapter) {
    case "arxiv":
      return createArxivAdapter(cfg, deps);
    case "huggingface":
      return createHuggingFaceAdapter(cfg, deps);
    case "github-trending":
      return createGithubTrendingAdapter(cfg, deps);
    case "hackernews":
      return createHackerNewsAdapter(cfg, deps);
    case "rss":
      return createRssAdapter(cfg, deps);
    case "scrape":
      return createScrapeAdapter(cfg, deps);
    default: {
      const _exhaustive: never = cfg.adapter;
      throw new Error(`Unknown adapter kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Build all enabled adapters from a list of configs.
 * Configs with `enabled === false` are skipped.
 */
export function buildAdapters(configs: SourceConfig[], deps: SourceDeps): SourceAdapter[] {
  const adapters: SourceAdapter[] = [];
  for (const cfg of configs) {
    if (cfg.enabled === false) continue;
    try {
      adapters.push(createAdapter(cfg, deps));
    } catch (err) {
      deps.logger.warn(`Failed to create adapter "${cfg.id}": ${String(err)}`);
    }
  }
  return adapters;
}

/**
 * Run all adapters in parallel.
 * A rejected adapter logs a warning and contributes [] (per-source failure isolation).
 * Returns the flattened array of all successfully fetched items.
 */
export async function fetchAll(adapters: SourceAdapter[], logger: Logger): Promise<Item[]> {
  const results = await Promise.allSettled(adapters.map((a) => a.fetch()));

  const items: Item[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const adapter = adapters[i];
    if (!result || !adapter) continue;

    if (result.status === "fulfilled") {
      for (const item of result.value) {
        items.push(item);
      }
    } else {
      logger.warn(
        `Source "${adapter.id}" failed: ${String((result as PromiseRejectedResult).reason)}`,
      );
    }
  }
  return items;
}
