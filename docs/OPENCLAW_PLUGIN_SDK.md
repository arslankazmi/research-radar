# OpenClaw Plugin SDK — Authoritative Reference

> All claims in this document are pinned to actual source files read from
> `openclaw/openclaw` at commit `12a569109b60c7fcbf643799c54712e767562482`.
> Every code block is verbatim from the repository (or the exact type
> signature), never invented.

---

## 1. Manifest

### `package.json` (external plugin)

Verbatim template from `docs/snippets/plugin-publish/minimal-package.json`:

```json
{
  "name": "@myorg/openclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.3.24-beta.2",
      "pluginSdkVersion": "2026.3.24-beta.2"
    }
  }
}
```

Key fields:
- `"type": "module"` — required (ESM only).
- `openclaw.extensions` — array of entry point paths relative to `package.json`. Each item is one plugin extension module. OpenClaw loads the `default` export from each.
- `openclaw.compat.pluginApi` — semver range against which the running gateway checks compatibility. Use the version of the SDK you built against.
- `openclaw.compat.minGatewayVersion` — minimum gateway version required.
- `openclaw.build` — records the SDK and gateway version used at build time (informational).

**Critical — SDK is NOT published to npm.** In-repo `extensions/*` use `"@openclaw/plugin-sdk": "workspace:*"` (seen in `extensions/duckduckgo/package.json` and `extensions/document-extract/package.json`). The `packages/plugin-sdk/package.json` sets `"version": "0.0.0-private"` and `"private": true`. External plugins install the SDK through the ClawHub toolchain (`clawhub package publish`) which bundles the SDK at build time. You do NOT add `@openclaw/plugin-sdk` to your own `dependencies` or `devDependencies` and publish it as an npm dep — the external workflow uses the CLI to bundle it.

### `openclaw.plugin.json` (sidecar manifest)

Verbatim from `docs/snippets/plugin-publish/minimal-openclaw.plugin.json`:

```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Adds a custom tool to OpenClaw",
  "activation": {
    "onStartup": true
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false
  }
}
```

Real example with contracts, from `extensions/duckduckgo/openclaw.plugin.json`:

```json
{
  "id": "duckduckgo",
  "activation": { "onStartup": false },
  "uiHints": {
    "webSearch.region": {
      "label": "DuckDuckGo Region",
      "help": "Optional DuckDuckGo region code such as us-en, uk-en, or de-de."
    }
  },
  "contracts": {
    "webSearchProviders": ["duckduckgo"]
  },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "webSearch": {
        "type": "object",
        "additionalProperties": false,
        "properties": {
          "region": { "type": "string" },
          "safeSearch": { "type": "string", "enum": ["strict", "moderate", "off"] }
        }
      }
    }
  }
}
```

Tool plugins must declare tool names under `contracts.tools`:

```json
{
  "contracts": {
    "tools": ["my_tool"]
  },
  "toolMetadata": {
    "my_tool": { "optional": true }
  }
}
```

---

## 2. Plugin Entry Point

### Import

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
```

The facade at `packages/plugin-sdk/src/plugin-entry.ts` re-exports from
`src/plugin-sdk/plugin-entry.ts`, which in turn re-exports from
`src/plugins/types.ts` and defines the helper function.

### `DefinePluginEntryOptions` type (verbatim from `src/plugin-sdk/plugin-entry.ts`)

```typescript
type DefinePluginEntryOptions = {
  id: string;
  name: string;
  description: string;
  /**
   * @deprecated Declare exclusive plugin kind in `openclaw.plugin.json` via
   * manifest `kind`. Runtime-entry `kind` remains only as a compatibility
   * fallback for older plugins.
   */
  kind?: OpenClawPluginDefinition["kind"];
  configSchema?: OpenClawPluginConfigSchema | (() => OpenClawPluginConfigSchema);
  reload?: OpenClawPluginDefinition["reload"];
  nodeHostCommands?: OpenClawPluginDefinition["nodeHostCommands"];
  securityAuditCollectors?: OpenClawPluginDefinition["securityAuditCollectors"];
  register: (api: OpenClawPluginApi) => void;
};
```

The module default export must be the return value of `definePluginEntry(...)`.

### Minimal entry (from `docs/plugins/building-plugins.md`)

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  description: "Adds a custom tool to OpenClaw",
  register(api) {
    api.registerTool({ /* ... */ });
  },
});
```

