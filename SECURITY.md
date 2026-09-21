# SmartDocQ Security Specification

SmartDocQ implements a defense-in-depth security model across its presentation layer (React SPA), business logic server (Node.js/Express), and AI processing layer (Python/Flask).

---

## Security Architecture

### 1. Authentication & Session Management
- **HTTP-Only Cookie Auth**: JWT session tokens are stored in strict `httpOnly`, `sameSite`, and `secure` (in production) cookies (`auth_token`), protecting tokens from client-side XSS extraction.
- **Server-Side Session Validation**: Every JWT payload contains a `sessionId` verified against active server-side `UserSession` records in MongoDB, allowing immediate session invalidation and global revocation ("logout from all devices").
- **Role-Based Access Control (RBAC)**: Endpoint access is enforced by middleware checks requiring explicit user roles (`user`, `admin`, `moderator`). Admin routes check `req.user.isAdmin === true`.
- **User Enumeration Protection**: Auth endpoints (login, password reset) return generic error responses (`Invalid email or password`) to prevent database user existence probing.

### 2. Cross-Site Request Forgery (CSRF) Protection
- **Session-Bound Double-Submit Token Pattern**: State-changing API requests require an `X-CSRF-Token` HTTP header matching the session-bound `csrf_token` cookie.
- **Timing-Safe Token Comparison**: CSRF token validation uses `crypto.timingSafeEqual` to reduce timing-attack risk.
- **Origin & Referer Verification**: State-changing routes verify incoming `Origin` and `Referer` headers against the allowed domain list.
- **Anti-Caching Headers**: Authenticated and CSRF endpoints emit explicit anti-caching response headers (`Cache-Control: no-store`, `Pragma: no-cache`).

### 3. API & Request Protection
- **Centralized Schema Validation**: API payloads are validated with centralized Zod schemas (`servers/validators/`) before controller or database operations.
- **Rate Limiting**:
  - Auth endpoints (login, registration) enforce strict route-level limits (e.g., max 10 failed logins per 15 minutes).
  - Public document sharing and feature APIs enforce sliding window IP/user rate limits via `express-rate-limit`.
- **Hardened Error Handling**: Production environments return generic error messages to clients while logging detailed tracebacks server-side. Stack traces are exposed only when `FLASK_DEBUG=1`.
- **Security Response Headers**: Express uses `helmet` to set standard security headers (`X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Strict-Transport-Security` in production).

### 4. Internal Service Security (Node.js → Flask AI Service)
- **Isolated AI Service Access**: The Python Flask AI service runs as an internal microservice and is not exposed directly to browser clients.
- **Shared Service Token**: All inter-service calls require the `x-service-token` HTTP header matching `SERVICE_TOKEN`.
- **Constant-Time Comparison**: Token checks use `hmac.compare_digest` in Python to reduce timing-attack risk.
- **Audit Context Forwarding**: The Node.js gateway forwards `x-user-id` to Flask for server-side logging without exposing user credentials.

### 5. Document Security & Upload Protection
- **File Type & MIME Validation**: Uploads are validated against permitted MIME types (`application/pdf`, `text/csv`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, etc.).
- **Size Limits**: File uploads are capped at 15 MB (`MAX_UPLOAD_SIZE_MB = 15`).
- **SHA-256 Fingerprinting**: Uploaded document binaries are hashed using SHA-256 to detect duplicates, avoid redundant re-processing, and ensure index integrity.
- **Path Traversal Protection**: File paths are sanitized using strict basename resolution to prevent directory traversal vulnerabilities during extraction and processing.

### 6. Sensitive Data Detection & Privacy
- **Automatic PII Detection**: Pre-processing scanners check document content for sensitive personal data including emails, phone numbers, Aadhaar numbers, PAN identifiers, credit card numbers (Luhn validated), and SSN formats.
- **User Consent Workflow**: Identifies sensitive items and requires explicit user consent before document indexing or sending context to external LLM APIs.

### 7. Prompt Injection & Context Sanitization
- **Prompt Injection Defenses**: User questions are checked against injection and jailbreak heuristics before invoking retrieval or LLM endpoints.
- **Context Sanitization**: Retrieved document content is treated as untrusted input and sanitized before LLM processing (`sanitize_context`).

### 8. Indexing & Data Integrity
- **Versioned Indexing**: Vector and BM25 chunks include metadata hashes (`file_hash`, `pipeline_version`, `chunking_version`).
- **Atomic Shadow Indexing**: Reindexing creates isolated candidate vector generations and activates them via compare-and-swap (CAS) operations, preventing partial index state corruption.
- **Watchdog Recovery**: Optimistic versioning and background maintenance jobs detect and recover stalled indexing tasks.

---

## Security Testing

Run the automated Python security test suite:

```bash
python -m pytest tests/test_security.py -v
```

The test suite covers:
- Service token validation & header enforcement
- Constant-time string comparisons
- Prompt injection & jailbreak threshold scoring
- Input sanitization & HTML/script tag stripping
- Rate limiting and unauthorized access prevention

---

## Recommended Deployment Hardening

1. **Network Isolation**: Deploy the Flask AI service on a private virtual network or bind to `127.0.0.1` so that only the Node.js backend can communicate with it.
2. **Secret Management**: Never hardcode or commit `SERVICE_TOKEN`, `JWT_SECRET`, or API keys (`GEMINI_API_KEY`, `GROQ_API_KEY`, `CEREBRAS_API_KEY`). Inject them via environment variables or secret managers.
3. **HTTPS / TLS Enforcement**: Terminate TLS at a reverse proxy (e.g., Nginx, Cloudflare, Vercel) and enforce HTTPS to secure `httpOnly` auth cookies and CSRF headers.
4. **Disable Debug Mode in Production**: Ensure `FLASK_DEBUG=false` in production environments to prevent sensitive stack trace leakage.
