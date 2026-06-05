/**
 * Cross-module interfaces (ports). Everything is dependency-injected so each unit
 * is testable in isolation and the pipeline has no hidden globals.
 */
import type { Item, SourceType } from "./types.js";

/** Minimal HTTP GET port. Backed by global fetch in prod, by fixtures in tests. */
export interface HttpClient {
  get(url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse>;
}

export interface HttpResponse {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

/** Structured logger port. Defaults to a console logger; the plugin passes the SDK logger. */
export interface Logger {
  info(msg: string, ...args: unknown[]): void;
  warn(msg: string, ...args: unknown[]): void;
  error(msg: string, ...args: unknown[]): void;
}

/** Dependencies handed to every source adapter. */
export interface SourceDeps {
  http: HttpClient;
  logger: Logger;
  /** Injectable clock for deterministic tests. */
  now: () => Date;
}

/** A source adapter: turns a configured source into normalized items. */
export interface SourceAdapter {
  id: string;
  type: SourceType;
  /** Fetch + normalize. MUST NOT throw for routine empty results; throw only on hard failure. */
  fetch(): Promise<Item[]>;
}

/**
 * LLM port. Mirrors OpenClaw's `api.runtime.llm.complete(...)` shape so the plugin
 * entry can pass it through directly. In the CLI/tests a fake or a direct-provider
 * adapter is injected.
 */
export interface Llm {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  messages: LlmMessage[];
  /** Omit to use the agent's configured model. */
  model?: string;
  maxTokens?: number;
  temperature?: number;
  systemPrompt?: string;
}

export interface LlmResponse {
  text: string;
  provider?: string;
  model?: string;
  usage?: unknown;
}

/** Key/value JSON store port for the profile + run state (filesystem in prod). */
export interface KvStore {
  read<T>(key: string): Promise<T | undefined>;
  write<T>(key: string, value: T): Promise<void>;
}
