from __future__ import annotations

import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from io import BytesIO
from pathlib import Path
from typing import Any

import requests
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
FRONTEND_DIR = ROOT / "frontend"
STATIC_DIR = FRONTEND_DIR / "static"
DEFAULT_GEMINI_MODEL = "gemini-2.5-flash"

load_dotenv(ROOT / ".env.local", override=False)
load_dotenv(ROOT / ".env", override=False)

app = FastAPI(title="TruthLayer", version="2.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


def post_json(url: str, headers: dict[str, str], payload: dict[str, Any], timeout: int) -> requests.Response:
    session = requests.Session()
    session.trust_env = False
    return session.post(url, headers=headers, json=payload, timeout=timeout)


@app.get("/")
def index() -> FileResponse:
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


def compact_text(value: str, limit: int) -> str:
    return re.sub(r"\s+", " ", value or "").strip()[:limit]


def parse_json_text(raw: str) -> Any:
    cleaned = raw.strip()
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        start_candidates = [idx for idx in (cleaned.find("{"), cleaned.find("[")) if idx != -1]
        start = min(start_candidates, default=-1)
        end = max(cleaned.rfind("}"), cleaned.rfind("]"))
        if start == -1 or end == -1:
            raise
        return json.loads(cleaned[start : end + 1])


def extract_pdf_text(file_bytes: bytes) -> str:
    reader = PdfReader(BytesIO(file_bytes))
    pages: list[str] = []
    for page in reader.pages:
        text = (page.extract_text() or "").replace("\x00", " ").strip()
        if text:
            pages.append(text)
    joined = "\n\n".join(pages)
    joined = re.sub(r"[ \t]+\n", "\n", joined)
    joined = re.sub(r"\n{3,}", "\n\n", joined)
    return joined.strip()


def gemini_models() -> list[str]:
    configured = (os.getenv("GEMINI_MODEL") or "").strip()
    models = [configured] if configured else []
    if DEFAULT_GEMINI_MODEL not in models:
        models.append(DEFAULT_GEMINI_MODEL)
    return models


def call_gemini(prompt: str) -> Any:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is missing.")

    last_error = "Gemini request failed."

    for model in gemini_models():
        try:
            response = post_json(
                f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                headers={
                    "Content-Type": "application/json",
                    "x-goog-api-key": api_key,
                },
                payload={
                    "contents": [{"parts": [{"text": prompt}]}],
                    "generationConfig": {
                        "responseMimeType": "application/json",
                        "temperature": 0.2,
                    },
                },
                timeout=90,
            )
        except requests.RequestException as exc:
            last_error = f"{model}: {exc}"
            if model != DEFAULT_GEMINI_MODEL:
                continue
            break

        if response.ok:
            payload = response.json()
            text_parts: list[str] = []
            for candidate in payload.get("candidates", []):
                for part in candidate.get("content", {}).get("parts", []):
                    if isinstance(part, dict) and part.get("text"):
                        text_parts.append(part["text"])
            if not text_parts:
                last_error = "Gemini returned an empty response."
                continue
            try:
                return parse_json_text("".join(text_parts))
            except json.JSONDecodeError:
                last_error = "Gemini returned invalid JSON."
                continue

        last_error = f"{model}: {response.status_code} {response.text[:300]}"
        if response.status_code in {400, 404} and model != DEFAULT_GEMINI_MODEL:
            continue
        break

    raise HTTPException(status_code=502, detail=last_error)


def extract_claims(pdf_text: str, max_claims: int) -> list[dict[str, Any]]:
    prompt = f"""
Return ONLY a JSON array of factual claims from the document below.

Each item must include:
- claim
- category
- search_query

Rules:
- Extract between 3 and {max_claims} claims.
- Prefer dates, numbers, rankings, launches, funding, percentages, and named factual statements.
- Skip vague marketing language.
- Keep claims concise and specific.

Document:
{pdf_text[:28000]}
""".strip()

    parsed = call_gemini(prompt)
    if not isinstance(parsed, list):
        raise HTTPException(status_code=502, detail="Claim extraction did not return a list.")

    claims: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in parsed:
        if not isinstance(item, dict):
            continue
        claim = compact_text(str(item.get("claim", "")), 280)
        if not claim:
            continue
        dedupe_key = claim.lower()
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        claims.append(
            {
                "id": len(claims) + 1,
                "claim": claim,
                "category": compact_text(str(item.get("category", "Factual")), 40) or "Factual",
                "search_query": compact_text(str(item.get("search_query", claim)), 180) or claim,
            }
        )
        if len(claims) >= max_claims:
            break

    if not claims:
        raise HTTPException(status_code=422, detail="No factual claims were extracted from the PDF.")

    return claims


def tavily_search(query: str) -> dict[str, Any]:
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="TAVILY_API_KEY is missing.")

    try:
        response = post_json(
            "https://api.tavily.com/search",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            payload={
                "query": query,
                "topic": "general",
                "search_depth": "basic",
                "auto_parameters": True,
                "include_answer": "basic",
                "include_raw_content": False,
                "max_results": 5,
            },
            timeout=60,
        )
    except requests.RequestException as exc:
        raise HTTPException(status_code=502, detail=f"Tavily request failed: {exc}") from exc

    if not response.ok:
        raise HTTPException(
            status_code=502,
            detail=f"Tavily request failed: {response.status_code} {response.text[:250]}",
        )

    payload = response.json()
    sources = []
    for item in payload.get("results", [])[:4]:
        sources.append(
            {
                "title": compact_text(str(item.get("title", "Untitled source")), 140),
                "url": str(item.get("url", "")),
                "snippet": compact_text(str(item.get("content", "")), 420),
            }
        )

    answer = payload.get("answer")
    if answer in {None, "None"}:
        answer = ""

    return {"answer": compact_text(str(answer), 500), "sources": sources}


