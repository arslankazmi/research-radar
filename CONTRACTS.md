# Build Contract — research-radar

This file is the source of truth for module boundaries so three engineers can build in
parallel without conflicts. **Do not change shared files** (`src/types.ts`, `src/contracts.ts`,
`src/util/id.ts`, `src/util/console-logger.ts`, `package.json`, `tsconfig.json`). Import from
them. Use **ESM imports with `.js` extensions** (NodeNext): `import { Item } from "../types.js"`.

TypeScript is strict with `noUncheckedIndexedAccess` and `verbatimModuleSyntax` — use
`import type { ... }` for type-only imports, and guard array indexing.

Every unit is dependency-injected (see `src/contracts.ts`). No module reads globals directly
except the node-backed adapters of ports (HttpClient/KvStore), which live in `src/runtime/`.

---

## Cluster A — Sources (`src/sources/`)

Implements one `SourceAdapter` per `AdapterKind`, plus a registry that builds adapters from config.

- `src/sources/arxiv.ts` → `createArxivAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter`
  - arXiv Atom API: `http://export.arxiv.org/api/query?search_query=cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=N`
  - options: `{ categories: string[]; maxResults?: number }`. Parse Atom with `fast-xml-parser`.
- `src/sources/huggingface.ts` → `createHuggingFaceAdapter(cfg, deps)`
  - HF Models API: `https://huggingface.co/api/models?sort=trendingScore&limit=N&full=false` (JSON).
  - options: `{ sort?: "trending"|"createdAt"; limit?: number }`. `sourceType: "model"`.
- `src/sources/github-trending.ts` → `createGithubTrendingAdapter(cfg, deps)`
  - Use the GitHub search API (no scraping): `https://api.github.com/search/repositories?q=topic:machine-learning+pushed:>=YYYY-MM-DD&sort=stars&order=desc` (JSON). `sourceType: "repo"`, put stars in `extra.stars`.
  - options: `{ since?: "daily"|"weekly"; language?: string; topic?: string }`.
- `src/sources/hackernews.ts` → `createHackerNewsAdapter(cfg, deps)`
  - Algolia API: `https://hn.algolia.com/api/v1/search_by_date?query=...&tags=story&numericFilters=points>=N` (JSON). `sourceType: "post"`.
- `src/sources/rss.ts` → `createRssAdapter(cfg, deps)`
  - Generic RSS/Atom. options: `{ url: string }`. Used for gwern.net, Anthropic, Google Research, Karpathy, gwtaylor.ca, blogs. Parse both RSS `<item>` and Atom `<entry>` with `fast-xml-parser`. `sourceType: "post"` (or `cfg.type`).
- `src/sources/scrape.ts` → `createScrapeAdapter(cfg, deps)`
  - Fallback for sites with no feed. options: `{ url: string }`. Fetch HTML via `deps.http`, extract `<a href>` links + nearby text with a SMALL dependency-free heuristic (regex over anchors), return as items. Best-effort; never throw on empty.
- `src/sources/registry.ts` →
  - `createAdapter(cfg: SourceConfig, deps: SourceDeps): SourceAdapter` (switch on `cfg.adapter`)
  - `buildAdapters(configs: SourceConfig[], deps: SourceDeps): SourceAdapter[]` (skips `enabled === false`)
  - `fetchAll(adapters: SourceAdapter[], logger: Logger): Promise<Item[]>` — runs adapters in
    parallel with `Promise.allSettled`; a rejected adapter logs a warning and contributes `[]`
    (per-source failure isolation). Returns the flattened items.

All items: set `id = stableId(url)` from `src/util/id.js`, ISO `published`, fill `summary` (may be "").

**Tests** (`test/sources/*.test.ts`): for each adapter, feed a recorded fixture
(`test/fixtures/<name>.{xml,json,html}`) through a fake `HttpClient` and assert the normalized
items (count, titles, urls, sourceType, published parsed). Test `fetchAll` isolation: one adapter
throws → others still return.

---

## Cluster B — Intelligence (`src/profile/`, `src/judge/`, `src/feedback/`, `src/eval/`)

- `src/profile/profile.ts`
  - `defaultProfile(): InterestProfile` (sensible ML defaults, minScore 6, topN 12, empty exemplars).
  - `loadProfile(store: KvStore, key?: string): Promise<InterestProfile>` (returns default if absent).
  - `saveProfile(store: KvStore, p: InterestProfile, key?: string): Promise<void>`.
  - `addInterest(p, text): InterestProfile`, `removeInterest(p, text): InterestProfile`,
    `muteTopic(p, topic): InterestProfile` (pure, return new profile).
- `src/judge/judge.ts`
  - `scoreItems(items: Item[], profile: InterestProfile, deps: { llm?: Llm; logger: Logger; maxItemsToScore?: number }): Promise<ScoredItem[]>`
  - With `llm`: build a single batched prompt (few-shot from `profile.exemplars`, the interest
    text, and the candidate list) asking for a JSON array `[{id, score, reason}]`, 0..10. Parse
    robustly. `scorer:"llm"`. Drop/score 0 anything matching `mutedTopics`.
  - Without `llm` (or on parse/LLM failure): fall back to `keywordScore` and set `scorer:"keyword"`.
  - `keywordScore(item, profile): { score: number; reason: string }` — exported, pure: overlap of
    `profile.keywords` + interest tokens against title+summary, normalized to 0..10.
- `src/judge/dedup.ts`
  - `dedupe(items: Item[]): Item[]` — by `id` first, then near-duplicate title (normalized,
    Jaccard/688 token overlap ≥ 0.9). Keep the earliest/most-complete. Pure.
