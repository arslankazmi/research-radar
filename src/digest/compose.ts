import type { ScoredItem, InterestProfile, Digest, DigestGroup, SourceType } from "../types.js";

const GROUP_EMOJI: Record<SourceType, string> = {
  paper: "📄",
  model: "🤖",
  repo: "💻",
  post: "📝",
};

const GROUP_LABEL: Record<SourceType, string> = {
  paper: "Papers",
  model: "Models",
  repo: "Repos",
  post: "Posts",
};

/** Build a digest: threshold by minScore, sort desc, take topN, group by sourceType. */
export function compose(
  scored: ScoredItem[],
  profile: InterestProfile,
  opts: { date: string; consideredCount: number },
): Digest {
  const minScore = profile.minScore;
  const topN = profile.topN;

  const filtered = scored
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);

  // Group by sourceType preserving order of first appearance
  const groupMap = new Map<SourceType, ScoredItem[]>();
  for (const item of filtered) {
    const existing = groupMap.get(item.sourceType);
    if (existing) {
      existing.push(item);
    } else {
      groupMap.set(item.sourceType, [item]);
    }
  }

  const groups: DigestGroup[] = [];
  for (const [type, items] of groupMap) {
    groups.push({
      type,
      label: `${GROUP_EMOJI[type] ?? "🔗"} ${GROUP_LABEL[type] ?? type}`,
      items,
    });
  }

  return {
    date: opts.date,
    items: filtered,
    groups,
    consideredCount: opts.consideredCount,
  };
}

/**
 * Render a digest as a numbered markdown chat message.
 * Each #N references digest.items[N-1] (1-indexed).
 * Items are grouped with emoji headers.
 */
export function renderMarkdown(d: Digest): string {
  if (d.items.length === 0) {
    return `## Research Radar — ${d.date}\n\n_No items matched your interests today. ${d.consideredCount} items considered._`;
  }

  // Build a global index map: item.id → 1-based position in d.items
  const indexMap = new Map<string, number>();
  d.items.forEach((item, i) => {
    indexMap.set(item.id, i + 1);
  });

  const lines: string[] = [];
  lines.push(`## Research Radar — ${d.date}`);
  lines.push(`_${d.consideredCount} items considered, ${d.items.length} selected_`);
  lines.push("");

  for (const group of d.groups) {
    lines.push(`### ${group.label}`);
    lines.push("");
    for (const item of group.items) {
      const n = indexMap.get(item.id) ?? 0;
      // Format: #N **title** — reason · source · [link](url)
      lines.push(`**#${n}** **${item.title}** — ${item.reason} · _${item.source}_ · [link](${item.url})`);
    }
    lines.push("");
  }

  lines.push("---");
  lines.push("_React with 👍/👎 on any #N, or say `more like #N`, `mute <topic>`, `/radar` to refresh._");

  return lines.join("\n");
}

/**
 * Render a digest as a plain JSON object for OpenClaw's Canvas panel.
 * Shape: { title, date, consideredCount, sections: [{ label, items: [{ n, title, score, reason, source, url }] }] }
 */
export function renderCanvasCard(d: Digest): object {
  // Build global index
  const indexMap = new Map<string, number>();
  d.items.forEach((item, i) => {
    indexMap.set(item.id, i + 1);
  });

  const sections = d.groups.map((group) => ({
    label: group.label,
    items: group.items.map((item) => ({
      n: indexMap.get(item.id) ?? 0,
      title: item.title,
      score: item.score,
      reason: item.reason,
      source: item.source,
      url: item.url,
      scorer: item.scorer,
    })),
  }));

  return {
    title: "Research Radar",
    date: d.date,
    consideredCount: d.consideredCount,
    totalItems: d.items.length,
    sections,
  };
}