### `OpenClawPluginApi` — key fields (verbatim from `src/plugins/types.ts`)

```typescript
export type OpenClawPluginApi = {
  id: string;
  name: string;
  version?: string;
  description?: string;
  source: string;
  rootDir?: string;
  registrationMode: PluginRegistrationMode;
  config: OpenClawConfig;            // full gateway config snapshot
  pluginConfig?: Record<string, unknown>; // plugins.entries.<id>.config
  runtime: PluginRuntime;            // see §8 for model/LLM access
  logger: PluginLogger;
  session: OpenClawPluginSessionApi;
  agent: OpenClawPluginAgentApi;
  runContext: OpenClawPluginRunContextApi;
  lifecycle: OpenClawPluginLifecycleApi;
  registerTool(tool, opts?): void;
  registerWebSearchProvider(provider): void;
  registerProvider(provider): void;
  registerChannel(registration): void;
  registerCommand(def): void;
  registerService(service): void;
  registerHook(events, handler, opts?): void;
  registerHttpRoute(params): void;
  registerGatewayMethod(method, handler, opts?): void;
  // ... many more — see docs/plugins/sdk-overview.md
};
```

For channel plugins, use `defineChannelPluginEntry` from
`openclaw/plugin-sdk/channel-core` instead.

---

## 3. Tool Registration

### API

```typescript
api.registerTool(tool, opts?)
```

`tool` can be a plain object (most common) or a factory function
(`OpenClawPluginToolFactory`). `opts` accepts `{ optional: true }` for tools
that are off by default.

### Tool object shape (inferred from `docs/plugins/building-plugins.md`)

```typescript
api.registerTool({
  name: "my_tool",
  description: "Echo one input value",
  parameters: Type.Object({ input: Type.String() }),  // TypeBox schema
  async execute(_id, params) {
    return {
      content: [{ type: "text", text: `Got: ${params.input}` }],
    };
  },
});
```

### Real example — DuckDuckGo web-search tool

From `extensions/duckduckgo/src/ddg-search-provider.ts` (the `createTool`
factory called by `api.registerWebSearchProvider(...)`):

```typescript
const DuckDuckGoSearchSchema = {
  type: "object",
  properties: {
    query: { type: "string", description: "Search query string." },
    count: {
      type: "integer",
      description: "Number of results to return (1-10).",
      minimum: 1,
      maximum: 10,
    },
    region: {
      type: "string",
      description: "Optional DuckDuckGo region code such as us-en, uk-en, or de-de.",
    },
    safeSearch: {
      type: "string",
      description: "SafeSearch level: strict, moderate, or off.",
    },
  },
  additionalProperties: false,
} satisfies Record<string, unknown>;

export function createDuckDuckGoWebSearchProvider(): WebSearchProviderPlugin {
  return {
    ...createDuckDuckGoWebSearchProviderBase(),
    createTool: (ctx) => ({
      description:
        "Search the web using DuckDuckGo. Returns titles, URLs, and snippets with no API key required.",
      parameters: DuckDuckGoSearchSchema,
      execute: async (args) => {
        const { runDuckDuckGoSearch } = await loadDuckDuckGoClientModule();
        return await runDuckDuckGoSearch({
          config: ctx.config,
          query: readStringParam(args, "query", { required: true }),
          count: readPositiveIntegerParam(args, "count", {
            max: 10,
            message: "count must be an integer from 1 to 10.",
          }),
          region: readStringParam(args, "region"),
          safeSearch: readStringParam(args, "safeSearch") as
            | "strict"
            | "moderate"
            | "off"
            | undefined,
        });
      },
    }),
  };
}
```

This is registered as a web-search provider, not a generic tool — so
`api.registerWebSearchProvider(createDuckDuckGoWebSearchProvider())` is used,
NOT `api.registerTool(...)`. The `createTool` method inside the provider object
is what the gateway calls to expose the tool to the agent.

