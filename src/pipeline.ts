/**
 * The core pipeline: purely injectable, no I/O except through injected ports.
 * buildAdapters → fetchAll → dedupe → scoreItems → compose
 */
import type { RadarConfig, InterestProfile, Digest } from "./types.js";
import type { HttpClient, Llm, Logger } from "./contracts.js";
import { buildAdapters, fetchAll } from "./sources/registry.js";
import { dedupe } from "./judge/dedup.js";
import { scoreItems } from "./judge/judge.js";
import { compose } from "./digest/compose.js";

export interface RunRadarDeps {
  config: RadarConfig;
  profile: InterestProfile;
  http: HttpClient;
  llm?: Llm;
  logger: Logger;
  now: () => Date;
}

/**
 * Run the full research radar pipeline.
 * Pure: no hidden globals, all I/O through injected deps.
 */
export async function runRadar(deps: RunRadarDeps): Promise<Digest> {
  const { config, profile, http, llm, logger, now } = deps;

  // Build adapters from config
  const sourceDeps = { http, logger, now };
  const adapters = buildAdapters(config.sources, sourceDeps);

  // Fetch all items (per-source failure isolated in fetchAll)
  const raw = await fetchAll(adapters, logger);
  logger.info(`Fetched ${raw.length} raw items from ${adapters.length} source(s)`);

  // Deduplicate
  const deduped = dedupe(raw);
  logger.info(`After dedup: ${deduped.length} items`);

  // Score items against profile
  const maxItemsToScore = config.judge?.maxItemsToScore;
  const scored = await scoreItems(deduped, profile, { llm, logger, maxItemsToScore });
  logger.info(`Scored ${scored.length} items`);

  // Apply config overrides for minScore/topN
  const effectiveProfile: InterestProfile = {
    ...profile,
    minScore: config.judge?.minScore ?? profile.minScore,
    topN: config.judge?.topN ?? profile.topN,
  };

  // Compose digest
  const date = now().toISOString().slice(0, 10);
  const digest = compose(scored, effectiveProfile, {
    date,
    consideredCount: deduped.length,
  });

  logger.info(`Digest composed: ${digest.items.length} items across ${digest.groups.length} group(s)`);
  return digest;
}
