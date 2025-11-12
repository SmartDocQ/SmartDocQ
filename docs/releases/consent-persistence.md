# SmartDocQ Backend Update — Durable Consent Persistence & Gating (v2.1.3)

**Date:** 2025-11-10   
**Module:** Node.js (Express) + Flask backend  
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
     `sensitiveFound`, `consentConfirmed`, `sensitiveSummary`, `lastScanAt`.  
   - Each document now retains its consent state permanently.

2. **Node Backend Enhancements**
   - Enhanced `triggerIndexing` in `document.js` to interpret Flask response states (`awaiting-consent`, `done`, `failed`).  
   - Added a new user consent route:  
     `POST /api/document/:id/consent` — updates MongoDB and re-triggers indexing after user confirmation.  
   - Added an internal metadata endpoint:  
     `GET /api/document/:id/_meta` (service-token secured) for Flask to fetch consent state.

3. **Flask Service Updates**
   - Integrated consent check in `/api/index-from-atlas` using the Node metadata fetcher.  
   - Added `fetch_doc_meta_from_node()` to obtain document consent details from Node.  
   - Added internal persistence handling when Flask receives `/api/document/consent`.  
   - Modified upload and batch upload logic to initiate sensitive scan/index and gracefully handle fallback.

4. **Quality Assurance**
   - All syntax, linter, and runtime checks passed successfully.  
   - End-to-end tests confirmed durable consent persistence across container restarts and redeployments.

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
| `backend/main.py` | Added consent gating and Node metadata fetch |
| `backend/routes/document.js` | Added consent route and indexing logic |
| `models/Document.js` | Added durable consent fields |
| `backend/templates` | Updated workflows for consent-aware processing |

---

**Status:** Completed and Verified  
**Deployment:** Cloud Run (Flask), Render (Node), MongoDB Atlas  
