"""Comprehensive unit tests for indexing/indexer.py

Covers:
1. _is_noise()
2. Deduplication
3. Metadata validation
4. Reindex replacement
5. Unsupported file handling
6. Empty document handling
7. Background indexing concurrency
8. Batch flushing (>64 chunks)
9. Node chunk sync
10. Timestamp format validation

Run:
    cd backend
    python -m pytest tests/test_indexer.py -v
"""

from __future__ import annotations

from datetime import datetime
import threading
import sys
import types

import pytest
import indexing.chunking as chunking_mod
import indexing.pipeline as pipeline

# ---------------------------------------------------------------------------
# Stub db.chroma BEFORE importing indexer to prevent real Chroma initialization
# ---------------------------------------------------------------------------

class _ImportCollectionStub:
    def upsert(self, *args, **kwargs):
        pass

    def get(self, *args, **kwargs):
        return {"ids": [], "documents": [], "metadatas": []}

    def delete(self, *args, **kwargs):
        pass

fake_db_chroma = types.ModuleType("db.chroma")
fake_db_chroma.collection = _ImportCollectionStub()

# Inject the fake module into Python's import system
sys.modules["db.chroma"] = fake_db_chroma

# Now this import is safe
from indexing import indexer  # noqa: E402
from indexing.pipeline import IndexBuildError

# ============================================================================
# Fake Chroma Collection
# ============================================================================

class FakeCollection:
    """Minimal in-memory replacement for the Chroma collection used by indexer."""

    def __init__(self):
        self.store: dict[str, dict] = {}  # id -> {document, metadata, embedding}
        self.upsert_calls = 0

    def upsert(self, embeddings, documents, metadatas, ids):
        self.upsert_calls += 1
        for emb, doc, meta, _id in zip(embeddings, documents, metadatas, ids):
            self.store[_id] = {"embedding": emb, "document": doc, "metadata": meta}

    def get(self, where=None, ids=None, **_kwargs):
        # get by explicit ids
        if ids is not None:
            result_ids, result_docs, result_metas = [], [], []
            for _id in ids:
                if _id in self.store:
                    result_ids.append(_id)
                    result_docs.append(self.store[_id]["document"])
                    result_metas.append(self.store[_id]["metadata"])
            return {"ids": result_ids, "documents": result_docs, "metadatas": result_metas}

        # filter by doc_id
        if where and "doc_id" in where:
            doc_id = where["doc_id"]
            result_ids, result_docs, result_metas = [], [], []
            for _id, item in self.store.items():
                if item["metadata"].get("doc_id") == doc_id:
                    result_ids.append(_id)
                    result_docs.append(item["document"])
                    result_metas.append(item["metadata"])
            return {"ids": result_ids, "documents": result_docs, "metadatas": result_metas}

        # return all
        return {
            "ids": list(self.store.keys()),
            "documents": [v["document"] for v in self.store.values()],
            "metadatas": [v["metadata"] for v in self.store.values()],
        }

    def delete(self, ids=None, **_kwargs):
        # Chroma uses keyword argument `ids=...`.
        for _id in (ids or []):
            self.store.pop(_id, None)

