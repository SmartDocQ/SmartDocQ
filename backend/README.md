# SmartDoc Flask service (backend/)

## Environment variables
Copy `.env.example` to `.env` and fill in:

- PORT: default 5001
- FRONTEND_ORIGINS: comma-separated allowlist for CORS (e.g., http://localhost:3000, https://your-frontend.vercel.app)
- NODE_BASE_URL: URL of Node API for document download (e.g., http://localhost:5000 or your hosted URL)
- SERVICE_TOKEN: must match Node's SERVICE_TOKEN to authorize server-to-server downloads
- GEMINI_API_KEY: Google Generative AI API key
- TEXT_MODEL, EMBED_MODEL: optional overrides

## Install & run
- Create a virtualenv
- pip install -r requirements.txt
- python main.py (defaults to port 5001)

## Health
- GET /healthz returns `{ "status": "ok" }`
