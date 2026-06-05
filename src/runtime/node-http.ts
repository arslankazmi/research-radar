import type { HttpClient, HttpResponse } from "../contracts.js";

const USER_AGENT = "research-radar/0.1";

/**
 * Production HttpClient backed by global fetch.
 * Sets a User-Agent header on every request.
 */
export function nodeHttp(): HttpClient {
  return {
    async get(url: string, init?: { headers?: Record<string, string> }): Promise<HttpResponse> {
      const headers: Record<string, string> = {
        "User-Agent": USER_AGENT,
        ...init?.headers,
      };

      const response = await fetch(url, { headers });

      return {
        ok: response.ok,
        status: response.status,
        text: () => response.text(),
        json: () => response.json() as Promise<unknown>,
      };
    },
  };
}
