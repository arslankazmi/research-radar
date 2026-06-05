---
name: research-radar
description: Use to deliver and discuss the user's personalized ML research digest — fetch today's papers/models/repos/posts, explain or summarize items, and capture 👍/👎/mute feedback. Trigger when the user says "research radar", "what's new in ML", "/radar", "any new papers", reacts to a digest item, or asks to tune what they see.
---

# Research Radar

A conversational, multi-source ML research radar. It fetches from arXiv, Hugging Face, GitHub, Hacker
News, and curated researcher feeds, scores each item for relevance with an LLM-as-judge against the
user's interest profile, and learns from in-chat reactions.

## When to use

- The user asks for new research / "what's new in ML" / "any new papers/models" → run `radar_run`.
- The user refers to a numbered item from the last digest (`#3`) → use the matching tool.
- The user reacts to an item (👍/👎) or says "more like #N" / "mute <topic>" → record feedback.
- A scheduled digest is due (cron) → run `radar_run` and post the result to the user's channel.

## Tools

- `radar_run` — fetch, dedupe, score, and return today's digest (numbered Markdown + a Canvas card).
  Always run this first in a session before referencing item numbers.
- `radar_summarize { n }` — summarize item `#n` from the last digest.
- `radar_explain { n }` — explain why item `#n` was included (the judge's rationale).
- `radar_more_like { n }` — record a 👍 on `#n` (adds a positive exemplar; future digests lean this way).
- `radar_add_interest { text }` — add a natural-language interest to the profile.
- `radar_mute { topic }` — suppress a topic from future digests.
- `radar_sources` — list the configured sources.

The `message_received` hook also captures bare reactions: a 👍/👎 or "more like #N" / "mute X" in chat
updates the interest profile automatically — you do not need to call a tool for those.

## Behavior guidance

- Render digests as the numbered list `radar_run` returns; keep the `#N` numbering so the user can refer
  to items. Offer the footer hint (react 👍/👎, "more like #N", "mute <topic>").
- When the user reacts, acknowledge briefly and let the feedback loop do the tuning — don't re-run the
  whole digest unless asked.
- If a digest is empty (all sources below threshold or unavailable), say so plainly and suggest lowering
  `minScore` or adding interests rather than inventing items.

## Scheduling

For a daily digest, schedule `radar_run` to post to the user's channel at their chosen time. Prefer the
gateway's built-in `cron` tool (e.g. `0 8 * * *`). The plugin also attempts native
`scheduleSessionTurn` on activation when the bundled API is available.