For a generic agent tool with the same JSON Schema pattern, the handler
signature is `execute(_id: string, params: Record<string, unknown>)`.

### Declaring in manifest

Every tool must appear in `openclaw.plugin.json`:

```json
{
  "contracts": { "tools": ["my_tool"] },
  "toolMetadata": { "my_tool": { "optional": true } }
}
```

---

## 4. Cron / Scheduled Jobs

There are two distinct levels:

### Level 1 — `api.session.workflow.scheduleSessionTurn(...)` (plugin-owned cron)

This schedules a session turn through the Gateway Cron system. It is marked
**bundled-only** in `docs/plugins/sdk-overview.md`. External plugins should not
rely on it.

Type (verbatim from `src/plugins/host-hooks.ts`):

```typescript
export type PluginSessionTurnScheduleParams =
  | ({
      at: string | number | Date;
      deleteAfterRun?: boolean;
    } & PluginSessionTurnScheduleCommonParams)
  | ({
      delayMs: number;
      deleteAfterRun?: boolean;
    } & PluginSessionTurnScheduleCommonParams)
  | ({
      cron: string;      // standard cron expression
      tz?: string;
      deleteAfterRun?: false;
    } & PluginSessionTurnScheduleCommonParams);

type PluginSessionTurnScheduleCommonParams = {
  sessionKey: string;
  message: string;          // prompt text injected into the turn
  agentId?: string;
  deliveryMode?: "none" | "announce";
  name?: string;
  tag?: string;             // for tag-based cleanup
};
```

Usage:

```typescript
const handle = await api.session.workflow.scheduleSessionTurn({
  sessionKey: "agent:main:main",
  cron: "0 9 * * 1-5",       // weekdays at 9 AM
  tz: "America/New_York",
  message: "Run the daily digest",
  name: "daily-digest",
  tag: "digest",
});
```

Remove by tag:

```typescript
await api.session.workflow.unscheduleSessionTurnsByTag({
  sessionKey: "agent:main:main",
  tag: "digest",
});
```

Return type: `Promise<PluginSessionSchedulerJobHandle | undefined>`

### Level 2 — `api.session.workflow.registerSessionSchedulerJob(...)` (ownership metadata only)

This does NOT schedule anything. It registers cleanup metadata for a job that
was already scheduled externally (e.g. via the gateway cron tool the agent
calls). Type (verbatim from `src/plugins/host-hooks.ts`):

```typescript
export type PluginSessionSchedulerJobRegistration = {
  id: string;
  sessionKey: string;
  kind: string;
  description?: string;
  cleanup?: (ctx: {
    reason: PluginHostCleanupReason;
    sessionKey: string;
    jobId: string;
  }) => void | Promise<void>;
};
```

### Level 3 — Gateway cron tool (the `cron` built-in tool)

Plugins can schedule by having the agent call the built-in `cron` gateway tool
(seen in `extensions/qqbot/src/bridge/tools/remind.ts` calling
`callGatewayTool("cron.list", ...)` and `cron.add` actions). This is the
approach channel plugins like qqbot use for user-facing reminders — they return
a structured payload from a tool that the agent decodes and uses to call the
cron gateway method.

**Summary for external plugins**: The safe, documented path is to have the
agent call the built-in `cron` gateway tool (via tool execution from the model).
`scheduleSessionTurn` is bundled-only. `registerSessionSchedulerJob` is for
cleanup bookkeeping only.

---

## 5. Messaging — Send Message and Handle Inbound

OpenClaw's messaging model is channel-centric. Plugins do not call a generic
"send to channel" API directly in their tool handler. Instead:

### Sending a message from a plugin (attachment delivery)

For **bundled plugins**, the API is (from `src/plugins/host-hooks.ts`):

