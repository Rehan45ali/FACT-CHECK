import type { SourceRef } from "@/lib/types";

export interface TavilySearchResult {
  title: string;
  url: string;
  content?: string;
  score?: number;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilySearchResult[];
}

export async function searchTavily(query: string): Promise<TavilySearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing TAVILY_API_KEY environment variable.");
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      query,
      search_depth: "basic",
      topic: "general",
      max_results: 5,
      include_answer: true,
      include_raw_content: false,
      include_favicon: false,
      exclude_domains: [
        "facebook.com",
        "instagram.com",
        "x.com",
        "twitter.com",
        "reddit.com",
        "quora.com",
        "tiktok.com",
        "youtube.com",
        "youtu.be",
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Tavily request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as TavilySearchResponse;
  return {
    query: payload.query ?? query,
    answer: payload.answer,
    results: Array.isArray(payload.results) ? payload.results : [],
  };
}

export function formatTavilyResultsForPrompt(response: TavilySearchResponse, limit = 3): string {
  const lines: string[] = [];

  if (response.answer) {
    lines.push(`Tavily answer: ${response.answer}`);
    lines.push("");
  }

  lines.push("Search results:");
  response.results.slice(0, limit).forEach((result, index) => {
    lines.push(`${index + 1}. ${result.title}`);
    lines.push(`URL: ${result.url}`);
    if (result.content) {
      lines.push(`Snippet: ${result.content}`);
    }
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function toSourceRefs(response: TavilySearchResponse, limit = 3): SourceRef[] {
  return response.results.slice(0, limit).map((result) => ({
    title: result.title,
    url: result.url,
  }));
}
