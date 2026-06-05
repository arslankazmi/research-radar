#!/usr/bin/env -S npx tsx
/**
 * research-radar CLI
 * Usage:
 *   npx tsx src/cli.ts [--dry-run] [--offline] [--config <path>] [--profile <path>]
 *
 * Flags:
 *   --dry-run       Run against bundled offline fixtures; do not call live sources.
 *   --offline       Combined with --dry-run: no network; use offline-http stub.
 *   --config <path> Path to a JSON RadarConfig file (default: built-in defaultConfig).
 *   --profile <path> Path to a JSON InterestProfile file (default: built-in defaultProfile).
 */

import { readFile } from "node:fs/promises";
import type { RadarConfig, InterestProfile } from "./types.js";
import { defaultConfig } from "./config.default.js";
import { defaultProfile } from "./profile/profile.js";
import { consoleLogger } from "./util/console-logger.js";
import { runRadar } from "./pipeline.js";
import { renderMarkdown } from "./digest/compose.js";
import { nodeHttp } from "./runtime/node-http.js";
import { offlineHttp } from "./runtime/offline-http.js";
import { openaiLlm } from "./runtime/openai-llm.js";
import type { Llm } from "./contracts.js";

function parseArgs(argv: string[]): {
  dryRun: boolean;
  offline: boolean;
  configPath?: string;
  profilePath?: string;
} {
  const args = argv.slice(2);
  let dryRun = false;
  let offline = false;
  let configPath: string | undefined;
  let profilePath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--offline") {
      offline = true;
    } else if (arg === "--config") {
      configPath = args[++i];
    } else if (arg === "--profile") {
      profilePath = args[++i];
    }
  }

  return { dryRun, offline, configPath, profilePath };
}

async function loadJson<T>(path: string): Promise<T> {
  const contents = await readFile(path, "utf-8");
  return JSON.parse(contents) as T;
}

async function main(): Promise<void> {
  const { dryRun, offline, configPath, profilePath } = parseArgs(process.argv);

  const logger = consoleLogger;

  // Load config
  let config: RadarConfig;
  if (configPath) {
    config = await loadJson<RadarConfig>(configPath);
  } else {
    config = defaultConfig();
  }

  // In dry-run mode, limit to a few sources so the run is fast
  if (dryRun) {
    // Keep only a representative subset of sources for the dry run
    config = {
      ...config,
      sources: config.sources.filter(
        (s) =>
          s.enabled !== false &&
          ["arxiv-cs-lg", "hf-trending", "github-trending-ml", "hackernews-ml"].includes(s.id),
      ),
    };
    logger.info("dry-run mode: using subset of sources");
  }

  // Load profile
  let profile: InterestProfile;
  if (profilePath) {
    profile = await loadJson<InterestProfile>(profilePath);
  } else {
    profile = defaultProfile();
  }

  // Choose HTTP client
  const http = dryRun && offline ? offlineHttp() : nodeHttp();

  // Optional LLM (only if API key present and not offline)
  let llm: Llm | undefined;
  if (!offline) {
    const openaiKey = process.env["OPENAI_API_KEY"];
    if (openaiKey) {
      llm = openaiLlm(openaiKey);
      logger.info("Using OpenAI LLM judge");
    } else {
      logger.info("No OPENAI_API_KEY found — using keyword scorer");
    }
  }

  try {
    const digest = await runRadar({
      config,
      profile,
      http,
      llm,
      logger,
      now: () => new Date(),
    });

    const md = renderMarkdown(digest);
    // Print to stdout (stderr used for logs via consoleLogger)
    console.log(md);
  } catch (err) {
    logger.error(`Pipeline failed: ${String(err)}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Fatal:", err);
  process.exit(1);
});
