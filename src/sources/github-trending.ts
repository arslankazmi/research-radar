import type { Item, SourceConfig } from "../types.js";
import type { SourceAdapter, SourceDeps } from "../contracts.js";
import { stableId } from "../util/id.js";

interface GithubTrendingOptions {
  since?: "daily" | "weekly";
  language?: string;
  topic?: string;
}

interface GithubRepo {
  id?: number;
  name?: string;
  full_name?: string;
  html_url?: string;
  description?: string | null;
  stargazers_count?: number;
  language?: string | null;
  topics?: string[];
  created_at?: string;
  pushed_at?: string;
  owner?: { login?: string };
}

interface GithubSearchResponse {
  items?: GithubRepo[];
  total_count?: number;
}

export function createGithubTrendingAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter {
  const opts = (cfg.options ?? {}) as GithubTrendingOptions;
  const since = opts.since ?? "daily";
  const language = opts.language;
  const topic = opts.topic ?? "machine-learning";

  return {
    id: cfg.id,
    type: cfg.type,
    async fetch(): Promise<Item[]> {
      const now = deps.now();
      const daysBack = since === "weekly" ? 7 : 1;
      const cutoff = new Date(now.getTime() - daysBack * 24 * 60 * 60 * 1000);
      const dateStr = cutoff.toISOString().slice(0, 10);

      let q = `topic:${topic}+pushed:>=${dateStr}`;
      if (language) q += `+language:${encodeURIComponent(language)}`;

      const url = `https://api.github.com/search/repositories?q=${q}&sort=stars&order=desc&per_page=30`;

      const res = await deps.http.get(url, {
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (!res.ok) throw new Error(`GitHub search HTTP ${res.status}`);
      const data = (await res.json()) as GithubSearchResponse;

      const repos = data.items ?? [];
      const items: Item[] = [];

      for (const repo of repos) {
        const full_name = repo.full_name ?? repo.name;
        if (!full_name) continue;

        const itemUrl = repo.html_url ?? `https://github.com/${full_name}`;
        const title = full_name;
        const summary = repo.description ?? "";

        const publishedRaw = repo.pushed_at ?? repo.created_at ?? "";
        const published = publishedRaw
          ? new Date(publishedRaw).toISOString()
          : deps.now().toISOString();

        const tags: string[] = [];
        if (Array.isArray(repo.topics)) {
          for (const t of repo.topics) {
            if (typeof t === "string") tags.push(t);
          }
        }
        if (repo.language) tags.push(repo.language);

        items.push({
          id: stableId(itemUrl),
          title,
          url: itemUrl,
          source: cfg.id,
          sourceType: "repo",
          summary,
          published,
          tags: tags.length > 0 ? tags : undefined,
          extra: {
            stars: repo.stargazers_count ?? 0,
          },
        });
      }
      return items;
    },
  };
}
