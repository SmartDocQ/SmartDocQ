import os
import hashlib
import importlib
import tempfile
import logging

import requests
from flask import Blueprint, request, jsonify, send_file

from config import NODE_BASE_URL, SERVICE_TOKEN, NODE_FETCH_TIMEOUT, FLASK_DEBUG
from db.chroma import collection
from indexing.indexer import index_bytes, index_text, has_index

from state.memory_store import consent_state
from services.retrieval_service import fetch_doc_from_node, fetch_doc_meta_from_node, invalidate_cached_doc_meta
from utils.security import detect_sensitive

document_bp = Blueprint("document", __name__)

logger = logging.getLogger(__name__)

pdf_cache = {}


@document_bp.route("/api/index-from-atlas", methods=["POST"])
def index_from_atlas():
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("documentId") or body.get("doc_id") or "").strip()
    if not doc_id:
        return jsonify({"error": "Missing documentId"}), 400
    try:
        ok, filename, mimetype, data = fetch_doc_from_node(doc_id)
        if not ok:
            return jsonify({"error": filename}), 404

        from utils.extraction import extract_text_for_mimetype
        text = extract_text_for_mimetype(filename, mimetype, data)
        if not text:
            return jsonify({"error": "Unsupported or empty document"}), 400

        meta = fetch_doc_meta_from_node(doc_id) or {}
        file_hash = meta.get("contentHash")
        scan = detect_sensitive(text)
        prev = consent_state.get(doc_id) or {}
        consent_state[doc_id] = {
            "sensitive": bool(scan.get("found")),
            "confirmed": bool(meta.get("consentConfirmed") or prev.get("confirmed", False)),
            "awaiting": False,
            "last_scan": "ok",
            "summary": scan,
        }
        if scan.get("found") and not (meta.get("consentConfirmed") or prev.get("confirmed", False)):
            return jsonify({
                "message": "Sensitive data detected; indexing deferred until consent.",
                "requireConfirmation": True,
                "sensitiveSummary": scan,
                "doc_id": doc_id,
            }), 200

        indexed, added = index_bytes(doc_id, filename, mimetype, data, file_hash=file_hash)
        if not indexed:
            return jsonify({"error": "Unsupported or empty document"}), 400
        # New upload/initial indexing: ensure any cached Node meta is refreshed.
        invalidate_cached_doc_meta(doc_id)
        return jsonify({"message": f"Indexed {added} chunks", "doc_id": doc_id, "requireConfirmation": False})
    except Exception as e:
        logger.exception("Unexpected error in /api/index-from-atlas")
        message = str(e) if FLASK_DEBUG else "An unexpected server error occurred."
        return jsonify({"error": message}), 500