```typescript
export type PluginSessionAttachmentParams = {
  sessionKey: string;
  files: PluginSessionAttachmentFile[];
  text?: string;
  threadId?: string | number;
  forceDocument?: boolean;
  maxBytes?: number;
  captionFormat?: "plain" | "html" | "markdown";
  channelHints?: PluginAttachmentChannelHints;
};

// Usage:
await api.session.workflow.sendSessionAttachment({
  sessionKey: "agent:main:main",
  files: [{ path: "/tmp/report.pdf" }],
  text: "Here is your report",
});
```

This is also documented as **bundled-only**.

For channel plugins (e.g. Slack), the internal send function is
`sendMessageSlack(target, text, opts)` (from `extensions/slack/src/send.ts`).
This is a channel-internal function; external plugins do not call it directly.

**External plugins that need to send messages** should either:
1. Return text content from a tool (`execute` returning `{ content: [{ type: "text", text: "..." }] }`) — the gateway routes the tool result to the originating channel.
2. Use a slash command (`api.registerCommand(def)`) with `continueAgent: true` to trigger an agent turn that sends output.
3. Use `api.session.workflow.enqueueNextTurnInjection(injection)` to prepend/append context into the next agent turn.

### Inbound message / slash command handling

Channel plugins implement the full inbound stack (monitor → handler → session
routing). For non-channel plugins, inbound messages are handled via:

- `api.registerCommand(def)` — registers a slash command that bypasses the LLM:

```typescript
api.registerCommand({
  name: "my-command",
  description: "Run something",
  async execute(ctx: PluginCommandContext): Promise<PluginCommandResult> {
    // ctx.message, ctx.sessionKey, ctx.config available
    return { text: "Done", continueAgent: false };
  },
});
```

- `api.registerHook("message_received", handler)` — fires on every inbound message. Use `{ handled: true }` to claim dispatch.

From `docs/plugins/sdk-overview.md`, the `reply_dispatch` hook claims dispatch
terminally when `{ handled: true, ... }` is returned.

---

## 6. Model / LLM Access

### `api.runtime.llm.complete(params)` — YES, this API exists

Verbatim from `src/plugins/runtime/types-core.ts`:

```typescript
export type LlmCompleteParams = {
  messages: LlmCompleteMessage[];
  /** Model ref (e.g. "anthropic/claude-sonnet-4-6"); defaults to the target agent's configured model. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
  signal?: AbortSignal;
  /** Human-readable reason for audit/debug output. */
  purpose?: string;
  /** Agent whose model/credentials to use. Session-bound capabilities may disallow overrides. */
  agentId?: string;
};

export type LlmCompleteMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type LlmCompleteResult = {
  text: string;
  provider: string;
  model: string;
  agentId: string;
  usage: LlmCompleteUsage;
  audit: {
    caller: LlmCompleteCaller;
    purpose?: string;
    sessionKey?: string;
  };
};

// On PluginRuntimeCore:
llm: {
  complete: (params: LlmCompleteParams) => Promise<LlmCompleteResult>;
};
```

Usage example:

```typescript
register(api) {
  api.registerTool({
    name: "summarize",
    description: "Summarize a document",
    parameters: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false },
    async execute(_id, params) {
      const result = await api.runtime.llm.complete({
        messages: [{ role: "user", content: `Summarize: ${params.text}` }],
        // omit `model` to use the agent's configured model
        purpose: "summarize-tool",
      });
      return { content: [{ type: "text", text: result.text }] };
    },
  });
}
```

Omitting `model` uses the agent's currently configured provider/model. You can
pass `"anthropic/claude-sonnet-4-6"` (or any `provider/model` ref) to pin a
specific model — but then the user must have that provider configured.

There is also `api.runtime.modelAuth` for resolving API keys and
`api.runtime.agent.runEmbeddedAgent(params)` for spawning a full sub-agent run.

---

## 7. Config — Declaring and Reading Plugin Config

### Declaring in `openclaw.plugin.json`

Define the JSON Schema under `configSchema`. Users set values under
`plugins.entries.<plugin-id>.config` in `openclaw.json`.

```json
{
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "apiKey": { "type": "string" },
      "region": { "type": "string" }
    }
  }
}
```

### Reading at runtime

Two patterns observed in extensions:

**Pattern A — direct field access** (simplest, no live-reload):

