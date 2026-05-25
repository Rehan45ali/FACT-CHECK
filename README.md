# TruthLayer

A fresh Next.js app that splits the frontend and backend cleanly:

- Frontend: `src/app/page.tsx`
- Backend: `src/app/api/factcheck/route.ts`
- Shared logic: `src/lib/*`

It uploads a PDF, extracts claims with Gemini, checks live sources through Tavily, and returns a fact-check report.

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create your local env file:

```bash
copy .env.example .env.local
```

3. Add your API keys to `.env.local`:

```bash
GEMINI_API_KEY=your-gemini-key
TAVILY_API_KEY=your-tavily-key
GEMINI_MODEL=gemini-3.5-flash
```

4. Run the app:

```bash
npm run dev
```

## Build

```bash
npm run build
```

## Deploy to Vercel

1. Push the repo to GitHub.
2. Import the repo in Vercel.
3. Add these environment variables in the Vercel project settings:
   - `GEMINI_API_KEY`
   - `TAVILY_API_KEY`
   - `GEMINI_MODEL` (optional, defaults to `gemini-3.5-flash`)
4. Deploy.

## Notes

- The app keeps secrets server-side only.
- The API route expects a text-based PDF. Scanned or image-only PDFs may not extract enough text.
- Claim extraction is capped so the report stays fast enough for serverless deployment.
