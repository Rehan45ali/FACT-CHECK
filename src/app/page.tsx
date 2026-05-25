"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import type { FactCheckReport, Verdict } from "@/lib/types";

type FilterValue = "All" | Verdict;

const workflowSteps = [
  {
    title: "Upload a PDF",
    text: "Drop in a report, pitch deck, whitepaper, or any text-based PDF that contains claims worth checking.",
  },
  {
    title: "Extract claims",
    text: "Gemini pulls out concrete numbers, dates, rankings, and factual statements from the document.",
  },
  {
    title: "Search evidence",
    text: "Tavily finds current web sources so each claim can be checked against live public information.",
  },
  {
    title: "Review the verdicts",
    text: "The backend returns a clean report with verdicts, confidence scores, corrections, and sources.",
  },
];

const verdictOrder: Record<Verdict, number> = {
  False: 0,
  Inaccurate: 1,
  Uncertain: 2,
  Verified: 3,
};

const verdictLabels: Record<Verdict, string> = {
  Verified: "Verified",
  Inaccurate: "Inaccurate",
  False: "False",
  Uncertain: "Uncertain",
};

const phases = [
  "Reading the PDF",
  "Extracting verifiable claims",
  "Searching live sources",
  "Cross-checking evidence",
  "Preparing the report",
];

function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function fileNameWithoutExtension(name: string): string {
  return name.replace(/\.pdf$/i, "");
}

