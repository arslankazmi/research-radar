import type { InterestProfile, Exemplar } from "../types.js";

const EXEMPLAR_CAP = 50;

/**
 * Apply a user reaction to the profile.
 * Pure — returns a new InterestProfile without mutating the input.
 */
export function applyReaction(
  profile: InterestProfile,
  item: { title: string; summary?: string },
  reaction: "up" | "down" | "mute",
  now: () => Date
): InterestProfile {
  const exemplar: Exemplar = {
    title: item.title,
    summary: item.summary,
    label: reaction === "up" ? "up" : "down",
    at: now().toISOString(),
  };

  // Append and cap to last EXEMPLAR_CAP exemplars
  const newExemplars = [...profile.exemplars, exemplar].slice(-EXEMPLAR_CAP);

  // For "mute", also add to mutedTopics (dedup, case-insensitive)
  let newMuted = profile.mutedTopics;
  if (reaction === "mute") {
    const topic = item.title.trim();
    const alreadyMuted = profile.mutedTopics.some(
      (t) => t.toLowerCase() === topic.toLowerCase()
    );
    if (!alreadyMuted) {
      newMuted = [...profile.mutedTopics, topic];
    }
  }

  return {
    ...profile,
    exemplars: newExemplars,
    mutedTopics: newMuted,
  };
}

/**
 * Parse a free-text reaction into a normalized reaction type.
 */
export function parseReaction(
  text: string
): "up" | "down" | "mute" | undefined {
  const t = text.trim();

  // Mute patterns
  if (
    /^mute\b/i.test(t) ||
    t.includes("🔇")
  ) {
    return "mute";
  }

  // Up patterns
  if (
    t.includes("👍") ||
    /^\+1\b/.test(t) ||
    /more like this/i.test(t) ||
    /more like\b/i.test(t)
  ) {
    return "up";
  }

  // Down patterns
  if (
    t.includes("👎") ||
    /^-1\b/.test(t)
  ) {
    return "down";
  }

  return undefined;
}