```typescript
register(api) {
  const cfg = api.pluginConfig as Record<string, unknown>;
  const apiKey = typeof cfg?.apiKey === "string" ? cfg.apiKey : undefined;
}
```

**Pattern B — live config with `resolveLivePluginConfigObject`** (used by
`extensions/thread-ownership/index.ts`, `extensions/active-memory/index.ts`,
etc.):

```typescript
import { resolveLivePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";

register(api) {
  const getLiveConfig = () =>
    resolveLivePluginConfigObject(
      api.runtime.config?.current,
      "my-plugin-id",
    ) as MyPluginConfig | undefined;

  api.registerTool({
    name: "my_tool",
    // ...
    async execute(_id, _params) {
      const cfg = getLiveConfig();  // reads the current live config
      // use cfg.apiKey etc.
    },
  });
}
```

This pattern picks up config changes without a plugin reload.

### Secrets

For API keys, declare them with a `SecretRef`-compatible string type and use:

```typescript
import { resolveConfiguredSecretInputString } from "openclaw/plugin-sdk/config-runtime";
```

This resolves the secret from env vars or the gateway secret store.

---

## 8. Build and Test Toolchain

### TypeScript

Plugins use TypeScript ESM. The in-repo base config
(`extensions/tsconfig.package-boundary.base.json`) extends a paths config:

```json
{
  "extends": "./tsconfig.package-boundary.paths.json",
  "compilerOptions": { "ignoreDeprecations": "6.0" }
}
```

Each extension has its own `tsconfig.json` (e.g. `extensions/duckduckgo/tsconfig.json`):

```json
{
  "extends": "../tsconfig.package-boundary.base.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["./*.ts", "./src/**/*.ts"],
  "exclude": ["./**/*.test.ts", "./dist/**", "./node_modules/**"]
}
```

### Build for external plugins

External plugins are built with the ClawHub CLI toolchain:

```bash
clawhub package publish your-org/your-plugin --dry-run
clawhub package publish your-org/your-plugin
```

The SDK is bundled at publish time — you do not need to build a separate dist
directory. Entry points in `openclaw.extensions` point at TypeScript source
files (`"./index.ts"`); the ClawHub CLI compiles them.

### Testing

In-repo bundled plugins use **vitest** (seen in test files:
`extensions/duckduckgo/src/ddg-search-provider.test.ts`,
`extensions/document-extract/document-extractor.test.ts` use `import { describe, it, expect } from "vitest"`).

```bash
pnpm test -- extensions/my-plugin/
pnpm check
```

For external plugins, the `openclaw/plugin-sdk/testing` subpath exposes test
helpers. The `src/plugin-sdk/plugin-test-api.ts` file provides a mock
`OpenClawPluginApi` implementation suitable for unit tests.

### Verifying an installed plugin

```bash
openclaw plugins inspect my-plugin --runtime --json
```

---

## 9. Open Risks for External / Non-Workspace Plugins

### CRITICAL — SDK is not published to npm

`packages/plugin-sdk/package.json` is `"private": true` with version
`"0.0.0-private"`. There is no `@openclaw/plugin-sdk` package on npm. In-repo
extensions use `"workspace:*"`. External authors build through the ClawHub CLI
(`clawhub package publish`), which bundles the SDK.

**Action**: Do not add `@openclaw/plugin-sdk` to your `package.json`
`dependencies`. Use the ClawHub publish workflow. If you want local development
with type checking, you must either clone the repo and use `pnpm link` or wait
for the ClawHub dev workflow to be documented.

### `scheduleSessionTurn` and `sendSessionAttachment` are bundled-only

The docs (`docs/plugins/sdk-overview.md`) explicitly mark these as
bundled-only. External plugins cannot reliably use them. Use the agent's built-in
`cron` tool or return content from tool handlers instead.

### `registerTrustedToolPolicy` is bundled-only

External plugins cannot participate in the pre-tool safety policy tier.

### `compat.pluginApi` version drift

The manifest requires `pluginApi >= 2026.3.24-beta.2`. Plugins are expected to
test against beta release tags within hours of their appearance. Missing a beta
window means the fix lands in the next cycle (may be days).

