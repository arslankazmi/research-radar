# Testing research-radar on a deployed OpenClaw instance (no ClawHub publish)

OpenClaw has a first-class local-dev path: `openclaw plugins install --link` registers a local
plugin directory in `plugins.load.paths`, runs the **TypeScript entry directly via jiti** (no build
step), and auto-enables the plugin. OpenClaw never installs plugin dependencies — you do.

## 1. Get the code onto the device

```bash
git clone https://github.com/arslankazmi/research-radar.git && cd research-radar
npm install                                  # deps must exist; OpenClaw won't install them
npm test && npm run dry-run -- --offline     # sanity check on this machine's Node (>=22.19)
```

## 2. Link-install into the gateway

```bash
openclaw plugins install --link "$(pwd)"     # validates manifest + registers + auto-enables
openclaw gateway restart
```

## 3. Allow the optional tools

`radar_run` is required (always available). The other six tools are `optional: true` and must be
allowlisted. In `~/.openclaw/openclaw.json`:

```json
{
  "tools": { "allow": ["research-radar"] }
}
```

Optional per-plugin config (defaults are fine):

```json
{
  "plugins": {
    "entries": {
      "research-radar": {
        "enabled": true,
        "config": { "profileKey": "profile" }
      }
    }
  }
}
```

Then `openclaw gateway restart` again.

## 4. Verify it loaded

```bash
openclaw plugins list
openclaw plugins inspect research-radar --runtime --json   # definitive: tools + hooks registered
```

Expect all 7 tools (`radar_run`, `radar_summarize`, `radar_more_like`, `radar_explain`,
`radar_add_interest`, `radar_mute`, `radar_sources`), the `/radar` command, and the
`message_received` hook.

## 5. Chat smoke tests (in order)

1. **`/radar`** (or "run my research radar") → a numbered digest arrives. First live run exercises
   real sources and uses the agent's configured model as judge — the per-item "why" lines should
   read like judge rationales, not keyword lists.
2. **`summarize #1`**, **`why #2`** → reference tools resolve against the last digest.
3. **React 👍** / say **`more like #2`**, then **`mute quantization`** → the interest profile JSON
   in the workspace KV dir gains an exemplar + a muted topic (this proves the feedback loop).
4. **`radar_sources`** → lists configured sources.
5. Ask the agent to **schedule the daily digest** with the built-in `cron` tool
   (`0 8 * * *` → run `radar_run` and post the digest). Native `scheduleSessionTurn` is
   bundled-only; the plugin logs this guidance on activation.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `openclaw/plugin-sdk/plugin-entry` fails to resolve at load | `npm install --save-dev openclaw` inside the plugin dir (provides the subpath), restart the gateway |
| Gateway rejects the `{ "type": "json" }` content part from `radar_run` | Make that return text-only in `src/plugin/index.ts` (Canvas card becomes opt-in) |
| One source errors / produces noise (feed shape, scrape) | Failures are isolated per-source — the digest still ships. Check `openclaw logs`, disable the source in `src/config.default.ts`, file an adapter fix |
| Empty digest | Lower `judge.minScore` in `src/config.default.ts`, or add interests via `radar_add_interest` |

## Report back

Paste the output of `openclaw plugins inspect research-radar --runtime --json` and the first live
digest — that output is the ground truth for the SDK shim's accuracy and drives any fixes.
