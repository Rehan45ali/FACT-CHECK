import type { Claim } from "@/lib/types";
import { formatTavilyResultsForPrompt, type TavilySearchResponse } from "@/lib/tavily";

export function truncateForPrompt(text: string, maxCharacters: number): string {
  if (text.length <= maxCharacters) {
    return text;
  }

  return `${text.slice(0, maxCharacters)}\n\n[Document truncated for analysis.]`;
}

export function buildClaimExtractionPrompt(documentText: string): string {
  return [
    "You are a claim extraction specialist.",
    "Read the document and extract 5 to 10 specific, verifiable claims.",
    "Do not paraphrase the same fact multiple times. Each claim must be unique and non-overlapping.",
    "",
    "Focus only on claims that can be checked against public evidence:",
    "- statistics and percentages",
    "- dates and timelines",
    "- financial figures",
    "- rankings and positions",
    "- technical specifications",
    "- factual assertions about people, companies, products, or organizations",
    "",
    "Skip vague marketing copy and broad opinions.",
    "Return ONLY valid JSON in this exact shape:",
    `[{"id":1,"claim":"...","category":"Statistics","context":"..."}]`,
    "",
    "Allowed categories: Statistics, Financial, Date, Ranking, Technical, Factual.",
    "Use the exact claim wording where possible.",
    "",
    "DOCUMENT:",
    documentText,
  ].join("\n");
}

export function buildVerificationPrompt(claim: Claim, search: TavilySearchResponse): string {
  return [
    "You are a careful fact-checker.",
    "Use the claim and the search evidence below to decide whether the claim is Verified, Inaccurate, False, or Uncertain.",
    "",
    "Rules:",
    "- Verified: the claim matches current authoritative evidence.",
    "- Inaccurate: the fact exists, but the date, number, or value is wrong or outdated.",
    "- False: the claim contradicts credible evidence or has no credible support.",
    "- Uncertain: the available evidence is not enough to make a confident call.",
    "",
    "Return ONLY valid JSON in this exact shape:",
    `{"verdict":"Verified","confidence":0,"analysis":"...","correction":null}`,
    "",
    `Claim: ${claim.claim}`,
    `Category: ${claim.category}`,
    `Context: ${claim.context}`,
    "",
    formatTavilyResultsForPrompt(search, 3),
  ].join("\n");
}
