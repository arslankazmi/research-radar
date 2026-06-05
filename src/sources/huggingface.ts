import type { Item, SourceConfig } from "../types.js";
import type { SourceAdapter, SourceDeps } from "../contracts.js";
import { stableId } from "../util/id.js";

interface HuggingFaceOptions {
  sort?: "trending" | "createdAt";
  limit?: number;
}

interface HFModel {
  id?: string;
  modelId?: string;
  cardData?: { summary?: string; description?: string };
  description?: string;
  createdAt?: string;
  lastModified?: string;
  downloads?: number;
  likes?: number;
  trendingScore?: number;
  tags?: string[];
  pipeline_tag?: string;
}

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

export function createHuggingFaceAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter {
  const opts = (cfg.options ?? {}) as HuggingFaceOptions;
  const sort = opts.sort ?? "trending";
  const limit = opts.limit ?? 20;

  const sortParam = sort === "trending" ? "trendingScore" : "createdAt";
  const url = `https://huggingface.co/api/models?sort=${sortParam}&limit=${limit}&full=false`;

  return {
    id: cfg.id,
    type: cfg.type,
    async fetch(): Promise<Item[]> {
      const res = await deps.http.get(url, {
        headers: { "Accept": "application/json" },
      });
      if (!res.ok) throw new Error(`HuggingFace HTTP ${res.status}`);
      const data = (await res.json()) as unknown;

      if (!Array.isArray(data)) return [];

      const items: Item[] = [];
      for (const model of data as HFModel[]) {
        const modelId = model.modelId ?? model.id;
        if (!modelId) continue;

        const itemUrl = `https://huggingface.co/${modelId}`;
        const title = modelId;

        const rawSummary =
          model.cardData?.summary ??
          model.cardData?.description ??
          model.description ??
          "";
        const summary = stripHtml(rawSummary);

        const publishedRaw = model.createdAt ?? model.lastModified ?? "";
        const published = publishedRaw
          ? new Date(publishedRaw).toISOString()
          : deps.now().toISOString();

        const tags: string[] = [];
        if (Array.isArray(model.tags)) {
          for (const t of model.tags) {
            if (typeof t === "string") tags.push(t);
          }
        }
        if (model.pipeline_tag) tags.push(model.pipeline_tag);

        items.push({
          id: stableId(itemUrl),
          title,
          url: itemUrl,
          source: cfg.id,
          sourceType: "model",
          summary,
          published,
          tags: tags.length > 0 ? tags : undefined,
          extra: {
            downloads: model.downloads,
            likes: model.likes,
            trendingScore: model.trendingScore,
          },
        });
      }
      return items;
    },
  };
}