@pytest.fixture(autouse=True)
def mock_vector_versioning_lifecycle(monkeypatch, fake_collection):
    """Automatically mock all vector versioning lifecycle hooks for indexer tests."""
    def mock_get_state(doc_id):
        return {
            "activeVersion": None,
            "previousVersion": None,
            "activeMetadata": {},
            "build": {}
        }

    def mock_cleanup(doc_id, active, previous):
        # In unit tests, we want to simulate old versions deletion
        # Keep active and previous. If active is None, keep the newest version in the store.
        keep = {active, previous}
        doc_versions = []
        for _id, item in fake_collection.store.items():
            meta = item.get("metadata") or {}
            if meta.get("doc_id") == doc_id:
                v = meta.get("index_version")
                if v:
                    doc_versions.append(v)
        if not active and doc_versions:
            keep.add(doc_versions[-1])

        to_del = []
        for _id, item in list(fake_collection.store.items()):
            meta = item.get("metadata") or {}
            if meta.get("doc_id") == doc_id:
                if meta.get("index_version") not in keep:
                    to_del.append(_id)
        for _id in to_del:
            fake_collection.store.pop(_id, None)

    import services.vector_versioning as vv
    monkeypatch.setattr(vv, "get_index_state", mock_get_state)
    monkeypatch.setattr(vv, "mark_index_building", lambda *a, **k: True)
    monkeypatch.setattr(vv, "activate_index_version", lambda *a, **k: True)
    monkeypatch.setattr(vv, "mark_index_failed", lambda *a, **k: True)
    monkeypatch.setattr(vv, "validate_index_version", lambda *a, **k: True)
    monkeypatch.setattr(vv, "delete_index_version", lambda *a, **k: None)
    monkeypatch.setattr(vv, "cleanup_old_versions", mock_cleanup)

    monkeypatch.setattr(indexer, "mark_index_building", lambda *a, **k: True)
    monkeypatch.setattr(indexer, "activate_index_version", lambda *a, **k: True)
    monkeypatch.setattr(indexer, "mark_index_failed", lambda *a, **k: True)
    monkeypatch.setattr(indexer, "validate_index_version", lambda *a, **k: True)
    monkeypatch.setattr(indexer, "delete_index_version", lambda *a, **k: None)
    monkeypatch.setattr(indexer, "cleanup_old_versions", mock_cleanup)


@pytest.fixture
def fake_collection(monkeypatch) -> FakeCollection:
    """Replace indexer's Chroma collection with an in-memory fake."""

    coll = FakeCollection()
    monkeypatch.setattr(indexer, "collection", coll)
    monkeypatch.setattr(pipeline, "collection", coll)
    monkeypatch.setattr("services.vector_versioning.collection", coll)
    monkeypatch.setattr("services.retrieval_service.collection", coll)
    return coll

@pytest.fixture
def mock_embedding(monkeypatch):
    """Replace Gemini embeddings with deterministic vectors."""

    monkeypatch.setattr(pipeline, "embed_document", lambda *_a, **_k: [0.1, 0.2, 0.3])

@pytest.fixture
def disable_node_push(monkeypatch):
    """Prevent outbound HTTP calls to the Node service."""

    monkeypatch.setattr(indexer, "_push_chunks_to_node", lambda *_args, **_kwargs: None)

@pytest.fixture
def clean_indexing_state():
    """Ensure global background-indexing state is restored after each test."""

    original = set(indexer._indexing_in_progress)
    indexer._indexing_in_progress.clear()
    yield
    indexer._indexing_in_progress.clear()
    indexer._indexing_in_progress.update(original)

@pytest.fixture
def clean_consent_state():
    """Ensure consent_state mutations from run_background_index don't leak across tests."""

    original = dict(indexer.consent_state)
    indexer.consent_state.clear()
    yield
    indexer.consent_state.clear()
    indexer.consent_state.update(original)

# ============================================================================
# 1. _is_noise() Tests
# ============================================================================

@pytest.mark.parametrize(
    "text, expected",
    [
        ("", True),
        ("Figure 1", True),
        ("12345", True),  # single token with no alphabetic characters
        ("Hello", True),  # too short
        ("Team 06", False),  # identifier-heavy structured chunk
        ("23CD7A09XY", False),  # academic/project identifier
        ("This is a meaningful paragraph. " * 10, False),
    ],
)
def test_is_noise(text, expected):
    assert indexer._is_noise(text) is expected

def test_is_noise_junk_pattern_three_words():
    assert indexer._is_noise("See Table 3") is True


def test_is_noise_four_word_phrase_not_flagged_when_thresholds_are_met():
    text = (
        "This is a sufficiently long sentence containing See Figure 1 below "
        "with enough words to exceed the minimum thresholds."
    )
    assert indexer._is_noise(text) is False

# ============================================================================
# 2. Deduplication Tests
# ============================================================================

def test_deduplication(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    chunk = "Python is great and useful for scripting. " * 10
    # Isolate dedup from sheet-parsing and chunking heuristics.
    monkeypatch.setattr(indexer, "split_sheet_sections", lambda _text: [(None, "dummy")])
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [chunk, chunk])

    ok, added = indexer.index_text("doc1", "test.txt", "ignored")

    assert ok is True
    assert added == 1
    assert len(fake_collection.store) == 1