@document_bp.route("/api/convert/word-to-pdf", methods=["POST"])
def convert_word_to_pdf():
    try:
        if "file" not in request.files:
            return jsonify({"error": "No file provided"}), 400
        file = request.files["file"]
        if not file or file.filename == "":
            return jsonify({"error": "No file selected"}), 400

        data = file.read()
        filename = file.filename or "document"
        ext = (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")
        content_type = file.content_type or ""

        if content_type not in (
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ) and ext not in ("doc", "docx"):
            return jsonify({"error": "Not a Word document"}), 415

        try:
            docx2pdf = importlib.import_module("docx2pdf")
        except Exception:
            return jsonify({"error": "docx2pdf not installed on server"}), 501

        from werkzeug.utils import secure_filename
        from pathlib import Path
        import uuid

        safe_display_name = secure_filename(os.path.basename(filename or "document.docx"))
        if not safe_display_name or not safe_display_name.lower().endswith((".docx", ".doc")):
            safe_display_name = "document.docx"

        with tempfile.TemporaryDirectory() as td:
            ext = Path(safe_display_name).suffix.lower()
            safe_name = f"{uuid.uuid4()}{ext}"
            in_path = os.path.join(td, safe_name)
            with open(in_path, "wb") as f:
                f.write(data)
            temp_pdf = os.path.join(td, "converted.pdf")
            docx2pdf.convert(in_path, temp_pdf)
            with open(temp_pdf, "rb") as f:
                pdf_data = f.read()
            from flask import current_app
            out_filename = safe_display_name.rsplit(".", 1)[0] + ".pdf"
            response = current_app.response_class(
                pdf_data,
                mimetype="application/pdf",
                headers={"Content-Disposition": f'attachment; filename="{out_filename}"'},
            )
            return response
    except Exception as e:
        logger.exception("Unexpected error in /api/convert/word-to-pdf")
        message = str(e) if FLASK_DEBUG else "An unexpected server error occurred."
        return jsonify({"error": message}), 500


@document_bp.route("/api/document/preview/<doc_id>.pdf", methods=["GET"])
def preview_word_as_pdf(doc_id):
    try:
        cache_key = f"pdf_preview_{doc_id}"
        if cache_key in pdf_cache:
            cached_path = pdf_cache[cache_key]
            if os.path.exists(cached_path):
                return send_file(cached_path, mimetype="application/pdf", as_attachment=False, download_name="preview.pdf")
            else:
                del pdf_cache[cache_key]

        ok, filename, mimetype, data = fetch_doc_from_node(doc_id)
        if not ok:
            return jsonify({"error": filename}), 404

        ext = (filename.rsplit(".", 1)[-1].lower() if "." in filename else "")
        if mimetype not in (
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ) and ext not in ("doc", "docx"):
            return jsonify({"error": "Not a Word document"}), 415

        try:
            docx2pdf = importlib.import_module("docx2pdf")
        except Exception:
            return jsonify({"error": "docx2pdf not installed on server"}), 501

        cache_dir = os.path.join(os.getcwd(), "pdf_cache")
        os.makedirs(cache_dir, exist_ok=True)
        content_hash = hashlib.md5(data).hexdigest()[:8]
        cached_pdf = os.path.join(cache_dir, f"{doc_id}_{content_hash}.pdf")

        if os.path.exists(cached_pdf):
            pdf_cache[cache_key] = cached_pdf
            return send_file(cached_pdf, mimetype="application/pdf", as_attachment=False, download_name="preview.pdf")

        from werkzeug.utils import secure_filename
        from pathlib import Path
        import uuid

        safe_display_name = secure_filename(os.path.basename(filename or "document.docx"))
        if not safe_display_name or not safe_display_name.lower().endswith((".docx", ".doc")):
            safe_display_name = "document.docx"

        with tempfile.TemporaryDirectory() as td:
            ext = Path(safe_display_name).suffix.lower()
            safe_name = f"{uuid.uuid4()}{ext}"
            in_path = os.path.join(td, safe_name)
            with open(in_path, "wb") as f:
                f.write(data)
            temp_pdf = os.path.join(td, "preview.pdf")
            docx2pdf.convert(in_path, temp_pdf)
            import shutil
            shutil.copy2(temp_pdf, cached_pdf)
            pdf_cache[cache_key] = cached_pdf
            return send_file(cached_pdf, mimetype="application/pdf", as_attachment=False, download_name="preview.pdf")
    except Exception as e:
        logger.exception("Unexpected error in /api/document/preview/<doc_id>.pdf")
        message = str(e) if FLASK_DEBUG else "An unexpected server error occurred."
        return jsonify({"error": message}), 500


@document_bp.route("/api/document/my", methods=["GET"])
def list_docs():
    result = collection.get()
    metas = result.get("metadatas", []) or []
    docs = {}
    for m in metas:
        if not m:
            continue
        doc_id = m.get("doc_id")
        if not doc_id:
            continue
        name = m.get("filename", "unknown")
        if doc_id not in docs:
            ext = (name.rsplit(".", 1)[-1].lower() if "." in name else "text")
            docs[doc_id] = {"_id": doc_id, "name": name, "type": ext, "size": 0}
    return jsonify(list(docs.values()))


@document_bp.route("/api/document/<doc_id>", methods=["PUT"])
def rename_doc(doc_id):
    data = request.get_json(silent=True) or {}
    new_name = data.get("name", "").strip()
    if not new_name:
        return jsonify({"error": "Missing new name"}), 400
    all_meta = collection.get()["metadatas"]
    for m in all_meta:
        if m and m.get("doc_id") == doc_id:
            m["filename"] = new_name
    return jsonify({"message": "Renamed successfully"})


@document_bp.route("/api/document/<doc_id>", methods=["DELETE"])
def delete_doc(doc_id):
    invalidate_cached_doc_meta(doc_id)
    from services.bm25_service import invalidate_all_bm25_versions
    invalidate_all_bm25_versions(doc_id)
    try:
        collection.delete(where={"doc_id": doc_id})
        return jsonify({"success": True, "doc_id": doc_id, "message": "Deleted successfully"}), 200
    except Exception as e:
        logger.exception("Chroma deletion failed in delete_doc for %s: %s", doc_id, e)
        return jsonify({"success": False, "error": str(e)}), 500


@document_bp.route("/api/document/consent", methods=["POST"])
def set_consent():
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("doc_id") or body.get("documentId") or "").strip()
    consent = bool(body.get("consent", False))
    if not doc_id:
        return jsonify({"error": "Missing doc_id"}), 400

    st = consent_state.get(doc_id) or {"sensitive": False, "confirmed": False}
    st["confirmed"] = consent
    st["awaiting"] = False
    consent_state[doc_id] = st

    try:
        requests.post(
            f"{NODE_BASE_URL}/api/document/{doc_id}/consent",
            json={"consent": consent},
            headers={"x-service-token": SERVICE_TOKEN},
            timeout=NODE_FETCH_TIMEOUT,
        )
    except Exception:
        pass

    if consent and not has_index(doc_id):
        ok, filename, mimetype, data_bytes = fetch_doc_from_node(doc_id)
        if not ok:
            return jsonify({"error": filename}), 404
        meta = fetch_doc_meta_from_node(doc_id) or {}
        file_hash = meta.get("contentHash")
        indexed, added = index_bytes(doc_id, filename, mimetype, data_bytes, file_hash=file_hash)
        if not indexed:
            return jsonify({"error": "Unsupported or empty document"}), 400
        # Consent-triggered indexing: refresh meta on next read.
        invalidate_cached_doc_meta(doc_id)
        return jsonify({"message": f"Consent recorded. Indexed {added} chunks.", "requireConfirmation": False})

    if not consent:
        return jsonify({"message": "Consent declined. Please upload a cleaned document.", "requireConfirmation": False})

    return jsonify({"message": "Consent recorded.", "requireConfirmation": False})


