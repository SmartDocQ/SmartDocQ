# SmartDoc Frontend (my-app)

React app created with Create React App and configured for deployment on Vercel. All backend calls use environment variables via `src/config.js`.

## Frontend Features

- **Responsive Document Dashboard**: Beautiful, clean navigation for managing uploaded documents.
- **AI Document Chat Interface**: Ask natural-language questions powered by Hybrid RAG (semantic vector search + BM25 lexical retrieval).
- **Authentication with Secure httpOnly Cookies**: Safe session persistence without JWT client-side storage exposure.
- **Google OAuth Login**: Integrated Google Sign-In with auto-linking of existing emails.
- **Admin Dashboard**: Comprehensive dashboard for viewing active users, documents, and system performance metrics.
- **Drag-and-Drop Document Upload**: Smooth uploading with client-side upload boundary validations.
- **Chat Sharing and PDF Export**: Share read-only snapshots and export public chats directly as PDFs.
- **Internationalization (i18next)**: Multi-language support out of the box.
- **Accessible Modal Dialogs**: Integrated with `focus-trap-react` for WCAG accessibility.

## Environment variables

Configure these in a local `.env` (for local runs) and in Vercel Project Settings → Environment Variables:

- `REACT_APP_API_URL` — Base URL for Node/Express API (e.g., https://api.yourdomain.tld).
- `REACT_APP_MAX_UPLOAD_SIZE_MB` — Maximum upload size displayed and validated by the frontend (default: `15` MB).

See `.env.example` for a template.

## CORS requirements (Node backend)

The Node API must allow the deployed frontend origin with credentials support for httpOnly cookie authentication:

- `Access-Control-Allow-Origin: https://<your-vercel-domain>.vercel.app` (must be exact, not `*`)
- `Access-Control-Allow-Credentials: true`
- `Access-Control-Allow-Headers: Authorization, Content-Type, X-CSRF-Token` *(The backend also accepts `x-service-token` for trusted server-to-server communication with the Flask AI service.)*
- `Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS`
- Properly handle `OPTIONS` preflight responses.

**Note**: All authenticated API requests use the centralized `apiFetch()` helper in `src/config.js`, which automatically includes credentials (`credentials: "include"`), attaches the session CSRF token when required, and handles session expiration consistently.

## Vercel deployment

1. Connect the project to GitHub (Vercel automatically injects `REACT_APP_*` variables during build).
2. In Vercel, import the repo and select `my-app` as the project root if prompted.
3. Set Environment Variables listed above.
4. Build settings:
	- Build Command: `npm run build`
	- Output Directory: `build`
5. Deploy.

## Local development

Create `.env` with your API base URLs, then run:

```bash
npm install
npm start
```

*Note: The frontend communicates only with the Node.js API. The Node gateway must be running and configured to reach the Flask AI service.*

- Shared chat rendering is sanitized with DOMPurify (prevents XSS in shared views).
- Shared chat API calls are centralized in `src/Services/ServiceChat.js`.

## Authentication Security

- **httpOnly Cookie Authentication**: Authentication tokens are stored in secure httpOnly cookies rather than browser storage.
- **Server-Side Session Validation**: Every authenticated request is validated against an active server-side session.
- **Secure Client State Handling**: User data restored from localStorage is validated with `safeParseUser()`, while authentication credentials are never stored client-side.
- **Authentication Rate Limiting**: Login, signup, and password reset endpoints are rate-limited to mitigate brute-force attacks.
- **User Enumeration Protection**: Authentication endpoints return generic error messages to prevent account enumeration.
- **Automatic CSRF Recovery**: Mutating requests automatically recover a missing session-bound CSRF token through the authenticated `/api/auth/csrf` endpoint. Concurrent refreshes are coalesced into a single request to avoid duplicate backend calls.

### Open Graph (WhatsApp/FB) preview image

For professional link previews, `public/index.html` includes Open Graph tags pointing to `/og-preview.png`.

- Ensure `public/og-preview.png` exists (recommended: 1200×630 PNG/JPG, ideally < 300 KB).

## Available Scripts

In the project directory, you can run:

### `npm install`
Installs local project dependencies.

### `npm start`
Runs the app in development mode at [http://localhost:3000](http://localhost:3000).

### `npm run build`
Builds the app for production to the `build` folder, optimizing and minifying the bundles.
