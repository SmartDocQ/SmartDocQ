import threading
import requests
import logging
import hashlib
import uuid
from db.chroma import collection
from config import (
    SERVICE_TOKEN,
    CHUNK_UPSERT_URL,
    NODE_FETCH_TIMEOUT,
    INDEX_PIPELINE_VERSION,
    INDEX_BATCH_SIZE,
)
import utils.extraction as extraction
from utils.extraction import extract_text_for_mimetype
from services.bm25_service import build_bm25_index, invalidate_bm25_index
from indexing.chunking import split_sheet_sections
from utils.table_extraction import extract_tables_for_file
from indexing.background import run_background_index
from state.memory_store import consent_state
from utils.security import detect_sensitive

# Re-export core processing elements for dynamic test resolution and monkeypatching
from indexing.pipeline import (
    _index_blocks_pipeline,
    _index_sections_spreadsheet,
    _index_tables_spreadsheet,
    _build_contextual_header,
    _flush_batch,
    _is_noise,
    MAX_MD_META_LEN,
    IndexBuildError,
)
from services.vector_versioning import (
    mark_index_building,
    activate_index_version,
    mark_index_failed,
    validate_index_version,
    cleanup_old_versions,
    delete_index_version,
)

logger = logging.getLogger(__name__)

# ===== PUBLIC APIS & ORCHESTRATION =====

def has_index(doc_id: str) -> bool:
    """Check if the document has a valid active index (versioned or legacy fallback)."""
    from services.vector_versioning import get_index_state, has_legacy_chunks
    state = get_index_state(doc_id)
    active_version = state.get("activeVersion")
    if active_version:
        return True
    return has_legacy_chunks(doc_id)

def _push_chunks_to_node(doc_id: str, filename: str, chunk_records: list, index_version: str, tables: list | None = None):
    if not chunk_records:
        return
    payload = {
        "doc_id": doc_id,
        "filename": filename,
        "indexVersion": index_version,
        "chunks": chunk_records,
        "tables": tables if tables is not None else [],
    }
    headers = {"Content-Type": "application/json", "x-service-token": SERVICE_TOKEN}
    try:
        r = requests.post(CHUNK_UPSERT_URL, json=payload, headers=headers, timeout=NODE_FETCH_TIMEOUT)
        if r.status_code >= 300:
            raise IndexBuildError(f"Node chunk upsert returned {r.status_code}: {r.text}")
    except Exception as e:
        if isinstance(e, IndexBuildError):
            raise
        raise IndexBuildError(f"Node chunk upsert failed: {e}")


def _sync_bm25(doc_id: str, chunk_records: list, index_version: str, file_hash: str | None = None):
    bm25_chunks = [
        {
            "chunk_id": f"{doc_id}:{index_version}:{r['chunk']}",
            "text": r["text"],
            "is_table": bool(r.get("is_table", False)),
        }
        for r in chunk_records
    ]
    build_bm25_index(doc_id, bm25_chunks, index_version, file_hash=file_hash)


def _finalize_index(doc_id: str, filename: str, chunk_records: list, index_version: str, tables: list | None = None, file_hash: str | None = None):
    _push_chunks_to_node(doc_id, filename, chunk_records, index_version, tables)
    _sync_bm25(doc_id, chunk_records, index_version, file_hash=file_hash)

def _extract_tables_for_document(doc_id: str, filename: str, mimetype: str, data: bytes):
    try:
        return extract_tables_for_file(filename, mimetype, data, source_key=doc_id)
    except Exception:
        return []

def _index_document_by_type(
    doc_type: str,
    doc_id: str,
    filename: str,
    mimetype: str,
    data: bytes,
    tables: list,
    chunk_records: list,
    index_version: str,
    file_hash: str | None = None,
):
    match doc_type:
        case "pdf":
            return _index_pdf_document(doc_id, filename, data, tables, chunk_records, index_version, file_hash=file_hash)
        case "docx" | "doc":
            return _index_docx_document(doc_id, filename, data, tables, chunk_records, index_version, file_hash=file_hash)
        case "txt":
            return _index_txt_document(doc_id, filename, data, tables, chunk_records, index_version, file_hash=file_hash)
        case "csv" | "xlsx":
            return _index_sheet_document(doc_id, filename, doc_type, mimetype, data, tables, chunk_records, index_version, file_hash=file_hash)
        case _:
            return False, 0

def _index_text_document(
    doc_id: str,
    filename: str,
    source_type: str,
    pages: list,
    tables: list,
    chunk_records: list,
    index_version: str,
    file_hash: str | None = None,
):
    if not pages and not tables:
        return False, 0

    added = 0
    next_chunk_index = 0

    if pages:
        added_text, next_chunk_index = _index_blocks_pipeline(
            doc_id,
            filename,
            source_type,
            pages,
            chunk_records,
            index_version,
            file_hash=file_hash,
        )
        added += added_text

    if tables:
        added += _index_tables_spreadsheet(
            doc_id,
            filename,
            source_type,
            tables,
            start_chunk_index=next_chunk_index,
            chunk_records_out=chunk_records,
            index_version=index_version,
            file_hash=file_hash,
        )

    return True, added

def _index_pdf_document(doc_id: str, filename: str, data: bytes, tables: list, chunk_records: list, index_version: str, file_hash: str | None = None):
    pages = extraction.extract_pdf(data)
    return _index_text_document(doc_id, filename, "pdf", pages, tables, chunk_records, index_version, file_hash=file_hash)