function filterKeyIsVerdict(value: FilterValue): value is Verdict {
  return value !== "All";
}

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<FactCheckReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>("All");
  const [phaseIndex, setPhaseIndex] = useState(0);

  useEffect(() => {
    if (!loading) {
      return;
    }

    const interval = window.setInterval(() => {
      setPhaseIndex((current) => (current + 1) % phases.length);
    }, 1800);

    return () => window.clearInterval(interval);
  }, [loading]);

  const visibleClaims = useMemo(() => {
    if (!report) {
      return [];
    }

    const claims = [...report.claims].sort(
      (left, right) => verdictOrder[left.verdict] - verdictOrder[right.verdict],
    );

    if (!filterKeyIsVerdict(filter)) {
      return claims;
    }

    return claims.filter((claim) => claim.verdict === filter);
  }, [filter, report]);

  const summaryCards = useMemo(() => {
    if (!report) {
      return [];
    }

    return [
      { label: "Total claims", value: report.summary.total, accent: "#7dd3fc" },
      { label: "Verified", value: report.summary.verified, accent: "#34d399" },
      { label: "Inaccurate", value: report.summary.inaccurate, accent: "#fb923c" },
      { label: "False", value: report.summary.false, accent: "#fb7185" },
      { label: "Uncertain", value: report.summary.uncertain, accent: "#60a5fa" },
      { label: "Verified rate", value: `${report.summary.verifiedRate}%`, accent: "#5eead4" },
    ];
  }, [report]);

  async function handleAnalyze() {
    if (!file) {
      setError("Please choose a PDF first.");
      return;
    }

    setLoading(true);
    setError(null);
    setReport(null);
    setPhaseIndex(0);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await fetch("/api/factcheck", {
        method: "POST",
        body: formData,
      });

      const payload = (await response.json()) as FactCheckReport & { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || "Fact-checking failed.");
      }

      setReport(payload);
    } catch (analysisError) {
      setError(
        analysisError instanceof Error ? analysisError.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  }

  function handleReset() {
    setFile(null);
    setReport(null);
    setError(null);
    setFilter("All");
    setLoading(false);
    setPhaseIndex(0);
  }

  function handleDownload() {
    if (!report) {
      return;
    }

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${fileNameWithoutExtension(report.documentName)}-factcheck.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="app-shell">
      <main className="layout">
        <div className="grid top-grid">
          <section className="panel hero-panel">
            <div className="eyebrow">Truth checking workspace</div>
            <h1 className="title">
              <span>TruthLayer</span>
            </h1>
            <p className="subtitle">
              A fresh split-stack app for PDF fact-checking. The frontend lives in Next.js,
              while the API route extracts claims, uses Gemini for reasoning, and checks the web
              through Tavily.
            </p>

            <div className="meta-row">
              <div className="meta-pill">Frontend: Next.js App Router</div>
              <div className="meta-pill">Backend: API route</div>
              <div className="meta-pill">AI: Gemini</div>
              <div className="meta-pill">Search: Tavily</div>
            </div>

            <div className="action-row">
              <label className={`upload-zone${file ? " upload-zone--filled" : ""}`}>
                <input
                  type="file"
                  accept="application/pdf"
                  onChange={(event) => {
                    const chosenFile = event.target.files?.[0] ?? null;
                    setFile(chosenFile);
                    setError(null);
                  }}
                />
                <div className="upload-copy">
                  <div className="upload-title">
                    {file ? "PDF selected" : "Choose a PDF to fact-check"}
                  </div>
                  <div className="upload-hint">
                    {file
                      ? "Replace the current file or clear the selection to start again."
                      : "Click to browse. The backend will extract the text, check sources, and return a verdict report."}
                  </div>
                  <div className="upload-filename">
                    {file ? file.name : "Text-based PDFs work best"}
                  </div>
                </div>
              </label>

              <div className="button-row">
                <button
                  type="button"
                  className="button button-primary"
                  onClick={handleAnalyze}
                  disabled={loading || !file}
                >
                  {loading ? "Analyzing..." : "Run fact-check"}
                </button>

                <button
                  type="button"
                  className="button button-secondary"
                  onClick={handleReset}
                  disabled={loading && !report && !file}
                >
                  Reset
                </button>
              </div>
            </div>

            <p className="help-text">
              The app keeps API keys on the server side. GitHub gets only code and a placeholder
              env file, never your secrets.
            </p>

            {error ? <div className="status-panel">{error}</div> : null}

            {loading ? (
              <div className="status-panel">
                <div className="status-head">
                  <div>
                    <p className="status-title">Working on your document</p>
                    <p className="status-copy">{phases[phaseIndex]}</p>
                  </div>
                  <div className="status-pill">Live analysis in progress</div>
                </div>
                <div className="progress-shell" aria-hidden="true">
                    <div
                    className="progress-fill"
                    style={
                      {
                        "--progress-width": `${((phaseIndex + 1) / phases.length) * 100}%`,
                      } as CSSProperties
                    }
                  />
                </div>
              </div>
            ) : null}
          </section>

          <aside className="panel side-panel">
            <div className="section-label">How it works</div>
            <h2 className="section-title">A clean frontend and backend split</h2>
            <p className="section-copy">
              The UI is just presentation and file upload. The server route does the heavy lifting:
              PDF text extraction, claim extraction, live search, and verdict scoring.
            </p>

            <div className="workflow">
              {workflowSteps.map((step, index) => (
                <div className="workflow-step" key={step.title}>
                  <div className="workflow-index">{index + 1}</div>
                  <div>
                    <p className="workflow-title">{step.title}</p>
                    <p className="workflow-text">{step.text}</p>
                  </div>
                </div>
              ))}
            </div>

            <div className="status-panel">
              <div className="status-head">
                <div>
                  <p className="status-title">Deployment target</p>
                  <p className="status-copy">
                    This codebase is designed for Vercel, with the API route running on the Node
                    runtime.
                  </p>
                </div>
                <div className="status-pill">Vercel-ready</div>
              </div>
              <p className="status-copy">
                The environment variables stay server-side only: <strong>GEMINI_API_KEY</strong>{" "}
                and <strong>TAVILY_API_KEY</strong>.
              </p>
            </div>
          </aside>
        </div>

        {report ? (
          <section className="panel report-panel" style={{ marginTop: 22 }}>
            <div className="report-head">
              <div>
                <div className="section-label">Report</div>
                <h2 className="section-title">{report.documentName}</h2>
                <p className="report-meta">
                  {report.summary.total} claims checked in {formatSeconds(report.runtimeMs)}. The
                  report found {report.summary.verified} verified claims, {report.summary.inaccurate}{" "}
                  inaccurate claims, and {report.summary.false} false claims.
                </p>
              </div>

              <div className="report-actions">
                <button type="button" className="button button-secondary" onClick={handleDownload}>
                  Download JSON
                </button>
              </div>
            </div>

            <div className="stats-grid">
              {summaryCards.map((card) => (
                <div className="stat-card" key={card.label}>
                  <div className="stat-value" style={{ color: card.accent }}>
                    {card.value}
                  </div>
                  <div className="stat-label">{card.label}</div>
                </div>
              ))}
            </div>

            <div className="filters">
              {(["All", "Verified", "Inaccurate", "False", "Uncertain"] as FilterValue[]).map(
                (item) => (
                  <button
                    key={item}
                    type="button"
                    className="filter-chip"
                    data-active={filter === item}
                    onClick={() => setFilter(item)}
                  >
                    {item}
                  </button>
                ),
              )}
            </div>

            {visibleClaims.length ? (
              <div className="claim-list">
                {visibleClaims.map((claim, index) => (
                  <article
                    key={claim.id}
                    className={`claim-card claim-card--${claim.verdict.toLowerCase()}`}
                  >
                    <div className="claim-top">
                      <div className="claim-index">
                        Claim {index + 1} of {visibleClaims.length}
                      </div>
                      <div className={`claim-badge badge-${claim.verdict.toLowerCase()}`}>
                        {verdictLabels[claim.verdict]}
                        <span>{claim.confidence}%</span>
                      </div>
                    </div>

                    <div className="claim-text">"{claim.claim}"</div>
                    <div className="claim-meta">
                      Category: {claim.category} | Search query: {claim.query}
                    </div>
                    <div className="claim-analysis">{claim.analysis}</div>

                    {claim.correction ? (
                      <div className="correction-box">
                        <strong>Correction:</strong> {claim.correction}
                      </div>
                    ) : null}

                    {claim.sources.length ? (
                      <div className="source-list">
                        {claim.sources.map((source) => (
                          <a
                            key={`${claim.id}-${source.url}`}
                            className="source-link"
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {source.title}
                          </a>
                        ))}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : (
              <div className="empty-state">No claims matched the selected filter.</div>
            )}

            <p className="footer-note">
              Runtime checks included PDF parsing, claim extraction, Tavily search, and Gemini
              verification. If a PDF is image-only or heavily scanned, the backend may not extract
              enough text to analyze.
            </p>
          </section>
        ) : (
          <section className="panel report-panel" style={{ marginTop: 22 }}>
            <div className="section-label">Ready when you are</div>
            <h2 className="section-title">No report yet</h2>
            <div className="empty-state">
              Upload a PDF and run the analysis. Once the backend finishes, we will show a verdict
              breakdown, live-source evidence, and a downloadable JSON report.
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
