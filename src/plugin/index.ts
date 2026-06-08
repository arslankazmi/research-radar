/**
 * OpenClaw plugin entry for research-radar.
 * Thin orchestration layer — all logic delegates to pipeline/judge/feedback/profile.
 *
 * Registration shape (per docs/OPENCLAW_PLUGIN_SDK.md):
 *  - definePluginEntry with id/name/description/register
 *  - Tools: radar_run, radar_summarize, radar_more_like, radar_explain,
 *           radar_add_interest, radar_mute, radar_sources
 *  - Command: /radar (alias for radar_run)
 *  - Hook: message_received → parseReaction → applyReaction → saveProfile
 *  - Cron: attempt scheduleSessionTurn; gracefully fall back if bundled-only
 */

import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import type { OpenClawPluginApi, PluginHookContext } from "openclaw/plugin-sdk/plugin-entry";
import { defaultConfig } from "../config.default.js";
import { loadProfile, saveProfile, addInterest, muteTopic } from "../profile/profile.js";
import { applyReaction, parseReaction } from "../feedback/feedback.js";
import { runRadar } from "../pipeline.js";
import { renderMarkdown, renderCanvasCard, renderDigestHeader, renderItemMessage, renderDigestFooter } from "../digest/compose.js";
import { fsKv } from "../runtime/fs-kv.js";
import type { Llm, LlmRequest, Logger } from "../contracts.js";
import type { Digest, ScoredItem } from "../types.js";

const PLUGIN_ID = "research-radar";

/** Shared http factory — global fetch (Node 22+). */
function makeHttp() {
  return {
    async get(url: string, init?: { headers?: Record<string, string> }) {
      const headers: Record<string, string> = {
        "User-Agent": "research-radar/0.1",
        ...init?.headers,
      };
      const res = await fetch(url, { headers });
      return {
        ok: res.ok,
        status: res.status,
        text: () => res.text(),
        json: () => res.json() as Promise<unknown>,
      };
    },
  };
}

