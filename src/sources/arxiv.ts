import type { Item, SourceConfig, SourceType } from "../types.js";
import type { SourceAdapter, SourceDeps } from "../contracts.js";
import { stableId } from "../util/id.js";
import { XMLParser } from "fast-xml-parser";

/** Coerce a value to an array — fast-xml-parser returns a single object for lone elements. */
function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

/** Strip HTML/XML tags and decode basic entities to produce plain text. */
function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

interface ArxivOptions {
  categories?: string[];
  maxResults?: number;
}

export function createArxivAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter {
  const opts = (cfg.options ?? {}) as ArxivOptions;
  const categories = opts.categories ?? ["cs.LG"];
  const maxResults = opts.maxResults ?? 20;

  const query = categories.map((c) => `cat:${c}`).join("+OR+");
  const url = `http://export.arxiv.org/api/query?search_query=${query}&sortBy=submittedDate&sortOrder=descending&max_results=${maxResults}`;

  return {
    id: cfg.id,
    type: cfg.type as SourceType,
    async fetch(): Promise<Item[]> {
      const res = await deps.http.get(url);
      if (!res.ok) throw new Error(`arXiv HTTP ${res.status}`);
      const xml = await res.text();

      const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
      const doc = parser.parse(xml) as Record<string, unknown>;

      const feed = doc["feed"] as Record<string, unknown> | undefined;
      if (!feed) return [];

      const entries = toArray(feed["entry"] as Record<string, unknown> | Record<string, unknown>[] | undefined);

      const items: Item[] = [];
      for (const entry of entries) {
        const title = stripHtml(String(entry["title"] ?? ""))
          .replace(/\n/g, " ")
          .trim();
        if (!title) continue;

        // arXiv id link — prefer the HTML alternate link
        const idLinks = toArray(
          entry["link"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
        );
        const htmlLink = idLinks.find(
          (l) => l["@_type"] === "text/html" || l["@_rel"] === "alternate",
        );
        const rawLink = htmlLink
          ? String(htmlLink["@_href"] ?? "")
          : String(entry["id"] ?? "");
        const itemUrl = rawLink.trim() || `https://arxiv.org/abs/unknown`;

        const summary = stripHtml(String(entry["summary"] ?? ""));

        const publishedRaw = String(entry["published"] ?? entry["updated"] ?? "");
        const published = publishedRaw
          ? new Date(publishedRaw).toISOString()
          : deps.now().toISOString();

        const authorRaw = toArray(
          entry["author"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
        );
        const authors = authorRaw
          .map((a) => String(a["name"] ?? "").trim())
          .filter(Boolean);

        const catRaw = toArray(
          entry["category"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
        );
        const tags = catRaw
          .map((c) => String(c["@_term"] ?? "").trim())
          .filter(Boolean);

        items.push({
          id: stableId(itemUrl),
          title,
          url: itemUrl,
          source: cfg.id,
          sourceType: cfg.type,
          summary,
          published,
          authors: authors.length > 0 ? authors : undefined,
          tags: tags.length > 0 ? tags : undefined,
        });
      }
      return items;
    },
  };
}
