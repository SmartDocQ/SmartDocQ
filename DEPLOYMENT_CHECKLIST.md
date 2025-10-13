# SmartDocQ Deployment Checklist

This checklist lets you deploy without running anything locally.

## 1) Frontend (my-app on Vercel)
- Project settings → Environment Variables:
  - REACT_APP_API_URL = https://<your-node-api-domain>
  - REACT_APP_PY_API_URL = https://<your-flask-domain>
- Build & Output Settings:
  - Framework Preset: Create React App
  - Root Directory: my-app
- Redeploy.

## 2) Node API (servers/) on your host (Render, Railway, Azure App Service)
- Start command: `npm start`
- Install command: `npm install`
- Environment Variables:
  - PORT = 5000 (or platform default)
  - MONGO_URI = mongodb+srv://<user>:<pass>@<cluster>/<db>?retryWrites=true&w=majority
  - JWT_SECRET = <strong-secret>
  - FRONTEND_ORIGINS = https://<your-vercel-domain>, *.vercel.app
  - SERVICE_TOKEN = <shared-strong-secret>
  - CLOUDINARY_CLOUD_NAME = (optional)
  - CLOUDINARY_API_KEY = (optional)
  - CLOUDINARY_API_SECRET = (optional)
  - CLOUDINARY_AVATAR_FOLDER = smartdoc/avatars (optional)
  - FLASK_ASK_URL = https://<your-flask-domain>/api/document/ask
  - FLASK_INDEX_URL = https://<your-flask-domain>/api/index-from-atlas
  - FLASK_CONVERT_URL = https://<your-flask-domain>/api/convert/word-to-pdf
- After deploy, check: GET https://<your-node-api-domain>/healthz → { "status": "ok" }.

## 3) Flask service (backend/) on your host
- Build: `pip install -r requirements.txt`
- Start command (Gunicorn): `gunicorn main:app --workers 2 --threads 4 --timeout 120`
- Environment Variables:
  - PORT = 5001 (or platform default)
  - FRONTEND_ORIGINS = https://<your-vercel-domain>, *.vercel.app
  - NODE_BASE_URL = https://<your-node-api-domain>
  - SERVICE_TOKEN = <same-as-Node>
  - GEMINI_API_KEY = <your-google-generative-ai-key>
  - TEXT_MODEL = models/gemini-2.5-flash (optional)
  - EMBED_MODEL = models/text-embedding-004 (optional)
- After deploy, check: GET https://<your-flask-domain>/healthz → { "status": "ok" }.

## 4) Order of operations
1. Deploy Node API; confirm /healthz.
2. Deploy Flask; confirm /healthz.
3. Update Vercel envs; redeploy frontend.

## 5) Quick verifications (no local required)
- Upload a Word document → Node stores; Node calls Flask convert → preview works.
- Check My Documents list → processingStatus moves from "queued" → "indexing" → "done".
- Open Chat on a document → ask a question → response from Flask.

## 6) Troubleshooting
- CORS errors: ensure FRONTEND_ORIGINS includes your exact Vercel URL or wildcard .vercel.app.
- 401/403 from Flask doc download: SERVICE_TOKEN must match on Node and Flask.
- Conversion failures: confirm FLASK_CONVERT_URL set and docx2pdf is available; otherwise Word files are stored as-is.

Keep servers/.env.example and backend/.env.example as references for all variables.
