import type { Item, SourceConfig } from "../types.js";
import type { SourceAdapter, SourceDeps } from "../contracts.js";
import { stableId } from "../util/id.js";

interface HackerNewsOptions {
  query?: string;
  tags?: string;
  minPoints?: number;
}

interface HNHit {
  objectID?: string;
  title?: string;
  url?: string | null;
  story_url?: string | null;
  points?: number;
  author?: string;
  created_at?: string;
  created_at_i?: number;
  _tags?: string[];
  num_comments?: number;
}

interface HNSearchResponse {
  hits?: HNHit[];
  nbHits?: number;
}

export function createHackerNewsAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter {
  const opts = (cfg.options ?? {}) as HackerNewsOptions;
  const query = opts.query ?? "machine learning";
  const tags = opts.tags ?? "story";
  const minPoints = opts.minPoints ?? 100;

  const encodedQuery = encodeURIComponent(query);
  const encodedFilter = encodeURIComponent(`points>=${minPoints}`);
  const url = `https://hn.algolia.com/api/v1/search_by_date?query=${encodedQuery}&tags=${tags}&numericFilters=${encodedFilter}`;

  return {
    id: cfg.id,
    type: cfg.type,
    async fetch(): Promise<Item[]> {
      const res = await deps.http.get(url);
      if (!res.ok) throw new Error(`HackerNews Algolia HTTP ${res.status}`);
      const data = (await res.json()) as HNSearchResponse;

      const hits = data.hits ?? [];
      const items: Item[] = [];

      for (const hit of hits) {
        const title = (hit.title ?? "").trim();
        if (!title) continue;

        // HN items may link to an external URL or just be HN discussions
        const externalUrl = hit.url ?? hit.story_url;
        const hnUrl = hit.objectID
          ? `https://news.ycombinator.com/item?id=${hit.objectID}`
          : "";
        const itemUrl = externalUrl ?? hnUrl;
        if (!itemUrl) continue;

        const publishedRaw = hit.created_at ?? "";
        const published = publishedRaw
          ? new Date(publishedRaw).toISOString()
          : deps.now().toISOString();

        const tags: string[] = [];
        if (Array.isArray(hit._tags)) {
          for (const t of hit._tags) {
            if (typeof t === "string" && !t.startsWith("author_") && !t.startsWith("story_")) {
              tags.push(t);
            }
          }
        }

        items.push({
          id: stableId(itemUrl),
          title,
          url: itemUrl,
          source: cfg.id,
          sourceType: "post",
          summary: "",
          published,
          authors: hit.author ? [hit.author] : undefined,
          tags: tags.length > 0 ? tags : undefined,
          extra: {
            points: hit.points ?? 0,
            numComments: hit.num_comments ?? 0,
            hnUrl,
          },
        });
      }
      return items;
    },
  };
}
