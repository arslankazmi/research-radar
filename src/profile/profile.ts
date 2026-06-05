import type { InterestProfile } from "../types.js";
import type { KvStore } from "../contracts.js";

const DEFAULT_KEY = "profile";

export function defaultProfile(): InterestProfile {
  return {
    interests:
      "Machine learning research, large language models, transformers, efficient neural networks, fine-tuning, alignment, and practical ML engineering.",
    keywords: [
      "llm",
      "transformer",
      "finetune",
      "finetuning",
      "alignment",
      "rlhf",
      "inference",
      "quantization",
      "diffusion",
      "agent",
      "benchmark",
      "evaluation",
      "rag",
      "retrieval",
    ],
    mutedTopics: [],
    exemplars: [],
    minScore: 6,
    topN: 12,
  };
}

export async function loadProfile(store: KvStore, key?: string): Promise<InterestProfile> {
  const k = key ?? DEFAULT_KEY;
  const stored = await store.read<InterestProfile>(k);
  return stored ?? defaultProfile();
}

export async function saveProfile(store: KvStore, p: InterestProfile, key?: string): Promise<void> {
  const k = key ?? DEFAULT_KEY;
  await store.write<InterestProfile>(k, p);
}

export function addInterest(p: InterestProfile, text: string): InterestProfile {
  const trimmed = text.trim();
  const joined = p.interests ? `${p.interests} ${trimmed}` : trimmed;
  return { ...p, interests: joined };
}

export function removeInterest(p: InterestProfile, text: string): InterestProfile {
  const trimmed = text.trim();
  const updated = p.interests
    .split(/\s+/)
    .filter((w) => w.toLowerCase() !== trimmed.toLowerCase())
    .join(" ");
  return { ...p, interests: updated };
}

export function muteTopic(p: InterestProfile, topic: string): InterestProfile {
  const trimmed = topic.trim().toLowerCase();
  if (p.mutedTopics.map((t) => t.toLowerCase()).includes(trimmed)) {
    return p;
  }
  return { ...p, mutedTopics: [...p.mutedTopics, topic.trim()] };
}
