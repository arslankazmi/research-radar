/** Shared id/url helpers used by every adapter and the dedup stage. */
import { createHash } from "node:crypto";

/** Canonicalize a URL for stable identity + dedup: lowercase host, strip trailing slash,
 *  drop common tracking params and fragments. Falls back to the raw string if unparseable. */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    u.host = u.host.toLowerCase();
    const drop = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "ref_src"];
    for (const k of drop) u.searchParams.delete(k);
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw.trim();
  }
}

/** Stable id for an item, derived from its canonical URL (or title if no URL). */
export function stableId(urlOrKey: string): string {
  return createHash("sha1").update(normalizeUrl(urlOrKey)).digest("hex").slice(0, 16);
}