@document_bp.route("/api/index/replace-text", methods=["POST"])
def replace_text_index():
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("documentId") or body.get("doc_id") or "").strip()
    text = body.get("text")
    filename = (body.get("filename") or "document.txt").strip()

    if not doc_id:
        return jsonify({"error": "Missing documentId"}), 400
    if text is None:
        return jsonify({"error": "Missing text"}), 400

    # Content is changing (Node updates stored bytes + contentHash before calling this).
    # Ensure next meta read fetches fresh contentHash even if indexing is deferred.
    invalidate_cached_doc_meta(doc_id)

    try:
        scan = detect_sensitive(text or "")
        prev = consent_state.get(doc_id) or {}
        consent_state[doc_id] = {
            "sensitive": bool(scan.get("found")),
            "confirmed": bool(prev.get("confirmed", False)),
            "awaiting": False,
            "last_scan": "ok",
            "summary": scan,
        }
        if scan.get("found") and not prev.get("confirmed", False):
            return jsonify({
                "message": "Sensitive data detected; indexing deferred until consent.",
                "requireConfirmation": True,
                "sensitiveSummary": scan,
                "doc_id": doc_id,
            }), 200

        # Best-effort: attach a bytes hash if Node provides one.
        meta = fetch_doc_meta_from_node(doc_id) or {}
        file_hash = meta.get("contentHash")
        indexed, added = index_text(doc_id, filename, text, file_hash=file_hash)
        if not indexed:
            return jsonify({"error": "Empty text or indexing failed"}), 400
        return jsonify({"message": f"Indexed {added} chunks", "doc_id": doc_id, "requireConfirmation": False})
    except Exception as e:
        logger.exception("Unexpected error in /api/index/replace-text")
        message = str(e) if FLASK_DEBUG else "An unexpected server error occurred."
        return jsonify({"error": message}), 500


