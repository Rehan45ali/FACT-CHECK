const form = document.getElementById("factcheck-form");
const fileInput = document.getElementById("pdf-file");
const fileName = document.getElementById("file-name");
const submitButton = document.getElementById("submit-button");
const statusTitle = document.getElementById("status-title");
const statusCopy = document.getElementById("status-copy");
const summaryGrid = document.getElementById("summary-grid");
const resultsPanel = document.getElementById("results-panel");
const resultsTitle = document.getElementById("results-title");
const resultsMeta = document.getElementById("results-meta");
const claimsList = document.getElementById("claims-list");
const errorBox = document.getElementById("error-box");

const verdictOrder = {
  False: 0,
  Inaccurate: 1,
  Uncertain: 2,
  Verified: 3,
};

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileName.textContent = file ? file.name : "No file selected yet.";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const file = fileInput.files?.[0];
  if (!file) {
    showError("Please choose a PDF before starting.");
    return;
  }

  hideError();
  submitButton.disabled = true;
  submitButton.textContent = "Checking...";
  statusTitle.textContent = "Running backend check";
  statusCopy.textContent =
    "Reading the PDF, extracting claims, and checking live evidence now.";
  resultsPanel.classList.add("hidden");
  summaryGrid.classList.add("hidden");
  summaryGrid.innerHTML = "";
  claimsList.innerHTML = "";

  try {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("max_claims", "5");

    const response = await fetch("/api/factcheck", {
      method: "POST",
      body: formData,
    });

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.detail || "The fact-check request failed.");
    }

    renderSummary(payload.summary);
    renderClaims(payload.claims || []);
    resultsTitle.textContent = `Report for ${payload.document}`;
    resultsMeta.textContent = `${payload.summary.total} claims checked in ${payload.processing_seconds}s.`;
    statusTitle.textContent = "Backend complete";
    statusCopy.textContent = `${payload.summary.total} claims checked for ${payload.document}.`;
    resultsPanel.classList.remove("hidden");
  } catch (error) {
    statusTitle.textContent = "Check failed";
    statusCopy.textContent =
      "There was a problem reading the PDF or calling the services.";
    showError(error.message || "Something went wrong.");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Fact-check now";
  }
});

function renderSummary(summary) {
  const metrics = [
    { label: "Total", value: summary.total },
    { label: "Verified", value: summary.Verified },
    { label: "Inaccurate", value: summary.Inaccurate },
    { label: "False", value: summary.False },
    { label: "Uncertain", value: summary.Uncertain },
  ];

  summaryGrid.innerHTML = metrics
    .map(
      (metric) => `
        <article class="metric-card">
          <strong>${metric.value}</strong>
          <span class="muted">${metric.label}</span>
        </article>
      `
    )
    .join("");

  summaryGrid.classList.remove("hidden");
}

function renderClaims(claims) {
  const sortedClaims = [...claims].sort(
    (a, b) => verdictOrder[a.verdict] - verdictOrder[b.verdict]
  );

  claimsList.innerHTML = sortedClaims
    .map((claim) => {
      const verdictClass = claim.verdict.toLowerCase();
      const sources = (claim.sources || [])
        .map(
          (source) => `
            <article class="source-item">
              <a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.title)}</a>
              <p>${escapeHtml(source.snippet)}</p>
            </article>
          `
        )
        .join("");

      const correction = claim.correction
        ? `<div class="correction"><strong>Correction:</strong> ${escapeHtml(claim.correction)}</div>`
        : "";

      return `
        <article class="claim-card">
          <div class="claim-top">
            <div class="claim-tags">
              <div class="pill ${verdictClass}">${claim.verdict}</div>
              <div class="pill uncertain">${escapeHtml(claim.category)}</div>
            </div>
            <span class="muted">Confidence ${claim.confidence}%</span>
          </div>
          <h3>${escapeHtml(claim.claim)}</h3>
          <p>${escapeHtml(claim.summary)}</p>
          ${correction}
          <div class="sources">${sources}</div>
        </article>
      `;
    })
    .join("");
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.classList.remove("hidden");
}

function hideError() {
  errorBox.classList.add("hidden");
  errorBox.textContent = "";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