def _index_docx_document(doc_id: str, filename: str, data: bytes, tables: list, chunk_records: list, index_version: str, file_hash: str | None = None):
    text = extraction.extract_docx(data)
    pages = [{"page": 1, "text": text}] if text.strip() else []
    return _index_text_document(doc_id, filename, "docx", pages, tables, chunk_records, index_version, file_hash=file_hash)

def _index_txt_document(doc_id: str, filename: str, data: bytes, tables: list, chunk_records: list, index_version: str, file_hash: str | None = None):
    text = extraction.extract_txt(data)
    pages = [{"page": 1, "text": text}] if text.strip() else []
    return _index_text_document(doc_id, filename, "txt", pages, tables, chunk_records, index_version, file_hash=file_hash)

def _index_sheet_document(doc_id: str, filename: str, doc_type: str, mimetype: str, data: bytes, tables: list, chunk_records: list, index_version: str, file_hash: str | None = None):
    text = extract_text_for_mimetype(filename, mimetype, data)
    if not text and not tables:
        return False, 0

    sections = split_sheet_sections(text) if text else [(None, "")]
    added_text = 0
    next_chunk_index = 0

    if text:
        added_text, next_chunk_index = _index_sections_spreadsheet(
            doc_id,
            filename,
            doc_type,
            sections,
            chunk_records,
            index_version,
            file_hash=file_hash,
        )

    added_tables = _index_tables_spreadsheet(
        doc_id,
        filename,
        doc_type,
        tables,
        start_chunk_index=next_chunk_index,
        chunk_records_out=chunk_records,
        index_version=index_version,
        file_hash=file_hash,
    )
    return True, added_text + added_tables

def index_bytes(
    doc_id: str,
    filename: str,
    mimetype: str,
    data: bytes,
    file_hash: str | None = None,
):
    doc_type = extraction.get_document_type(filename, mimetype)

    if file_hash is None and data:
        try:
            file_hash = hashlib.sha256(data).hexdigest()
        except Exception:
            file_hash = None

    index_version = str(uuid.uuid4())
    logger.info("[Indexer] Starting index build for doc %s with version %s", doc_id, index_version)

    if not mark_index_building(doc_id, index_version, file_hash):
        logger.error("[Indexer] Failed to mark index building for doc %s version %s", doc_id, index_version)
        return False, 0

    chunk_records = []
    try:
        tables = _extract_tables_for_document(doc_id, filename, mimetype, data)
        ok, added = _index_document_by_type(
            doc_type,
            doc_id,
            filename,
            mimetype,
            data,
            tables,
            chunk_records,
            index_version,
            file_hash=file_hash,
        )

        if not ok:
            raise IndexBuildError("Indexing returned not ok")

        _finalize_index(doc_id, filename, chunk_records, index_version, tables, file_hash=file_hash)

        if not validate_index_version(doc_id, index_version, expected_chunks=added, file_hash=file_hash):
            raise IndexBuildError("Index validation failed")

        if not activate_index_version(doc_id, index_version):
            raise IndexBuildError("Index activation failed")

        from services.vector_versioning import get_index_state
        state = get_index_state(doc_id)
        active = state.get("activeVersion")
        previous = state.get("previousVersion")
        cleanup_old_versions(doc_id, active, previous)

        return True, added

    except Exception as e:
        logger.error("[Indexer] Index build failed for doc %s version %s: %s", doc_id, index_version, e)
        mark_index_failed(doc_id, index_version, reason=str(e))
        delete_index_version(doc_id, index_version)
        return False, 0

def index_text(doc_id: str, filename: str, text: str, file_hash: str | None = None):
    """Low-level indexing helper."""
    text = (text or "").strip()
    if not text:
        return False, 0

    filename = filename or "document.txt"
    source_type = "txt"

    index_version = str(uuid.uuid4())
    logger.info("[Indexer] Starting index_text build for doc %s with version %s", doc_id, index_version)

    if not mark_index_building(doc_id, index_version, file_hash):
        logger.error("[Indexer] Failed to mark index building for doc %s version %s", doc_id, index_version)
        return False, 0

    pages = [{"page": 1, "text": text}]
    chunk_records = []

    try:
        added, _ = _index_blocks_pipeline(
            doc_id,
            filename,
            source_type,
            pages,
            chunk_records,
            index_version,
            file_hash=file_hash,
        )

        _finalize_index(doc_id, filename, chunk_records, index_version, [], file_hash=file_hash)

        if not validate_index_version(doc_id, index_version, expected_chunks=added, file_hash=file_hash):
            raise IndexBuildError("Index validation failed")

        if not activate_index_version(doc_id, index_version):
            raise IndexBuildError("Index activation failed")

        from services.vector_versioning import get_index_state
        state = get_index_state(doc_id)
        active = state.get("activeVersion")
        previous = state.get("previousVersion")
        cleanup_old_versions(doc_id, active, previous)

        return True, added

    except Exception as e:
        logger.error("[Indexer] Index_text build failed for doc %s version %s: %s", doc_id, index_version, e)
        mark_index_failed(doc_id, index_version, reason=str(e))
        delete_index_version(doc_id, index_version)
        return False, 0

_indexing_in_progress = set()
_indexing_lock = threading.Lock()

def start_background_indexing(doc_id: str):
    with _indexing_lock:
        if doc_id in _indexing_in_progress:
            return
        _indexing_in_progress.add(doc_id)

    th = threading.Thread(
        target=run_background_index,
        kwargs={
            "doc_id": doc_id,
            "indexing_lock": _indexing_lock,
            "indexing_in_progress": _indexing_in_progress,
        },
        daemon=True,
    )
    th.start()