# ============================================================================
# 3. Metadata Validation Tests
# ============================================================================

def test_metadata_validation(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    body = "This is a sufficiently long paragraph for metadata testing. " * 10
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_text("doc2", "sample.txt", body)

    assert ok is True
    assert added == 1

    item = next(iter(fake_collection.store.values()))
    meta = item["metadata"]

    required_keys = {
        "doc_id",
        "chunk",
        "filename",
        "embedding_model",
        "indexed_at",
        "pipeline_version",
    }

    assert required_keys.issubset(meta.keys())
    assert meta["pipeline_version"] == indexer.INDEX_PIPELINE_VERSION

def test_file_hash_stored_in_metadata_when_provided(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    body = "This is a sufficiently long paragraph for file hash testing. " * 10
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_text("doc_hash", "sample.txt", body, file_hash="deadbeef")

    assert ok is True
    assert added == 1

    meta = next(iter(fake_collection.store.values()))["metadata"]
    assert meta.get("file_hash") == "deadbeef"

# ============================================================================
# Contextual Chunk Headers (CCH) Tests
# ============================================================================

def test_build_contextual_header_filename_only():
    header = indexer._build_contextual_header("notes.pdf")
    assert header == "Document: notes.pdf"


def test_build_contextual_header_with_sheet():
    header = indexer._build_contextual_header("report.xlsx", sheet_name="Revenue")
    assert header == "Document: report.xlsx\nSheet: Revenue"


def test_build_contextual_header_empty_filename():
    header = indexer._build_contextual_header("")
    assert header == "Document: document"


def test_index_sections_passes_contextual_header_to_embeddings(
    fake_collection, disable_node_push, monkeypatch
):
    captured = {}

    def capture_embedding_input(text, title=None, context=None, timeout_sec=20):
        captured["text"] = text
        captured["title"] = title
        captured["context"] = context
        return [0.1, 0.2, 0.3]

    monkeypatch.setattr(pipeline, "embed_document", capture_embedding_input)

    chunk = "This is a sufficiently long paragraph to be indexed. " * 20

    # Isolate behavior from sheet-parsing and chunking heuristics.
    monkeypatch.setattr(indexer, "split_sheet_sections", lambda _text: [(None, "dummy")])
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [chunk])

    ok, added = indexer.index_text("doc_cch", "sample.txt", "ignored")
    assert ok is True
    assert added == 1

    assert captured["title"] == "sample.txt"
    assert captured["text"] == chunk.strip()

    stored = next(iter(fake_collection.store.values()))["document"]
    assert stored == chunk.strip()
    assert "Document:" not in stored

def test_chunk_header_saved_in_metadata(fake_collection, disable_node_push, monkeypatch):
    monkeypatch.setattr(pipeline, "embed_document", lambda *_a, **_k: [0.1, 0.2, 0.3])

    chunk = "This is a sufficiently long paragraph for metadata testing. " * 20
    monkeypatch.setattr(indexer, "split_sheet_sections", lambda _text: [(None, "dummy")])
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [chunk])

    ok, added = indexer.index_text("doc_cch_meta", "sample.txt", "ignored")
    assert ok is True
    assert added == 1

    meta = next(iter(fake_collection.store.values()))["metadata"]
    assert "chunk_header" in meta
    assert meta["chunk_header"] == "Document: sample.txt"

def test_chunk_header_with_sheet_saved_in_metadata(fake_collection, disable_node_push, monkeypatch):
    monkeypatch.setattr(pipeline, "embed_document", lambda *_a, **_k: [0.1, 0.2, 0.3])

    chunk = "This is a sufficiently long paragraph for sheet header testing. " * 20
    monkeypatch.setattr(chunking_mod, "chunk_text", lambda _body: [chunk])

    chunk_records = []
    added, next_chunk_index = indexer._index_sections_spreadsheet(
        "doc_cch_sheet",
        "report.xlsx",
        "xlsx",
        [("Revenue", "dummy")],
        chunk_records,
        "v1",
    )
    assert added == 1
    assert next_chunk_index == 1

    meta = next(iter(fake_collection.store.values()))["metadata"]
    assert "chunk_header" in meta
    assert meta["chunk_header"] == "Document: report.xlsx\nSheet: Revenue"

