import type { Item, SourceConfig } from "../types.js";
import type { SourceAdapter, SourceDeps } from "../contracts.js";
import { stableId, normalizeUrl } from "../util/id.js";

interface ScrapeOptions {
  url?: string;
  linkSelectorHint?: string;
}

/** Extract a plain-text snippet near an anchor from a chunk of HTML. */
function extractNearbyText(html: string, matchIndex: number, window = 200): string {
  const start = Math.max(0, matchIndex - window);
  const end = Math.min(html.length, matchIndex + window);
  return html
    .slice(start, end)
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse a base URL to resolve relative hrefs. */
function resolveHref(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function createScrapeAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter {
  const opts = (cfg.options ?? {}) as unknown as ScrapeOptions;
  const pageUrl = opts.url;

  if (!pageUrl) {
    throw new Error(`Scrape adapter "${cfg.id}" requires options.url`);
  }

  return {
    id: cfg.id,
    type: cfg.type,
    async fetch(): Promise<Item[]> {
      let html: string;
      try {
        const res = await deps.http.get(pageUrl);
        if (!res.ok) {
          deps.logger.warn(`scrape: HTTP ${res.status} for ${pageUrl}`);
          return [];
        }
        html = await res.text();
      } catch (err) {
        deps.logger.warn(`scrape: failed to fetch ${pageUrl}: ${String(err)}`);
        return [];
      }

      const items: Item[] = [];
      // Regex to capture anchor tags with href and their inner text
      const anchorRe = /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      const seen = new Set<string>();

      let match: RegExpExecArray | null;
      while ((match = anchorRe.exec(html)) !== null) {
        const rawHref = match[1];
        const innerText = match[2];
        if (!rawHref || !innerText) continue;

        const href = rawHref.trim();
        // Skip anchors, javascript:, mailto:, and empty/fragment-only links
        if (!href || href.startsWith("#") || href.startsWith("javascript:") || href.startsWith("mailto:")) {
          continue;
        }

        const resolvedUrl = resolveHref(pageUrl, href);
        const normalizedUrl = normalizeUrl(resolvedUrl);

        if (seen.has(normalizedUrl)) continue;
        seen.add(normalizedUrl);

        // Extract text from the anchor
        const title = innerText
          .replace(/<[^>]*>/g, " ")
          .replace(/\s+/g, " ")
          .trim();

        if (!title || title.length < 5) continue;

        // Get surrounding snippet for summary
        const matchIndex = match.index ?? 0;
        const snippet = extractNearbyText(html, matchIndex);

        items.push({
          id: stableId(normalizedUrl),
          title,
          url: normalizedUrl,
          source: cfg.id,
          sourceType: cfg.type,
          summary: snippet.length > title.length ? snippet : "",
          published: deps.now().toISOString(),
        });
      }

      return items;
    },
  };
}
