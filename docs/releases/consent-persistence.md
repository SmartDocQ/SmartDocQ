# SmartDocQ Backend Update — Durable Consent Persistence & Cross-Service Gating (v2.1.3)

**Date:** 2025-11-10   
**Modules:** Node.js (Express, folder: `servers/`) + Flask backend (folder: `backend/`)  
**Category:** Data Governance · Security Compliance · Reliability  

---

## Problem Summary

### Inconsistent Consent Persistence

**Description:**  
Flask’s `consent_state` was maintained in memory within `main.py`.  
This resulted in the following issues:
- State loss on service restarts or redeployments.  
- Out-of-sync consent flags when multiple Flask instances were running in parallel.  
- Race conditions during re-indexing that could allow sensitive data to be processed before user confirmation.

**Impact:**  
- Potential compliance breach due to document processing without consent.  
- Risk of re-indexing sensitive data without user authorization.  
- Integrity issues in data governance under horizontal scaling.  

**Root Cause:**  
Consent approval was not persisted in MongoDB or synchronized between Flask and Node layers.

---

## Implemented Solution — Durable Consent Persistence and Gating

### Summary of Fix  
The volatile in-memory consent mechanism has been replaced with a durable MongoDB-backed system.  
Consent gating now functions across all Flask instances and survives restarts or redeployments.

### Detailed Changes

1. **MongoDB Schema Update**
   - Added persistent fields to the `Document` schema:  
     `sensitiveFound` (Boolean), `consentConfirmed` (Boolean), `sensitiveSummary` (String), `lastScanAt` (Date).  
   - Each document now retains its consent state permanently.

2. **Node Backend Enhancements** (folder: `servers/`)
   - Enhanced indexing flow in `routes/document.js` to interpret Flask response states (`awaiting-consent`, `done`, `failed`).  
   - Added a new user consent route:  
     `POST /api/document/:id/consent` — updates MongoDB and re-triggers indexing after user confirmation.  
   - Added an internal metadata endpoint (for Flask only):  
     `GET /api/document/:id/_meta` — secured via header `x-service-token: <SERVICE_TOKEN>`; Flask uses it to fetch authoritative consent state.  
   - CORS allow-list updated to include `x-service-token` in `servers/server.js` so internal calls are accepted.

3. **Flask Service Updates** (folder: `backend/`)
   - Integrated consent check in `/api/index-from-atlas` by calling the Node metadata endpoint before any indexing.  
   - Added `fetch_doc_meta_from_node()` (sends `x-service-token`) to obtain consent details from Node.  
   - Modified upload and batch upload logic to initiate sensitive scan/index and gracefully handle fallback.

4. **Quality Assurance**
   - All syntax, linter, and runtime checks passed successfully.  
   - End-to-end tests confirmed durable consent persistence across container restarts and redeployments.

---

## API Contract (Quick Reference)

- POST `/api/document/:id/consent`
   - Auth: user token (normal app auth)
   - Body: `{ "consentConfirmed": true }`
   - Effect: Persists consent on the document and re-triggers indexing when `true`.

- GET `/api/document/:id/_meta`
   - Auth: internal service call only  
   - Headers: `x-service-token: <SERVICE_TOKEN>`  
   - Response: `{ sensitiveFound, consentConfirmed, sensitiveSummary, lastScanAt }`

Environment variables
- `SERVICE_TOKEN` (shared secret between Node and Flask for internal calls)
- `MONGO_URI` (MongoDB Atlas)

---

## Result

- Consent state persistence improved from volatile (0% survival on restart) to 100% durable (MongoDB-backed).  
- Sensitive documents remain unindexed until explicit user confirmation is recorded.  
- Race conditions eliminated through synchronized Node–Flask consent management.  
- Horizontal scaling verified as consistent and safe.

**Tested Scenarios:**  
- Single and dual Flask instance configurations.  
- Redeploy and restart recovery tests.  
- Concurrent consent submissions during indexing.

---

## Verification Summary

- Manual and automated testing completed successfully.  
- Verified that sensitive documents remain gated until consent is recorded.  
- Confirmed consistent state propagation across multiple Flask instances.  
- No regression detected in non-sensitive document processing flows.

---

## Summary Table

| Category | Before | After |
|-----------|---------|--------|
| Consent Storage | In-memory (volatile) | MongoDB (durable) |
| Restart Behavior | Lost state | Fully persistent |
| Horizontal Scaling | Unsafe | Consistent across instances |
| Sensitive Gating | Partial | Strict and enforced |
| Compliance Risk | High | Eliminated |
| Race Condition | Possible | Removed |

---

## Commit Reference

**Commit:**  
`feat(consent): persist consent in Mongo and gate indexing until user confirmation`

---

## File Impact Summary

| File | Description |
|------|--------------|
| `backend/main.py` | Flask: consent gating + Node metadata fetch |
| `servers/routes/document.js` | Node: consent route + indexing orchestration |
| `servers/models/Document.js` | Node/Mongoose: durable consent fields |
| `servers/server.js` | CORS allow `x-service-token` for internal calls |

---

**Status:** Completed and Verified  
**Deployment:** Flask (Cloud Run or equivalent), Node (Render/Heroku/VM), MongoDB Atlas  