# ============================================================================
# 10. Timestamp Format Test
# ============================================================================

def test_timestamp_format(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    body = "Timestamp validation paragraph. " * 20
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    indexer.index_text("doc3", "time.txt", body)

    res = fake_collection.get(where={"doc_id": "doc3"})
    assert len(res["ids"]) > 0
    ts = res["metadatas"][0]["indexed_at"]

    parsed = datetime.fromisoformat(ts)

    # indexer uses timezone-aware UTC timestamps
    assert parsed.tzinfo is not None

# ============================================================================
# 4. Reindex Replacement Test
# ============================================================================

def test_reindex_replaces_existing(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    text1 = "First version of the document. " * 20
    text2 = "Second version with different content. " * 20

    def pack_current_text(sections):
        current_text = sections[0]["blocks"][0]["content"] if sections and sections[0].get("blocks") else text1
        return [current_text]

    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", pack_current_text)

    ok1, added1 = indexer.index_text("doc4", "file.txt", text1)
    assert ok1 is True
    assert added1 == 1
    assert len(fake_collection.store) == 1

    ok2, added2 = indexer.index_text("doc4", "file.txt", text2)
    assert ok2 is True
    assert added2 == 1

    res = fake_collection.get(where={"doc_id": "doc4"})
    assert len(res["ids"]) == 1

    # Ensure old content is fully removed (not just chunk-id reused)
    for item in fake_collection.store.values():
        assert "First version" not in item["document"]
    assert any("Second version" in item["document"] for item in fake_collection.store.values())

# ============================================================================
# 5. Unsupported File Test
# ============================================================================

def test_unsupported_file_type():
    ok, added = indexer.index_bytes(
        doc_id="doc5",
        filename="image.png",
        mimetype="image/png",
        data=b"fake image bytes",
    )

    assert ok is False
    assert added == 0

# ============================================================================
# 6. Empty Document Tests
# ============================================================================

def test_empty_text_document():
    ok, added = indexer.index_text("doc6", "empty.txt", "")
    assert ok is False
    assert added == 0

def test_whitespace_only_document():
    ok, added = indexer.index_text("doc7", "blank.txt", "     \n\n   ")
    assert ok is False
    assert added == 0

# ============================================================================
# 9. Node Chunk Sync Test
# ============================================================================

def test_push_chunks_called(fake_collection, mock_embedding, monkeypatch):
    captured = {}

    def fake_push(doc_id, filename, chunk_records, *args, **kwargs):
        captured["doc_id"] = doc_id
        captured["filename"] = filename
        captured["chunks"] = chunk_records

    monkeypatch.setattr(indexer, "_push_chunks_to_node", fake_push)

    body = "Node sync validation content. " * 20
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_text("doc8", "sync.txt", body)

    assert ok is True
    assert added == 1

    assert captured["doc_id"] == "doc8"
    assert captured["filename"] == "sync.txt"
    assert isinstance(captured["chunks"], list)
    assert len(captured["chunks"]) == 1
    assert "text" in captured["chunks"][0]

# ============================================================================
# 8. Batch Flush Test (>64 chunks)
# ============================================================================

def test_batch_flush_multiple_upserts(
    fake_collection, mock_embedding, disable_node_push, monkeypatch
):
    # Create >INDEX_BATCH_SIZE unique valid chunks so we force multiple flushes.
    total_chunks = indexer.INDEX_BATCH_SIZE + 6
    chunks = [
        (f"This is a sufficiently long unique chunk number {i}. " * 10)
        for i in range(total_chunks)
    ]

    # Isolate batching from sheet-parsing and chunking heuristics.
    monkeypatch.setattr(indexer, "split_sheet_sections", lambda _text: [(None, "dummy")])
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: chunks)

    batch_sizes = []
    original_flush = indexer._flush_batch

    def capture_flush(collection_ref, batch_embeddings, batch_documents, batch_metadatas, batch_ids):
        batch_sizes.append(len(batch_ids))
        return original_flush(collection_ref, batch_embeddings, batch_documents, batch_metadatas, batch_ids)

    monkeypatch.setattr(pipeline, "_flush_batch", capture_flush)

    ok, added = indexer.index_text("doc9", "batch.txt", "ignored")

    assert ok is True
    assert added == total_chunks

    # BATCH_SIZE = INDEX_BATCH_SIZE => should flush twice (BATCH_SIZE + 6)
    assert fake_collection.upsert_calls == 2
    assert batch_sizes == [indexer.INDEX_BATCH_SIZE, 6]
    assert len(fake_collection.store) == total_chunks

# ============================================================================
# 7. Background Indexing Concurrency Test
# ============================================================================

def test_start_background_indexing_starts_only_one_thread(monkeypatch, clean_indexing_state):
    started = []

    class FakeThread:
        def __init__(self, target=None, args=(), kwargs=None, daemon=None):
            self.target = target
            self.args = args
            self.kwargs = kwargs or {}
            self.daemon = daemon

        def start(self):
            started.append(self.kwargs.get("doc_id"))
            # Simulate work still in progress by NOT calling target().

    monkeypatch.setattr(indexer.threading, "Thread", FakeThread)

    indexer.start_background_indexing("doc10")
    indexer.start_background_indexing("doc10")

    assert started == ["doc10"]

# ============================================================================
# Additional coverage: has_index(), index_bytes() supported types,
# sheet metadata, embedding failures.
# ============================================================================

def test_has_index(fake_collection):
    fake_collection.store["doc_0"] = {
        "document": "text",
        "metadata": {"doc_id": "doc"},
        "embedding": [0.1],
    }

    assert indexer.has_index("doc") is True
    assert indexer.has_index("missing") is False

def test_index_bytes_txt_supported(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    body = "This is a sufficiently long valid text paragraph. " * 20
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_bytes(
        "doc_txt",
        "sample.txt",
        "text/plain",
        (body).encode("utf-8"),
    )

    assert ok is True
    assert added == 1
    assert len(fake_collection.store) == 1

def test_index_bytes_pdf_supported(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    body = "This is PDF extracted text. " * 20
    import utils.extraction as extraction_mod

    monkeypatch.setattr(extraction_mod, "extract_pdf", lambda _data: [{"page": 1, "text": body}])
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_bytes(
        "doc_pdf",
        "sample.pdf",
        "application/pdf",
        b"%PDF-FAKE%",
    )

    assert ok is True
    assert added == 1
    assert len(fake_collection.store) == 1

def test_index_bytes_docx_supported(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    body = "This is DOCX extracted text. " * 20
    import utils.extraction as extraction_mod

    monkeypatch.setattr(extraction_mod, "extract_docx", lambda _data: body)
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_bytes(
        "doc_docx",
        "sample.docx",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        b"FAKE-DOCX",
    )

    assert ok is True
    assert added == 1
    assert len(fake_collection.store) == 1

def test_sheet_metadata(fake_collection, mock_embedding, monkeypatch):
    body = "This is valid content. " * 20
    monkeypatch.setattr(chunking_mod, "chunk_text", lambda _body: [body])

    chunk_records = []
    added, next_chunk_index = indexer._index_sections_spreadsheet("doc_sheet", "file.xlsx", "xlsx", [("Sheet1", body)], chunk_records, "v1")

    assert added == 1
    assert next_chunk_index == 1

    meta = next(iter(fake_collection.store.values()))["metadata"]
    assert meta["sheet"] == "Sheet1"
    assert chunk_records[0]["sheet"] == "Sheet1"

def test_embedding_failure_fails_build(fake_collection, disable_node_push, monkeypatch):
    monkeypatch.setattr(pipeline, "embed_document", lambda *_a, **_k: None)
    body = "Valid content for embedding failure test. " * 20
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_text("doc_fail", "file.txt", body)
    assert ok is False
    assert added == 0
    assert len(fake_collection.store) == 0

def test_delete_existing_errors_do_not_propagate(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    """_delete_existing() should swallow collection errors and continue indexing."""

    body = "This is a sufficiently long paragraph. " * 20
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    def raising_get(*_args, **_kwargs):
        raise RuntimeError("chroma failure")

    monkeypatch.setattr(fake_collection, "get", raising_get)

    ok, added = indexer.index_text("doc_err", "file.txt", body)

    assert ok is True
    assert added == 1
    assert len(fake_collection.store) == 1

# ============================================================================
# High-priority: run_background_index() workflow tests
# ============================================================================

def test_background_index_happy_path(monkeypatch, clean_indexing_state, clean_consent_state):
    doc_id = "bg1"

    # Stub retrieval_service module used by run_background_index()
    fake_retrieval = types.ModuleType("services.retrieval_service")
    fake_retrieval.fetch_doc_from_node = lambda _doc_id: (
        True,
        "sample.txt",
        "text/plain",
        b"Valid content for background indexing. " * 5,
    )
    fake_retrieval.fetch_doc_meta_from_node = lambda _doc_id: {"contentHash": "bg1hash"}
    monkeypatch.setitem(sys.modules, "services.retrieval_service", fake_retrieval)

    import indexing.background as background_mod

    monkeypatch.setattr(background_mod, "extract_text_for_mimetype", lambda *_args, **_kwargs: "Meaningful text" * 20)
    monkeypatch.setattr(background_mod, "detect_sensitive", lambda _text: {"found": False})

    called = {}

    def fake_index_bytes(doc_id_arg, filename_arg, mimetype_arg, data_bytes_arg, file_hash=None):
        called["args"] = (doc_id_arg, filename_arg, mimetype_arg, data_bytes_arg, file_hash)
        return True, 1

    monkeypatch.setattr(indexer, "index_bytes", fake_index_bytes)

    # Seed in-progress and run
    indexer._indexing_in_progress.add(doc_id)
    indexer.run_background_index(doc_id, indexing_lock=indexer._indexing_lock, indexing_in_progress=indexer._indexing_in_progress)

    assert "args" in called
    assert called["args"][0] == doc_id
    assert called["args"][1] == "sample.txt"
    assert called["args"][2] == "text/plain"
    assert isinstance(called["args"][3], (bytes, bytearray))
    assert called["args"][4] == "bg1hash"

    assert indexer.consent_state[doc_id]["sensitive"] is False
    assert doc_id not in indexer._indexing_in_progress

def test_background_index_blocked_by_sensitive_without_consent(
    monkeypatch, clean_indexing_state, clean_consent_state
):
    doc_id = "bg2"

    fake_retrieval = types.ModuleType("services.retrieval_service")
    fake_retrieval.fetch_doc_from_node = lambda _doc_id: (
        True,
        "sample.txt",
        "text/plain",
        b"Sensitive content bytes",
    )
    fake_retrieval.fetch_doc_meta_from_node = lambda _doc_id: {"contentHash": "bg2hash"}
    monkeypatch.setitem(sys.modules, "services.retrieval_service", fake_retrieval)

    import indexing.background as background_mod

    monkeypatch.setattr(background_mod, "extract_text_for_mimetype", lambda *_args, **_kwargs: "SSN: 123-45-6789")
    monkeypatch.setattr(background_mod, "detect_sensitive", lambda _text: {"found": True, "types": ["PII"]})

    # No consent
    indexer.consent_state[doc_id] = {"confirmed": False}

    def fail_if_called(*_args, **_kwargs):
        raise AssertionError("index_bytes should not be called")

    monkeypatch.setattr(indexer, "index_bytes", fail_if_called)

    indexer._indexing_in_progress.add(doc_id)
    indexer.run_background_index(doc_id, indexing_lock=indexer._indexing_lock, indexing_in_progress=indexer._indexing_in_progress)

    assert indexer.consent_state[doc_id]["sensitive"] is True
    assert indexer.consent_state[doc_id]["awaiting"] is True
    assert doc_id not in indexer._indexing_in_progress

@pytest.mark.parametrize(
    "found, confirmed, expected_awaiting",
    [
        (False, False, False),
        (False, True, False),
        (True, False, True),
        (True, True, False),
    ],
)
def test_background_consent_state_matrix(monkeypatch, clean_indexing_state, clean_consent_state, found, confirmed, expected_awaiting):
    import indexing.background as background_mod

    doc_id = f"consent_{found}_{confirmed}"

    fake_retrieval = types.ModuleType("services.retrieval_service")
    fake_retrieval.fetch_doc_from_node = lambda _doc_id: (
        True,
        "sample.txt",
        "text/plain",
        b"Sensitive content bytes" if found else b"Plain content bytes",
    )
    fake_retrieval.fetch_doc_meta_from_node = lambda _doc_id: {"contentHash": "matrixhash"}
    monkeypatch.setitem(sys.modules, "services.retrieval_service", fake_retrieval)

    monkeypatch.setattr(background_mod, "extract_text_for_mimetype", lambda *_args, **_kwargs: "scan text")
    monkeypatch.setattr(background_mod, "detect_sensitive", lambda _text: {"found": found})
    monkeypatch.setattr(indexer, "index_bytes", lambda *_args, **_kwargs: (True, 1))

    if confirmed:
        indexer.consent_state[doc_id] = {"confirmed": True}

    indexer._indexing_in_progress.add(doc_id)
    indexer.run_background_index(doc_id, indexing_lock=indexer._indexing_lock, indexing_in_progress=indexer._indexing_in_progress)

    assert indexer.consent_state[doc_id]["sensitive"] is found
    assert indexer.consent_state[doc_id]["confirmed"] is confirmed
    assert indexer.consent_state[doc_id]["awaiting"] is expected_awaiting
    assert doc_id not in indexer._indexing_in_progress

def test_background_index_always_cleans_up_on_exception(
    monkeypatch, clean_indexing_state, clean_consent_state
):
    doc_id = "bg3"

    fake_retrieval = types.ModuleType("services.retrieval_service")

    def boom(_doc_id):
        raise RuntimeError("fetch failed")

    fake_retrieval.fetch_doc_from_node = boom
    fake_retrieval.fetch_doc_meta_from_node = lambda _doc_id: {"contentHash": "bg3hash"}
    monkeypatch.setitem(sys.modules, "services.retrieval_service", fake_retrieval)

    indexer._indexing_in_progress.add(doc_id)
    indexer.run_background_index(doc_id, indexing_lock=indexer._indexing_lock, indexing_in_progress=indexer._indexing_in_progress)

    assert doc_id not in indexer._indexing_in_progress

# ============================================================================
# Medium-priority: index_text() filename fallback + _push_chunks_to_node tests
# ============================================================================

def test_index_text_filename_fallback(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    body = "This is a sufficiently long paragraph for filename fallback. " * 20
    monkeypatch.setattr(indexer, "split_sheet_sections", lambda _text: [(None, body)])
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_text("doc_fn", None, body)
    assert ok is True
    assert added == 1

    res = fake_collection.get(where={"doc_id": "doc_fn"})
    assert len(res["ids"]) == 1
    assert res["metadatas"][0]["filename"] == "document.txt"

def test_push_chunks_to_node_payload_and_headers(monkeypatch):
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        captured["timeout"] = timeout

        class Resp:
            status_code = 200
            text = "ok"

        return Resp()

    monkeypatch.setattr(indexer.requests, "post", fake_post)

    chunk_records = [{"chunk": 0, "sheet": None, "text": "hello"}]
    indexer._push_chunks_to_node("doc_http", "f.txt", chunk_records, "v1")

    assert captured["url"] == indexer.CHUNK_UPSERT_URL
    assert captured["json"]["doc_id"] == "doc_http"
    assert captured["json"]["filename"] == "f.txt"
    assert captured["json"]["indexVersion"] == "v1"
    assert captured["json"]["chunks"] == chunk_records
    assert captured["headers"]["Content-Type"] == "application/json"
    assert captured["headers"]["x-service-token"] == indexer.SERVICE_TOKEN
    assert captured["timeout"] == indexer.NODE_FETCH_TIMEOUT

def test_push_chunks_to_node_raises_exceptions(monkeypatch):
    import requests

    def fail(*_args, **_kwargs):
        raise requests.ConnectionError("down")

    # Patch the shared requests module
    monkeypatch.setattr(requests, "post", fail)

    # Should raise IndexBuildError
    with pytest.raises(indexer.IndexBuildError) as exc:
        indexer._push_chunks_to_node(
            "doc_http2",
            "f.txt",
            [{"chunk": 0, "sheet": None, "text": "hello"}],
            "v1",
        )
    assert "Node chunk upsert failed" in str(exc.value)

def test_index_bytes_doc_legacy_supported(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    """Smoke test: legacy .doc files should go through the DOC/DOCX extraction path."""

    body = "This is legacy DOC extracted text. " * 20
    import utils.extraction as extraction_mod

    monkeypatch.setattr(extraction_mod, "extract_docx", lambda _data: body)
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _sections: [body])

    ok, added = indexer.index_bytes(
        "doc_legacy",
        "legacy.doc",
        "application/msword",
        b"fake-doc-bytes",
    )

    assert ok is True
    assert added == 1
    assert len(fake_collection.store) == 1

# PDF extraction tests have been moved to test_extraction.py.

def test_rich_metadata_validation(fake_collection, mock_embedding, disable_node_push, monkeypatch):
    # Verify all detailed block metadata keys are correctly stored
    body = "# Introduction\n\nMethodology paragraph body content goes here."
    ok, added = indexer.index_text("doc_meta_val", "sample.txt", body)
    
    assert ok is True
    assert added == 1
    
    item = next(iter(fake_collection.store.values()))
    meta = item["metadata"]
    
    # Assert newly added metadata properties
    assert "start_page" in meta
    assert "end_page" in meta
    assert "heading_level" in meta
    assert "section" in meta
    assert "subsection" in meta
    assert "chunk_type" in meta
    assert "paragraph_count" in meta
    assert "token_count" in meta
    assert "chunking_version" in meta

    from config import CHUNKING_VERSION

    assert meta["chunking_version"] == CHUNKING_VERSION
    assert meta["chunk_type"] == "paragraph"
    assert meta["start_page"] == 1
    assert meta["end_page"] == 1

def test_contextual_embedding_header(fake_collection, disable_node_push, monkeypatch):
    captured = {}
    
    def capture_embeddings(text, title=None, context=None, timeout_sec=20):
        captured["text"] = text
        captured["title"] = title
        captured["context"] = context
        return [0.1, 0.2, 0.3]
        
    monkeypatch.setattr(pipeline, "embed_document", capture_embeddings)
    import utils.extraction as extraction_mod
    
    # We will mock the parser output to simulate a nested block structure
    blocks = [
        {"type": "heading", "content": "# Section Title", "page": 2, "section": "Section Title", "subsection": "Subsection Title", "heading_level": 1},
        {"type": "heading", "content": "## Subsection Title", "page": 3, "section": "Section Title", "subsection": "Subsection Title", "heading_level": 2},
        {"type": "paragraph", "content": "A paragraph inside subsection.", "page": 3, "section": "Section Title", "subsection": "Subsection Title", "heading_level": 2}
    ]
    
    monkeypatch.setattr(extraction_mod, "extract_pdf", lambda _d: [{"page": 1, "text": "body"}])
    
    # Monkeypatch extraction & chunking to return our custom structured chunk
    from indexing.chunking import create_chunk_dict
    custom_chunk = create_chunk_dict(blocks, section_index=0, chunk_index=0)
    # Force pages to map start_page=2, end_page=3
    custom_chunk["start_page"] = 2
    custom_chunk["end_page"] = 3
    
    monkeypatch.setattr(pipeline, "pack_blocks_into_chunks", lambda _s: [custom_chunk], raising=False)
    
    ok, added = indexer.index_bytes("doc_context", "ML_paper.pdf", "application/pdf", b"data")
    assert ok is True
    
    # Verify contextual header content prepended to embedding service
    assert captured["title"] == "ML_paper.pdf"
    assert "Section: Section Title" in captured["context"]
    assert "Subsection: Subsection Title" in captured["context"]
    assert "Pages: 2-3" in captured["context"]