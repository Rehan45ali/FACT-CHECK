type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL?.trim() || "gemini-3.5-flash";
}

export async function generateGeminiText(
  prompt: string,
  options?: {
    responseMimeType?: string;
    responseJsonSchema?: unknown;
  },
): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY environment variable.");
  }

  const model = getGeminiModel();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          topP: 0.9,
          maxOutputTokens: 2048,
          ...(options?.responseMimeType ? { responseMimeType: options.responseMimeType } : {}),
          ...(options?.responseJsonSchema ? { responseJsonSchema: options.responseJsonSchema } : {}),
        },
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Gemini request failed (${response.status}): ${body}`);
  }

  const payload = (await response.json()) as GeminiResponse;
  const text = payload.candidates
    ?.flatMap((candidate) =>
      candidate.content?.parts?.map((part) => part.text?.trim() ?? "").filter(Boolean) ?? [],
    )
    .find(Boolean);

  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  return text;
}

export async function generateGeminiJson<T>(prompt: string, responseJsonSchema: unknown): Promise<T> {
  const raw = await generateGeminiText(prompt, {
    responseMimeType: "application/json",
    responseJsonSchema,
  });

  return JSON.parse(raw) as T;
}