- `src/feedback/feedback.ts`
  - `applyReaction(profile, item: { title: string; summary?: string }, reaction: "up"|"down"|"mute", now: () => Date): InterestProfile`
    — appends an `Exemplar` (cap to last 50) and, for "mute", adds a muted topic. Pure.
  - `parseReaction(text: string): "up"|"down"|"mute"|undefined` — maps 👍/👎/"more like"/"mute" etc.
- `src/eval/precision.ts`
  - `precisionAtK(ranked: ScoredItem[], relevantIds: Set<string>, k: number): number`
  - `runGoldenEval(scored: ScoredItem[], labels: { id: string; relevant: boolean }[], ks?: number[]): { [k: string]: number }`
  - This is the self-eval / portfolio metric. Pure + tested.

**Tests** (`test/intelligence/*.test.ts`): keywordScore ranking sanity; muted topics suppressed;
dedup collapses near-dupes; feedback appends + caps + mutes; precisionAtK correct on a hand
example; judge with a FAKE `Llm` returning canned JSON → parses to ScoredItem[]; judge with no llm
→ keyword fallback.

---

## Cluster C — Assembly (`src/pipeline.ts`, `src/digest/`, `src/runtime/`, `src/cli.ts`, `src/plugin/`, `src/index.ts`, `openclaw.plugin.json`)

Depends on A + B by import path (signatures above are fixed — code to them).

- `src/digest/compose.ts`
  - `compose(scored: ScoredItem[], profile: InterestProfile, opts: { date: string; consideredCount: number }): Digest`
    — threshold by `minScore`, sort desc by score, take `topN`, group by `sourceType`.
  - `renderMarkdown(d: Digest): string` — numbered chat message (the `#N` refs the conversational
    commands use), grouped with emoji headers, each line: `#N **title** — one-line why · source · link`.
  - `renderCanvasCard(d: Digest): object` — a simple structured object for OpenClaw's Canvas
    (title + sections + items). Shape documented inline; keep it plain JSON.
- `src/pipeline.ts` — the heart, pure + injectable:
  - `runRadar(deps: { config: RadarConfig; profile: InterestProfile; http: HttpClient; llm?: Llm; logger: Logger; now: () => Date }): Promise<Digest>`
    — buildAdapters → fetchAll → dedupe → scoreItems → compose. No I/O beyond injected ports.
- `src/runtime/node-http.ts` → `nodeHttp(): HttpClient` (global `fetch`, sets a UA header).
- `src/runtime/fs-kv.ts` → `fsKv(dir: string): KvStore` (JSON files under dir; mkdir -p).
- `src/cli.ts` — `#!/usr/bin/env -S npx tsx` shebang. Flags: `--dry-run` (use fixtures, no network
  if `--offline`), `--config <path>`, `--profile <path>`. Loads config (or a bundled default at
  `src/config.default.ts`), runs `runRadar` with `nodeHttp` + console logger + NO llm (keyword) by
  default, or an llm if `OPENAI_API_KEY`/etc. present (optional `src/runtime/openai-llm.ts`),
  prints `renderMarkdown`. This is the primary verification surface.
- `src/config.default.ts` → `defaultConfig(): RadarConfig` — includes ALL requested sources:
  arXiv (cs.LG, cs.CL, cs.CV), HF trending, GitHub trending ML, HN (points>=100), and RSS adapters
  for gwern.net, Anthropic research, Google research, Andrej Karpathy, Graham Taylor (gwtaylor.ca),
  with a `scrape` fallback example. Use real feed URLs where known; mark guesses with a comment.
- `src/plugin/sdk.d.ts` — dev-only ambient type shim for the OpenClaw plugin API. Read
  `docs/OPENCLAW_PLUGIN_SDK.md` and declare ONLY the surface we use: the plugin entry/registration
  shape, `api.registerTool`, `api.registerCommand`, `api.registerHook`, `api.runtime.llm.complete`,
  `api.session.workflow.scheduleSessionTurn`, `api.logger`. Add a top comment: "Dev-only shim;
  clawhub bundles the real @openclaw/plugin-sdk at publish time."
- `src/plugin/index.ts` + `src/index.ts` (re-export entry) — the real OpenClaw entry. Follow the
  exact registration shape from `docs/OPENCLAW_PLUGIN_SDK.md`. Wire:
  - tools: `radar_run` (runs pipeline, returns `renderMarkdown` as tool content + Canvas card),
    `radar_summarize {n}`, `radar_more_like {n}`, `radar_explain {n}` ("why #N"),
    `radar_add_interest {text}`, `radar_mute {topic}`, `radar_sources`.
  - command: `/radar` (alias for radar_run, or subcommands).
  - hook: `message_received` → `parseReaction` → `applyReaction` → `saveProfile` (the feedback loop).
  - cron: on activation, attempt `api.session.workflow.scheduleSessionTurn(...)` from `config.delivery`;
    if unavailable (external/bundled-only), log guidance to schedule via the built-in `cron` tool.
  - Adapt `api.runtime.llm` → our `Llm` port; `api.logger` → `Logger`; `fsKv(workspaceDir)` → KvStore.
  - Keep this file THIN — all logic delegates to pipeline/judge/feedback/profile.
- `openclaw.plugin.json` — declare the tool contracts per `docs/OPENCLAW_PLUGIN_SDK.md`.

**Tests** (`test/assembly/*.test.ts`): `compose` thresholds + groups + topN; `renderMarkdown`
numbering stable and `#N` resolvable; `runRadar` end-to-end with FAKE http (fixtures) + FAKE llm
→ produces a Digest with expected ordering; pipeline isolates a failing source.

---

## Definition of done (all clusters)
- `pnpm typecheck` clean. `pnpm test` green. No `any` leaks, no unused exports.
- Adapters never crash the run on a single-source failure.
- `pnpm dry-run` prints a sensible digest from fixtures.
