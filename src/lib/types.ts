export type ClaimCategory =
  | "Statistics"
  | "Financial"
  | "Date"
  | "Ranking"
  | "Technical"
  | "Factual";

export type Verdict = "Verified" | "Inaccurate" | "False" | "Uncertain";

export interface Claim {
  id: number;
  claim: string;
  category: ClaimCategory;
  context: string;
}

export interface SourceRef {
  title: string;
  url: string;
}

export interface ClaimVerdict extends Claim {
  verdict: Verdict;
  confidence: number;
  analysis: string;
  correction: string | null;
  sources: SourceRef[];
  query: string;
}

export interface FactCheckSummary {
  total: number;
  verified: number;
  inaccurate: number;
  false: number;
  uncertain: number;
  verifiedRate: number;
}

export interface FactCheckReport {
  documentName: string;
  summary: FactCheckSummary;
  claims: ClaimVerdict[];
  extractedCharacters: number;
  runtimeMs: number;
}