export default definePluginEntry({
  id: PLUGIN_ID,
  name: "Research Radar",
  description:
    "Conversational, multi-source ML research radar with LLM-judged relevance that learns from your in-chat 👍/👎.",

  register(api: OpenClawPluginApi): void {
    // ── Resolve workspace for KV store ──────────────────────────────────────
    const workspaceDir = (api.config as { workspaceDir?: string }).workspaceDir ?? "/tmp/research-radar";
    const store = fsKv(workspaceDir);

    // ── Adapt api.logger → Logger port ─────────────────────────────────────
    const logger: Logger = {
      info: (msg, ...args) => api.logger.info(msg, ...args),
      warn: (msg, ...args) => api.logger.warn(msg, ...args),
      error: (msg, ...args) => api.logger.error(msg, ...args),
    };

    // ── Adapt api.runtime.llm → Llm port ───────────────────────────────────
    const llm: Llm = {
      async complete(req: LlmRequest) {
        const result = await api.runtime.llm.complete({
          messages: req.messages,
          model: req.model,
          maxTokens: req.maxTokens,
          temperature: req.temperature,
          systemPrompt: req.systemPrompt,
          purpose: "research-radar-judge",
        });
        return {
          text: result.text,
          provider: result.provider,
          model: result.model,
          usage: result.usage,
        };
      },
    };

    // ── Config ──────────────────────────────────────────────────────────────
    const config = defaultConfig();
    const pluginCfg = (api.pluginConfig ?? {}) as {
      profileKey?: string;
      workspaceDir?: string;
    };
    const profileKey = pluginCfg.profileKey ?? "profile";

    // ── In-memory last digest for reference commands ─────────────────────────
    let lastDigest: { items: ScoredItem[] } | null = null;

    // ── Helper: run the pipeline ─────────────────────────────────────────────
    async function runPipeline(): Promise<Digest> {
      const profile = await loadProfile(store, profileKey);
      const digest = await runRadar({
        config,
        profile,
        http: makeHttp(),
        llm,
        logger,
        now: () => new Date(),
      });
      lastDigest = { items: digest.items };
      return digest;
    }

    // ── radar_run ───────────────────────────────────────────────────────────
    api.registerTool({
      name: "radar_run",
      description:
        "Fetch, score, and return today's ML research digest. " +
        "Returns multiple content blocks: a header, one block per item, and a footer. " +
        "IMPORTANT: send each content block as a SEPARATE Slack message so users can react (👍/👎) to individual items.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_id, _params) {
        const digest = await runPipeline();
        const card = renderCanvasCard(digest);

        const parts: { type: "text"; text: string }[] = [];

        // Header message
        parts.push({ type: "text", text: renderDigestHeader(digest) });

        // One message per item
        digest.items.forEach((item, i) => {
          parts.push({ type: "text", text: renderItemMessage(item, i + 1) });
        });

        // Footer message
        parts.push({ type: "text", text: renderDigestFooter() });

        // Canvas card (not sent as chat message)
        parts.push({ type: "text", text: JSON.stringify(card) });

        return { content: parts };
      },
    });

    // ── radar_summarize ─────────────────────────────────────────────────────
    api.registerTool({
      name: "radar_summarize",
      description: "Return a brief summary of item #N from the last digest.",
      parameters: {
        type: "object",
        properties: {
          n: { type: "integer", description: "The #N reference from the digest." },
        },
        required: ["n"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const n = params["n"] as number;
        const item = lastDigest?.items[n - 1];
        if (!item) {
          return { content: [{ type: "text", text: `No item #${n} found. Run radar_run first.` }] };
        }
        return {
          content: [
            {
              type: "text",
              text: `**#${n} ${item.title}**\n\n${item.summary}\n\n_Source: ${item.source} · Score: ${item.score}/10_`,
            },
          ],
        };
      },
    });

    // ── radar_more_like ─────────────────────────────────────────────────────
    api.registerTool({
      name: "radar_more_like",
      description: "Thumbs-up item #N — add it as a positive exemplar and update your interest profile.",
      parameters: {
        type: "object",
        properties: {
          n: { type: "integer", description: "The #N reference from the digest." },
        },
        required: ["n"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const n = params["n"] as number;
        const item = lastDigest?.items[n - 1];
        if (!item) {
          return { content: [{ type: "text", text: `No item #${n} found. Run radar_run first.` }] };
        }
        let profile = await loadProfile(store, profileKey);
        profile = applyReaction(profile, item, "up", () => new Date());
        await saveProfile(store, profile, profileKey);
        return { content: [{ type: "text", text: `👍 Noted! I'll surface more content like "#${n} ${item.title}".` }] };
      },
    });

    // ── radar_explain ───────────────────────────────────────────────────────
    api.registerTool({
      name: "radar_explain",
      description: "Explain why item #N was included in the digest.",
      parameters: {
        type: "object",
        properties: {
          n: { type: "integer", description: "The #N reference from the digest." },
        },
        required: ["n"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const n = params["n"] as number;
        const item = lastDigest?.items[n - 1];
        if (!item) {
          return { content: [{ type: "text", text: `No item #${n} found. Run radar_run first.` }] };
        }
        return {
          content: [
            {
              type: "text",
              text: `**Why #${n} was included:**\n\n${item.reason}\n\n_Scorer: ${item.scorer} · Score: ${item.score}/10_`,
            },
          ],
        };
      },
    });

    // ── radar_add_interest ──────────────────────────────────────────────────
    api.registerTool({
      name: "radar_add_interest",
      description: "Add a topic or interest to your profile to boost related items.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: "The interest text to add, e.g. 'mixture of experts'." },
        },
        required: ["text"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const text = params["text"] as string;
        let profile = await loadProfile(store, profileKey);
        profile = addInterest(profile, text);
        await saveProfile(store, profile, profileKey);
        return { content: [{ type: "text", text: `✅ Added interest: "${text}". It will be reflected in the next radar run.` }] };
      },
    });

    // ── radar_mute ──────────────────────────────────────────────────────────
    api.registerTool({
      name: "radar_mute",
      description: "Mute a topic so items matching it are suppressed from future digests.",
      parameters: {
        type: "object",
        properties: {
          topic: { type: "string", description: "The topic or keyword to mute." },
        },
        required: ["topic"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const topic = params["topic"] as string;
        let profile = await loadProfile(store, profileKey);
        profile = muteTopic(profile, topic);
        await saveProfile(store, profile, profileKey);
        return { content: [{ type: "text", text: `🔇 Topic muted: "${topic}". Future digests will suppress matching items.` }] };
      },
    });

    // ── radar_sources ───────────────────────────────────────────────────────
    api.registerTool({
      name: "radar_sources",
      description: "List all configured research sources and their status.",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      async execute(_id, _params) {
        const lines = config.sources
          .map((s) => {
            const status = s.enabled === false ? "⏸ disabled" : "✅ enabled";
            return `- **${s.id}** (${s.adapter}) — ${status}`;
          })
          .join("\n");
        return { content: [{ type: "text", text: `**Research Radar Sources:**\n\n${lines}` }] };
      },
    });

    // ── /radar command ──────────────────────────────────────────────────────
    api.registerCommand({
      name: "radar",
      description:
        "Run the research radar and return today's digest. " +
        "Send each returned content block as a SEPARATE Slack message so users can react (👍/👎) to individual items.",
      handler: async (_ctx) => {
        try {
          const digest = await runPipeline();
          // Return header only; the agent uses radar_run tool for full per-item delivery
          const header = renderDigestHeader(digest);
          const items = digest.items
            .map((item, i) => renderItemMessage(item, i + 1))
            .join("\n\n---\n\n");
          const footer = renderDigestFooter();
          return {
            text: [header, items, footer].filter(Boolean).join("\n\n---\n\n"),
            continueAgent: true,
          };
        } catch (err) {
          return { text: `Research radar failed: ${String(err)}`, continueAgent: false };
        }
      },
    });

    // ── message_received hook (feedback loop) ────────────────────────────────
    api.registerHook("message_received", async (ctx: PluginHookContext) => {
      const text = typeof ctx["message"] === "string" ? ctx["message"] : "";
      if (!text) return;

      const reaction = parseReaction(text);
      if (!reaction) return;

      // Extract #N reference from message
      const match = /#(\d+)/u.exec(text);
      if (!match || !match[1]) return;
      const n = parseInt(match[1], 10);

      const item = lastDigest?.items[n - 1];
      if (!item) return;

      try {
        let profile = await loadProfile(store, profileKey);
        profile = applyReaction(profile, item, reaction, () => new Date());
        await saveProfile(store, profile, profileKey);
        logger.info(`Feedback recorded: ${reaction} on #${n} "${item.title}"`);
      } catch (err) {
        logger.error(`Failed to persist feedback for #${n}: ${String(err)}`);
      }
      // Don't claim handled — let the agent see it too
    }, { name: "research-radar-feedback" });

    // ── Cron scheduling ──────────────────────────────────────────────────────
    const delivery = config.delivery;
    if (delivery?.cron && delivery?.sessionKey) {
      // Attempt plugin-native scheduleSessionTurn (bundled-only per SDK docs).
      // For external plugins this will throw or be undefined — gracefully fall back.
      void (async () => {
        try {
          const handle = await api.session.workflow.scheduleSessionTurn({
            sessionKey: delivery.sessionKey ?? "agent:main:main",
            cron: delivery.cron ?? "0 8 * * *",
            tz: delivery.tz,
            message: "Run the daily research radar digest: use the radar_run tool.",
            name: "research-radar-daily",
            tag: "research-radar",
          });
          if (handle) {
            logger.info(`Cron scheduled natively: ${delivery.cron} (${delivery.tz ?? "UTC"})`);
          } else {
            logCronFallback(logger, delivery);
          }
        } catch (err) {
          // scheduleSessionTurn is bundled-only — external plugins must use the cron gateway tool
          logger.warn(`Native cron unavailable (${String(err)}). See fallback guidance below.`);
          logCronFallback(logger, delivery);
        }
      })();
    }
  },
});

function logCronFallback(
  logger: Logger,
  delivery: { cron?: string; sessionKey?: string; tz?: string },
): void {
  logger.info(
    [
      "Research Radar cron guidance:",
      `  To schedule daily digests, ask the agent to run the built-in cron tool:`,
      `  cron.add { cron: "${delivery.cron ?? "0 8 * * *"}", message: "Run the research radar: use radar_run tool", sessionKey: "${delivery.sessionKey ?? "agent:main:main"}", tz: "${delivery.tz ?? "UTC"}" }`,
    ].join("\n"),
  );
}
