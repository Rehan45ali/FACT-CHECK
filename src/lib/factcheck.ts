import type {
  Claim,
  ClaimCategory,
  ClaimVerdict,
  FactCheckReport,
  FactCheckSummary,
  Verdict,
} from "@/lib/types";
import { generateGeminiJson } from "@/lib/gemini";
import { extractTextFromPdf } from "@/lib/pdf";
import { buildClaimExtractionPrompt, buildVerificationPrompt, truncateForPrompt } from "@/lib/prompts";
import { searchTavily, toSourceRefs } from "@/lib/tavily";

const MAX_DOCUMENT_PROMPT_CHARS = 12000;
const MAX_CLAIMS = 8;

const ALLOWED_CATEGORIES: ClaimCategory[] = [
  "Statistics",
  "Financial",
  "Date",
  "Ranking",
  "Technical",
  "Factual",
];

const ALLOWED_VERDICTS: Verdict[] = ["Verified", "Inaccurate", "False", "Uncertain"];
const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "was",
  "were",
  "with",
]);

const claimExtractionSchema = {
  type: "array",
  items: {
    type: "object",
    properties: {
      id: {
        type: "integer",
      },
      claim: {
        type: "string",
      },
      category: {
        type: "string",
        enum: ALLOWED_CATEGORIES,
      },
      context: {
        type: "string",
      },
    },
    required: ["id", "claim", "category", "context"],
  },
} as const;

const verificationSchema = {
  type: "object",
  properties: {
    verdict: {
      type: "string",
      enum: ALLOWED_VERDICTS,
    },
    confidence: {
      type: "integer",
    },
    analysis: {
      type: "string",
    },
    correction: {
      type: ["string", "null"],
    },
  },
  required: ["verdict", "confidence", "analysis", "correction"],
} as const;

type RawClaim = {
  claim?: string;
  category?: string;
  context?: string;
  id?: number | string;
};

type RawVerdict = {
  verdict?: string;
  confidence?: number | string;
  analysis?: string;
  correction?: string | null;
};

function normalizeCategory(value: string | undefined): ClaimCategory {
  const maybe = ALLOWED_CATEGORIES.find((category) => category.toLowerCase() === value?.toLowerCase());
  return maybe ?? "Factual";
}

function normalizeVerdict(value: string | undefined): Verdict {
  const maybe = ALLOWED_VERDICTS.find((verdict) => verdict.toLowerCase() === value?.toLowerCase());
  return maybe ?? "Uncertain";
}

function normalizeConfidence(value: number | string | undefined): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) {
    return 40;
  }

  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function normalizeClaimText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function tokenizeClaimText(value: string): string[] {
  return normalizeClaimText(value)
    .split(" ")
    .filter((token) => token && !STOPWORDS.has(token));
}

function jaccardSimilarity(left: string, right: string): number {
  const leftTokens = new Set(tokenizeClaimText(left));
  const rightTokens = new Set(tokenizeClaimText(right));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      intersection += 1;
    }
  }

  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union ? intersection / union : 0;
}

function dedupeClaims(claims: Claim[]): Claim[] {
  const unique: Claim[] = [];

  for (const claim of claims) {
    const normalized = normalizeClaimText(claim.claim);
    if (!normalized) {
      continue;
    }

    const isDuplicate = unique.some((existing) => {
      const existingNormalized = normalizeClaimText(existing.claim);
      return (
        existingNormalized === normalized ||
        existingNormalized.includes(normalized) ||
        normalized.includes(existingNormalized) ||
        jaccardSimilarity(existing.claim, claim.claim) > 0.72
      );
    });

    if (!isDuplicate) {
      unique.push(claim);
    }
  }

  return unique;
}

function normalizeClaims(raw: unknown): Claim[] {
  const entries: RawClaim[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === "object" && Array.isArray((raw as { claims?: unknown[] }).claims)
      ? ((raw as { claims: RawClaim[] }).claims ?? [])
      : [];

  return entries
    .map((entry, index) => {
      const claim = normalizeText(entry.claim);
      if (!claim) {
        return null;
      }

      return {
        id: Number(entry.id) || index + 1,
        claim,
        category: normalizeCategory(entry.category),
        context: normalizeText(entry.context, "No additional context provided."),
      } satisfies Claim;
    })
    .filter((entry): entry is Claim => Boolean(entry));
}

function normalizeVerdictPayload(raw: unknown): RawVerdict {
  if (!raw || typeof raw !== "object") {
    return {};
  }

  const candidate = raw as Record<string, unknown>;
  return {
    verdict: typeof candidate.verdict === "string" ? candidate.verdict : undefined,
    confidence: candidate.confidence as number | string | undefined,
    analysis: typeof candidate.analysis === "string" ? candidate.analysis : undefined,
    correction:
      candidate.correction === null || typeof candidate.correction === "string"
        ? (candidate.correction as string | null)
        : undefined,
  };
}

function buildSummary(claims: ClaimVerdict[]): FactCheckSummary {
  const verified = claims.filter((claim) => claim.verdict === "Verified").length;
  const inaccurate = claims.filter((claim) => claim.verdict === "Inaccurate").length;
  const falseCount = claims.filter((claim) => claim.verdict === "False").length;
  const uncertain = claims.filter((claim) => claim.verdict === "Uncertain").length;
  const total = claims.length;

  return {
    total,
    verified,
    inaccurate,
    false: falseCount,
    uncertain,
    verifiedRate: total ? Math.round((verified / total) * 100) : 0,
  };
}

async function extractClaims(documentText: string): Promise<Claim[]> {
  const prompt = buildClaimExtractionPrompt(truncateForPrompt(documentText, MAX_DOCUMENT_PROMPT_CHARS));
  const parsed = await generateGeminiJson<unknown>(prompt, claimExtractionSchema);
  const claims = dedupeClaims(normalizeClaims(parsed)).slice(0, MAX_CLAIMS);

  if (!claims.length) {
    throw new Error("Gemini did not return any verifiable claims.");
  }

  return claims;
}

async function verifyClaim(claim: Claim): Promise<ClaimVerdict> {
  const searchQuery = [claim.claim, claim.context].filter(Boolean).join(" - ");
  const search = await searchTavily(searchQuery);
  const prompt = buildVerificationPrompt(claim, search);
  const parsed = normalizeVerdictPayload(await generateGeminiJson<unknown>(prompt, verificationSchema));

  return {
    ...claim,
    verdict: normalizeVerdict(parsed.verdict),
    confidence: normalizeConfidence(parsed.confidence),
    analysis: normalizeText(parsed.analysis, "No analysis was returned."),
    correction:
      typeof parsed.correction === "string" && parsed.correction.trim().length > 0
        ? parsed.correction.trim()
        : null,
    sources: toSourceRefs(search),
    query: search.query,
  };
}

export async function factCheckDocument(fileName: string, pdfBuffer: Buffer): Promise<FactCheckReport> {
  const startedAt = Date.now();
  const extractedText = await extractTextFromPdf(pdfBuffer);
  if (!extractedText.trim()) {
    throw new Error("No readable text could be extracted from the PDF.");
  }

  const claims = await extractClaims(extractedText);
  const verdicts: ClaimVerdict[] = [];

  for (const claim of claims) {
    verdicts.push(await verifyClaim(claim));
  }

  return {
    documentName: fileName,
    summary: buildSummary(verdicts),
    claims: verdicts,
    extractedCharacters: extractedText.length,
    runtimeMs: Date.now() - startedAt,
  };
}