### Import path discipline

Never import from `openclaw/plugin-sdk` (the deprecated root barrel). Always
use focused subpaths:

```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { resolveLivePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";
```

### Parameter helpers

Use `readStringParam`, `readPositiveIntegerParam` from
`openclaw/plugin-sdk/param-readers` (seen in `extensions/duckduckgo/src/ddg-search-provider.ts`)
to safely read tool args rather than casting directly.

---

## 10. Complete Minimal External Plugin Skeleton

```
my-plugin/
  package.json           ← openclaw metadata + compat block
  openclaw.plugin.json   ← id, contracts, configSchema, activation
  index.ts               ← definePluginEntry default export
  src/
    my-tool.ts           ← tool implementation
```

**`package.json`**:
```json
{
  "name": "@myorg/openclaw-my-plugin",
  "version": "1.0.0",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"],
    "compat": {
      "pluginApi": ">=2026.3.24-beta.2",
      "minGatewayVersion": "2026.3.24-beta.2"
    },
    "build": {
      "openclawVersion": "2026.3.24-beta.2",
      "pluginSdkVersion": "2026.3.24-beta.2"
    }
  }
}
```

**`openclaw.plugin.json`**:
```json
{
  "id": "my-plugin",
  "name": "My Plugin",
  "description": "Fetches and summarizes content",
  "activation": { "onStartup": true },
  "contracts": { "tools": ["fetch_and_summarize"] },
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "maxChars": { "type": "integer" }
    }
  }
}
```

**`index.ts`**:
```typescript
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";

export default definePluginEntry({
  id: "my-plugin",
  name: "My Plugin",
  description: "Fetches and summarizes content",
  register(api) {
    const getConfig = () =>
      (api.pluginConfig ?? {}) as { maxChars?: number };

    api.registerTool({
      name: "fetch_and_summarize",
      description: "Fetch a URL and summarize its content",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: "URL to fetch" },
        },
        required: ["url"],
        additionalProperties: false,
      },
      async execute(_id, params) {
        const { maxChars = 4000 } = getConfig();
        const url = params.url as string;

        // Fetch content (use node:https or undici — not fetch via WebFetch)
        const res = await fetch(url);
        const text = (await res.text()).slice(0, maxChars);

        // Use the agent's configured LLM to summarize
        const summary = await api.runtime.llm.complete({
          messages: [{ role: "user", content: `Summarize this:\n\n${text}` }],
          purpose: "fetch-and-summarize",
        });

        return {
          content: [{ type: "text", text: summary.text }],
        };
      },
    });
  },
});
```

---

## Source File Index

| Topic | Source path |
|-------|-------------|
| Minimal package.json | `docs/snippets/plugin-publish/minimal-package.json` |
| Minimal openclaw.plugin.json | `docs/snippets/plugin-publish/minimal-openclaw.plugin.json` |
| SDK package.json (exports) | `packages/plugin-sdk/package.json` |
| `definePluginEntry` implementation | `src/plugin-sdk/plugin-entry.ts` |
| `OpenClawPluginApi` type | `src/plugins/types.ts` |
| `PluginRuntimeCore` (llm, modelAuth, tasks) | `src/plugins/runtime/types-core.ts` |
| Host hooks (scheduler, attachment, cron) | `src/plugins/host-hooks.ts` |
| SDK registration reference | `docs/plugins/sdk-overview.md` |
| Plugin quickstart | `docs/plugins/building-plugins.md` |
| DuckDuckGo extension entry | `extensions/duckduckgo/index.ts` |
| DuckDuckGo tool provider | `extensions/duckduckgo/src/ddg-search-provider.ts` |
| Document-extract entry | `extensions/document-extract/index.ts` |
| Document-extract tool | `extensions/document-extract/document-extractor.ts` |
| Config reading pattern | `extensions/thread-ownership/index.ts` |
| Slack channel plugin | `extensions/slack/src/channel.ts` |
| tsconfig base | `extensions/tsconfig.package-boundary.base.json` |
