import logging
from utils.extraction import extract_text_for_mimetype
from utils.security import detect_sensitive
from state.memory_store import consent_state

logger = logging.getLogger(__name__)

def run_background_index(doc_id: str, *, indexing_lock, indexing_in_progress):
    from services.retrieval_service import fetch_doc_from_node, fetch_doc_meta_from_node

    try:
        # Load meta first to check for consentConfirmed
        meta = fetch_doc_meta_from_node(doc_id) or {}
        consent_confirmed = bool(meta.get("consentConfirmed", False))

        ok, filename, mimetype, data_bytes = fetch_doc_from_node(doc_id)
        if not ok:
            return

        ext = (filename.rsplit(".", 1)[-1].lower() if "." in (filename or "") else "")
        is_pdf = (mimetype == "application/pdf" or ext == "pdf")

        pre_extracted_pages = None
        pre_extracted_text = None

        if is_pdf:
            from utils.extraction import extract_pdf
            pre_extracted_pages = extract_pdf(data_bytes)
            text_for_scan = "\n".join(p["text"] for p in pre_extracted_pages) if pre_extracted_pages else ""
        else:
            text_for_scan = extract_text_for_mimetype(filename, mimetype, data_bytes)
            pre_extracted_text = text_for_scan

        if not text_for_scan:
            return

        scan = detect_sensitive(text_for_scan)
        prev = consent_state.get(doc_id) or {}
        sensitive = bool(scan.get("found"))
        confirmed = consent_confirmed or bool(prev.get("confirmed", False))
        awaiting = sensitive and not confirmed

        consent_state[doc_id] = {
            "sensitive": sensitive,
            "confirmed": confirmed,
            "awaiting": awaiting,
            "last_scan": "ok",
            "summary": scan,
        }

        if awaiting:
            logger.warning("[Background Reindex] Document %s awaiting consent. Skipping index.", doc_id)
            return

        file_hash = meta.get("contentHash")

        from indexing.indexer import index_bytes

        index_bytes(
            doc_id,
            filename,
            mimetype,
            data_bytes,
            file_hash=file_hash,
            pre_extracted_pages=pre_extracted_pages,
            pre_extracted_text=pre_extracted_text,
        )

    except Exception as e:
        logger.exception("Background indexing failed for %s: %s", doc_id, e)

    finally:
        with indexing_lock:
            indexing_in_progress.discard(doc_id)