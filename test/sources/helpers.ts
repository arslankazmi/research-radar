import type { HttpClient, HttpResponse, Logger, SourceDeps } from "../../src/contracts.js";

/** Build a fake HttpClient that returns a fixed string body. */
export function fakeHttp(body: string, opts: { ok?: boolean; status?: number } = {}): HttpClient {
  const ok = opts.ok ?? true;
  const status = opts.status ?? (ok ? 200 : 500);
  const response: HttpResponse = {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body) as unknown,
  };
  return {
    get: async (_url, _init) => response,
  };
}

/** Build a fake Logger that silently captures messages. */
export function fakeLogger(): Logger & {
  warns: string[];
  errors: string[];
} {
  const warns: string[] = [];
  const errors: string[] = [];
  return {
    warns,
    errors,
    info: () => undefined,
    warn: (msg: string) => { warns.push(msg); },
    error: (msg: string) => { errors.push(msg); },
  };
}

/** Build a fake SourceDeps with the given http. */
export function fakeDeps(http: HttpClient): SourceDeps {
  const fixedDate = new Date("2025-01-15T12:00:00Z");
  return {
    http,
    logger: fakeLogger(),
    now: () => fixedDate,
  };
}