def verify_claim(claim: dict[str, Any]) -> dict[str, Any]:
    search = tavily_search(claim["search_query"])
    sources = search["sources"]

    if not search["answer"] and not sources:
        return {
            "id": claim["id"],
            "claim": claim["claim"],
            "category": claim["category"],
            "verdict": "Uncertain",
            "confidence": 20,
            "summary": "Not enough live evidence was returned for this claim.",
            "correction": None,
            "sources": [],
        }

    evidence_lines = []
    if search["answer"]:
        evidence_lines.append(f"Search summary: {search['answer']}")
    for index, source in enumerate(sources, start=1):
        evidence_lines.append(
            f"[{index}] Title: {source['title']}\nURL: {source['url']}\nSnippet: {source['snippet']}"
        )

    prompt = f"""
Return ONLY a JSON object with:
- verdict: Verified, Inaccurate, False, or Uncertain
- confidence: integer from 0 to 100
- summary: 1 to 3 short sentences
- correction: null or a short corrected version

Use only the evidence below.

Claim:
{claim['claim']}

Evidence:
{os.linesep.join(evidence_lines)}
""".strip()

    result = call_gemini(prompt)
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="Claim verification did not return an object.")

    verdict = str(result.get("verdict", "Uncertain")).strip().title()
    if verdict not in {"Verified", "Inaccurate", "False", "Uncertain"}:
        verdict = "Uncertain"

    confidence = result.get("confidence", 40)
    try:
        confidence = int(confidence)
    except (TypeError, ValueError):
        confidence = 40

    correction = result.get("correction")
    if correction is not None:
        correction = compact_text(str(correction), 240) or None

    return {
        "id": claim["id"],
        "claim": claim["claim"],
        "category": claim["category"],
        "verdict": verdict,
        "confidence": max(0, min(100, confidence)),
        "summary": compact_text(str(result.get("summary", "")), 420) or "No summary was generated.",
        "correction": correction,
        "sources": sources,
    }


def build_summary(results: list[dict[str, Any]]) -> dict[str, int]:
    return {
        "Verified": sum(1 for item in results if item["verdict"] == "Verified"),
        "Inaccurate": sum(1 for item in results if item["verdict"] == "Inaccurate"),
        "False": sum(1 for item in results if item["verdict"] == "False"),
        "Uncertain": sum(1 for item in results if item["verdict"] == "Uncertain"),
        "total": len(results),
    }


@app.post("/api/factcheck")
async def factcheck(
    file: UploadFile = File(...),
    max_claims: int = Form(5),
) -> dict[str, Any]:
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Please upload a PDF file.")

    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail="The uploaded file is empty.")

    started_at = time.perf_counter()
    pdf_text = extract_pdf_text(file_bytes)
    if not pdf_text:
        raise HTTPException(status_code=422, detail="No readable text was found in this PDF.")

    requested_claims = max(3, min(max_claims, 7))
    claims = extract_claims(pdf_text, requested_claims)
    results: list[dict[str, Any]] = []

    with ThreadPoolExecutor(max_workers=min(4, len(claims))) as executor:
        future_map = {executor.submit(verify_claim, claim): claim for claim in claims}
        for future in as_completed(future_map):
            claim = future_map[future]
            try:
                results.append(future.result())
            except HTTPException as exc:
                results.append(
                    {
                        "id": claim["id"],
                        "claim": claim["claim"],
                        "category": claim["category"],
                        "verdict": "Uncertain",
                        "confidence": 20,
                        "summary": str(exc.detail),
                        "correction": None,
                        "sources": [],
                    }
                )
            except Exception as exc:
                results.append(
                    {
                        "id": claim["id"],
                        "claim": claim["claim"],
                        "category": claim["category"],
                        "verdict": "Uncertain",
                        "confidence": 20,
                        "summary": f"Verification failed: {exc}",
                        "correction": None,
                        "sources": [],
                    }
                )

    results.sort(key=lambda item: item["id"])

    return {
        "document": file.filename,
        "processing_seconds": round(time.perf_counter() - started_at, 2),
        "summary": build_summary(results),
        "claims": results,
    }
