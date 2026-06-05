import type { HttpClient, HttpResponse } from "../contracts.js";

/**
 * Offline HttpClient for --dry-run --offline mode.
 * Returns canned responses keyed by URL substring.
 * Never makes network calls.
 */

interface CannedResponse {
  status: number;
  body: string;
}

/** Map of URL-substring → canned response. Longest match wins. */
const CANNED: Array<[string, CannedResponse]> = [
  [
    "export.arxiv.org",
    {
      status: 200,
      body: `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>ArXiv Query</title>
  <entry>
    <id>https://arxiv.org/abs/2401.00001</id>
    <title>Scaling Laws for Large Language Model Fine-Tuning</title>
    <summary>We study empirical scaling laws for fine-tuning large language models on downstream tasks. Our experiments reveal consistent power-law relationships between compute, data, and performance.</summary>
    <published>2024-01-15T00:00:00Z</published>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2401.00001"/>
    <author><name>Jane Smith</name></author>
    <author><name>Bob Lee</name></author>
    <category term="cs.LG"/>
  </entry>
  <entry>
    <id>https://arxiv.org/abs/2401.00002</id>
    <title>Efficient Attention Mechanisms for Long-Context Transformers</title>
    <summary>We propose a sparse attention mechanism that reduces the quadratic complexity of self-attention to near-linear, enabling transformers to process sequences of up to 100k tokens efficiently.</summary>
    <published>2024-01-14T00:00:00Z</published>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2401.00002"/>
    <author><name>Alice Wang</name></author>
    <category term="cs.CL"/>
  </entry>
  <entry>
    <id>https://arxiv.org/abs/2401.00003</id>
    <title>RLHF from Human Feedback: A Survey of Alignment Techniques</title>
    <summary>A comprehensive survey of reinforcement learning from human feedback methods for aligning language models, covering reward modeling, PPO variants, and DPO approaches.</summary>
    <published>2024-01-13T00:00:00Z</published>
    <link rel="alternate" type="text/html" href="https://arxiv.org/abs/2401.00003"/>
    <author><name>Carlos Rivera</name></author>
    <category term="cs.LG"/>
  </entry>
</feed>`,
    },
  ],
  [
    "huggingface.co/api/models",
    {
      status: 200,
      body: JSON.stringify([
        {
          modelId: "mistralai/Mistral-7B-Instruct-v0.2",
          id: "mistralai/Mistral-7B-Instruct-v0.2",
          pipeline_tag: "text-generation",
          trendingScore: 98.5,
          likes: 5200,
          downloads: 1500000,
          createdAt: "2024-01-10T00:00:00.000Z",
          cardData: { description: "Instruction-tuned Mistral 7B for chat and reasoning." },
        },
        {
          modelId: "Salesforce/xLAM-7b-fc-r",
          id: "Salesforce/xLAM-7b-fc-r",
          pipeline_tag: "text-generation",
          trendingScore: 87.2,
          likes: 920,
          downloads: 280000,
          createdAt: "2024-01-12T00:00:00.000Z",
          cardData: { description: "Large action model for function calling and agentic tasks." },
        },
      ]),
    },
  ],
  [
    "api.github.com/search/repositories",
    {
      status: 200,
      body: JSON.stringify({
        total_count: 2,
        items: [
          {
            full_name: "microsoft/phi-2",
            html_url: "https://github.com/microsoft/phi-2",
            description: "Phi-2: A small but mighty language model for code and reasoning.",
            stargazers_count: 8900,
            pushed_at: "2024-01-14T00:00:00Z",
            created_at: "2023-12-10T00:00:00Z",
            topics: ["machine-learning", "language-model"],
          },
          {
            full_name: "openai/triton",
            html_url: "https://github.com/openai/triton",
            description: "Development repository for the Triton language and compiler.",
            stargazers_count: 12000,
            pushed_at: "2024-01-13T00:00:00Z",
            created_at: "2021-09-01T00:00:00Z",
            topics: ["machine-learning", "gpu", "compiler"],
          },
        ],
      }),
    },
  ],
  [
    "hn.algolia.com",
    {
      status: 200,
      body: JSON.stringify({
        hits: [
          {
            objectID: "38900000",
            title: "Show HN: Open-source LLM evaluation framework with human-in-the-loop",
            url: "https://github.com/example/llm-eval",
            points: 342,
            created_at: "2024-01-15T10:00:00.000Z",
            story_text: "We built a framework for evaluating LLMs with automated metrics plus human preference signals.",
            author: "hacker1",
          },
          {
            objectID: "38900001",
            title: "The Unreasonable Effectiveness of Fine-tuning Small Models",
            url: "https://blog.example.com/fine-tuning-small-models",
            points: 215,
            created_at: "2024-01-14T14:00:00.000Z",
            story_text: "",
            author: "hacker2",
          },
        ],
      }),
    },
  ],
  [
    // Fallback for all RSS/scrape URLs
    "gwern.net",
    {
      status: 200,
      body: `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Gwern.net</title>
    <item>
      <title>Scaling Hypothesis Revisited: What We Know in 2024</title>
      <link>https://gwern.net/scaling-2024</link>
      <description>A comprehensive review of what scaling laws tell us about the future of AI capabilities, updated for 2024 findings.</description>
      <pubDate>Mon, 15 Jan 2024 00:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`,
    },
  ],
];

/** Find the best matching canned response for a URL (longest substring match). */
function findCanned(url: string): CannedResponse {
  let best: CannedResponse | null = null;
  let bestLen = 0;

  for (const [pattern, response] of CANNED) {
    if (url.includes(pattern) && pattern.length > bestLen) {
      best = response;
      bestLen = pattern.length;
    }
  }

  // Default fallback: empty RSS
  return (
    best ?? {
      status: 200,
      body: `<?xml version="1.0"?><rss version="2.0"><channel><title>Offline</title></channel></rss>`,
    }
  );
}

/** Build an offline HttpClient that never touches the network. */
export function offlineHttp(): HttpClient {
  return {
    async get(url: string): Promise<HttpResponse> {
      const canned = findCanned(url);
      const bodyText = canned.body;

      return {
        ok: canned.status >= 200 && canned.status < 300,
        status: canned.status,
        text: async () => bodyText,
        json: async () => JSON.parse(bodyText) as unknown,
      };
    },
  };
}
