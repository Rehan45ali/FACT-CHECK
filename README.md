# FACT CHECK

FACT CHECK now uses a clean Python split:

- `frontend/` for the light UI
- `backend/` for the FastAPI backend
- `app.py` as a tiny Vercel entrypoint

## Local run

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env.local
uvicorn app:app --reload
```

Open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Environment variables

```bash
GEMINI_API_KEY=your-gemini-key
TAVILY_API_KEY=your-tavily-key
GEMINI_MODEL=gemini-2.5-flash
```

## Deploy

Push to GitHub and deploy on Vercel with the same environment variables.
