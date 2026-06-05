import type { Item, SourceConfig } from "../types.js";
import type { SourceAdapter, SourceDeps } from "../contracts.js";
import { stableId } from "../util/id.js";
import { XMLParser } from "fast-xml-parser";

/** Coerce a value to an array — fast-xml-parser returns a single object for lone elements. */
function toArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function stripHtml(s: string): string {
  return s
    .replace(/<!\[CDATA\[/g, "")
    .replace(/\]\]>/g, "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Safely get a string from a value that might be an object with #text, or a string. */
function getText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj["#text"] === "string") return obj["#text"];
  }
  return String(v);
}

/** Get href from an Atom <link> element — can be an object with @_href or a plain string. */
function getLinkHref(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    const obj = v as Record<string, unknown>;
    if (typeof obj["@_href"] === "string") return obj["@_href"];
    if (typeof obj["#text"] === "string") return obj["#text"];
  }
  return "";
}

interface RssOptions {
  url?: string;
}

export function createRssAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter {
  const opts = (cfg.options ?? {}) as unknown as RssOptions;
  const feedUrl = opts.url;

  if (!feedUrl) {
    throw new Error(`RSS adapter "${cfg.id}" requires options.url`);
  }

  return {
    id: cfg.id,
    type: cfg.type,
    async fetch(): Promise<Item[]> {
      const res = await deps.http.get(feedUrl);
      if (!res.ok) throw new Error(`RSS fetch HTTP ${res.status} for ${feedUrl}`);
      const xml = await res.text();

      const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        cdataPropName: "__cdata",
        // Parse text nodes as strings even when attributes present
        textNodeName: "#text",
      });
      const doc = parser.parse(xml) as Record<string, unknown>;

      const items: Item[] = [];

      // --- RSS 2.0: doc.rss.channel.item ---
      const rssRoot = doc["rss"] as Record<string, unknown> | undefined;
      if (rssRoot) {
        const channel = rssRoot["channel"] as Record<string, unknown> | undefined;
        if (channel) {
          const rawItems = toArray(
            channel["item"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
          );
          for (const it of rawItems) {
            const title = stripHtml(getText(it["title"]));
            if (!title) continue;

            const linkRaw = it["link"];
            const itemUrl = getLinkHref(linkRaw) || getText(linkRaw);
            if (!itemUrl) continue;

            const summary = stripHtml(
              getText(it["description"] ?? it["content:encoded"] ?? ""),
            );

            const pubDateRaw = getText(it["pubDate"] ?? it["dc:date"] ?? "");
            const published = pubDateRaw
              ? new Date(pubDateRaw).toISOString()
              : deps.now().toISOString();

            const authorRaw = getText(it["author"] ?? it["dc:creator"] ?? "");
            const authors = authorRaw ? [authorRaw] : undefined;

            const categoryRaw = toArray(
              it["category"] as string | string[] | undefined,
            );
            const tags = categoryRaw.map((c) => getText(c)).filter(Boolean);

            items.push({
              id: stableId(itemUrl),
              title,
              url: itemUrl,
              source: cfg.id,
              sourceType: cfg.type,
              summary,
              published,
              authors,
              tags: tags.length > 0 ? tags : undefined,
            });
          }
        }
        return items;
      }

      // --- Atom: doc.feed.entry ---
      const atomFeed = doc["feed"] as Record<string, unknown> | undefined;
      if (atomFeed) {
        const entries = toArray(
          atomFeed["entry"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
        );
        for (const entry of entries) {
          const title = stripHtml(getText(entry["title"]));
          if (!title) continue;

          // Atom link can be an object with @_href or array of link objects
          const linkVal = entry["link"];
          let itemUrl = "";
          if (Array.isArray(linkVal)) {
            const altLink = (linkVal as Record<string, unknown>[]).find(
              (l) => l["@_rel"] === "alternate" || !l["@_rel"],
            );
            itemUrl = getLinkHref(altLink);
          } else {
            itemUrl = getLinkHref(linkVal);
          }
          if (!itemUrl) continue;

          const summary = stripHtml(
            getText(entry["summary"] ?? entry["content"] ?? ""),
          );

          const publishedRaw = getText(entry["published"] ?? entry["updated"] ?? "");
          const published = publishedRaw
            ? new Date(publishedRaw).toISOString()
            : deps.now().toISOString();

          const authorRaw = toArray(
            entry["author"] as Record<string, unknown> | Record<string, unknown>[] | undefined,
          );
          const authors = authorRaw.map((a) => getText(a["name"])).filter(Boolean);

          items.push({
            id: stableId(itemUrl),
            title,
            url: itemUrl,
            source: cfg.id,
            sourceType: cfg.type,
            summary,
            published,
            authors: authors.length > 0 ? authors : undefined,
          });
        }
        return items;
      }

      // Neither RSS nor Atom recognized — return empty
      return items;
    },
  };
}
