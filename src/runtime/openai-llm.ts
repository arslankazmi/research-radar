import type { Llm, LlmRequest, LlmResponse } from "../contracts.js";

/**
 * Optional OpenAI-compatible LLM adapter.
 * Uses global fetch — no extra dependencies.
 * Only created when OPENAI_API_KEY is present.
 */
export function openaiLlm(apiKey: string, model = "gpt-4o-mini"): Llm {
  return {
    async complete(req: LlmRequest): Promise<LlmResponse> {
      const messages = req.messages.map((m) => ({ role: m.role, content: m.content }));

      const body = {
        model: req.model ?? model,
        messages,
        max_tokens: req.maxTokens ?? 2000,
        temperature: req.temperature ?? 0,
      };

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
          "User-Agent": "research-radar/0.1",
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`OpenAI API error ${response.status}: ${errText}`);
      }

      interface OpenAiResponse {
        choices: Array<{ message: { content: string } }>;
        model: string;
        usage: unknown;
      }
      const data = (await response.json()) as OpenAiResponse;
      const text = data.choices[0]?.message.content ?? "";

      return {
        text,
        provider: "openai",
        model: data.model,
        usage: data.usage,
      };
    },
  };
}
