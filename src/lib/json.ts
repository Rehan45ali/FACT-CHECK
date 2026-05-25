export function stripMarkdownFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

export function extractJsonFragment(raw: string): string {
  const text = stripMarkdownFences(raw);
  const firstBrace = text.indexOf("{");
  const firstBracket = text.indexOf("[");

  let start = -1;
  let endChar = "";

  if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
    start = firstBracket;
    endChar = "]";
  } else if (firstBrace !== -1) {
    start = firstBrace;
    endChar = "}";
  }

  if (start === -1) {
    return text;
  }

  const end = text.lastIndexOf(endChar);
  if (end <= start) {
    return text.slice(start);
  }

  return text.slice(start, end + 1);
}

export function parseJson<T>(raw: string): T {
  const fragment = extractJsonFragment(raw);
  return JSON.parse(fragment) as T;
}