def _normalize_cell(val):
    if val is None:
        return ""
    if isinstance(val, bool):
        return val
    if isinstance(val, (int, float)):
        import math
        if math.isnan(val) or math.isinf(val):
            return str(val)
        return val
    import datetime
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.isoformat()
    try:
        return str(val)
    except Exception:
        return ""


@document_bp.route("/api/document/preview/<doc_id>/spreadsheet", methods=["GET"])
def preview_spreadsheet(doc_id):
    try:
        if not doc_id or not doc_id.strip():
            return jsonify({"error": "Missing doc_id"}), 400

        ok, filename, mimetype, data = fetch_doc_from_node(doc_id)
        if not ok:
            return jsonify({"error": filename}), 404

        from utils.extraction import get_document_type
        doc_type = get_document_type(filename, mimetype)

        if doc_type not in ("csv", "xlsx"):
            return jsonify({"error": "Unsupported document type for spreadsheet preview"}), 415

        from utils.table_extraction import extract_tables_for_file
        tables = extract_tables_for_file(filename, mimetype, data, source_key=doc_id)

        # Group and combine tables by sheet
        final_sheets = []
        for t in tables:
            base_sheet_name = t.get("sheet") or "Sheet1"
            headers = [_normalize_cell(h) for h in t.get("headers", [])]
            rows = [[_normalize_cell(cell) for cell in row] for row in t.get("rows", [])]

            matched_entry = None
            for entry in final_sheets:
                if entry["base_name"] == base_sheet_name and entry["headers"] == headers:
                    matched_entry = entry
                    break

            if matched_entry:
                matched_entry["rows"].extend(rows)
            else:
                count = sum(1 for entry in final_sheets if entry["base_name"] == base_sheet_name)
                name = base_sheet_name if count == 0 else f"{base_sheet_name} · Table {count + 1}"
                new_entry = {
                    "base_name": base_sheet_name,
                    "name": name,
                    "headers": headers,
                    "rows": rows,
                }
                final_sheets.append(new_entry)

        # Apply configuration limits
        from config import MAX_PREVIEW_ROWS_PER_SHEET, MAX_PREVIEW_COLUMNS
        sheets_response = []
        for entry in final_sheets:
            all_rows = entry["rows"]
            headers = entry["headers"]

            raw_row_count = len(all_rows)
            raw_col_count = max(len(headers), max((len(r) for r in all_rows), default=0))

            truncated_headers = headers[:MAX_PREVIEW_COLUMNS]
            truncated_rows = [r[:MAX_PREVIEW_COLUMNS] for r in all_rows[:MAX_PREVIEW_ROWS_PER_SHEET]]

            is_truncated = (raw_row_count > MAX_PREVIEW_ROWS_PER_SHEET) or (raw_col_count > MAX_PREVIEW_COLUMNS)

            sheets_response.append({
                "name": entry["name"],
                "headers": truncated_headers,
                "rows": truncated_rows,
                "rowCount": raw_row_count,
                "columnCount": raw_col_count,
                "truncated": is_truncated
            })

        if doc_type == "csv":
            if sheets_response:
                sheets_response[0]["name"] = "CSV"

        return jsonify({
            "type": doc_type,
            "sheets": sheets_response
        })
    except Exception as e:
        logger.exception("Unexpected error in spreadsheet preview endpoint")
        message = str(e) if FLASK_DEBUG else "An unexpected server error occurred."
        return jsonify({"error": message}), 500

