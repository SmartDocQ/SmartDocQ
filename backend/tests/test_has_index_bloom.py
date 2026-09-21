"""Integration and lifecycle tests for has_index() with IndexedDocBloomFilter."""

from unittest.mock import patch, MagicMock
import pytest

from services.document_index_registry import indexed_doc_filter, IndexedDocBloomFilter
from indexing.indexer import has_index, index_bytes, index_text, IndexBuildError


@pytest.fixture(autouse=True)
def reset_bloom_filter(monkeypatch):
    monkeypatch.setattr("config.ENABLE_INDEX_BLOOM", True)
    indexed_doc_filter.rebuild([])
    yield
    indexed_doc_filter.rebuild([])



def test_bloom_not_ready_bypasses_bloom_check():
    """Verify fail-open behavior: when Bloom is not ready, has_index falls through to authoritative check."""
    uninit_filter = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    assert uninit_filter.is_ready() is False

    doc_id = "test_doc_uninit_999"
    with patch("services.document_index_registry.indexed_doc_filter", uninit_filter), \
         patch("services.vector_versioning.get_index_state", return_value={"activeVersion": "v1.0"}) as mock_get_state:
        
        result = has_index(doc_id)
        assert result is True
        mock_get_state.assert_called_once_with(doc_id)


def test_bloom_false_skips_authoritative_check():
    doc_id = "test_missing_doc_000"
    assert indexed_doc_filter.is_ready() is True
    assert indexed_doc_filter.maybe_contains(doc_id) is False

    with patch("services.vector_versioning.get_index_state") as mock_get_state:
        result = has_index(doc_id)
        assert result is False
        mock_get_state.assert_not_called()


def test_bloom_true_executes_authoritative_check():
    doc_id = "test_existing_doc_111"
    indexed_doc_filter.add(doc_id)
    assert indexed_doc_filter.maybe_contains(doc_id) is True

    with patch("services.vector_versioning.get_index_state", return_value={"activeVersion": "v1.0"}) as mock_get_state:
        result = has_index(doc_id)
        assert result is True
        mock_get_state.assert_called_once_with(doc_id)


def test_bloom_true_authoritative_false_returns_false():
    doc_id = "test_stale_doc_222"
    indexed_doc_filter.add(doc_id)

    with patch("services.vector_versioning.get_index_state", return_value={"activeVersion": None}), \
         patch("services.vector_versioning.has_legacy_chunks", return_value=False):
        result = has_index(doc_id)
        assert result is False


def test_indexing_success_adds_to_bloom():
    doc_id = "doc_index_success_333"
    assert indexed_doc_filter.maybe_contains(doc_id) is False

    with patch("indexing.indexer._index_blocks_pipeline", return_value=(5, [])), \
         patch("indexing.indexer._finalize_index"), \
         patch("indexing.indexer.validate_index_version", return_value=True), \
         patch("indexing.indexer.activate_index_version", return_value=True), \
         patch("services.vector_versioning.get_index_state", return_value={"activeVersion": "v1"}), \
         patch("indexing.indexer.cleanup_old_versions"):

        ok, added = index_text(doc_id, "test.txt", "Sample text content")
        assert ok is True
        assert indexed_doc_filter.maybe_contains(doc_id) is True


def test_indexing_failure_does_not_add_to_bloom():
    doc_id = "doc_index_fail_444"
    assert indexed_doc_filter.maybe_contains(doc_id) is False

    with patch("indexing.indexer._index_blocks_pipeline", return_value=(5, [])), \
         patch("indexing.indexer._finalize_index"), \
         patch("indexing.indexer.validate_index_version", return_value=True), \
         patch("indexing.indexer.activate_index_version", return_value=False), \
         patch("indexing.indexer.mark_index_failed"), \
         patch("indexing.indexer.delete_index_version"):

        ok, added = index_text(doc_id, "test.txt", "Sample text content")
        assert ok is False
        assert indexed_doc_filter.maybe_contains(doc_id) is False


def test_obsolete_version_cleanup_retains_bloom_membership():
    """Cleanup of obsolete versions must NOT remove doc_id from Bloom if an active version remains."""
    from services.vector_versioning import cleanup_old_versions
    doc_id = "doc_reindex_555"
    indexed_doc_filter.add(doc_id)

    with patch("services.vector_versioning._get_collection") as mock_get_col, \
         patch("services.vector_versioning.delete_index_version"):
        
        mock_col = MagicMock()
        mock_col.get.return_value = {
            "metadatas": [
                {"index_version": "v1_obsolete"},
                {"index_version": "v2_active"},
            ]
        }
        mock_get_col.return_value = mock_col

        cleanup_old_versions(doc_id, active_version="v2_active", previous_version=None)
        assert indexed_doc_filter.maybe_contains(doc_id) is True


def test_deletion_failure_retains_bloom_membership():
    """Verify that if collection.delete fails, Bloom filter retains doc_id membership."""
    from flask import Flask
    from routes.document_routes import delete_doc
    app = Flask("test_app")

    doc_id = "doc_delete_fail_666"
    indexed_doc_filter.add(doc_id)

    with app.app_context():
        with patch("routes.document_routes.collection") as mock_col, \
             patch("routes.document_routes.invalidate_cached_doc_meta"), \
             patch("services.bm25_service.invalidate_all_bm25_versions"):
            
            mock_col.delete.side_effect = Exception("Chroma deletion failed")
            
            resp, status_code = delete_doc(doc_id)
            assert status_code == 500
            # Deletion failed, so Bloom filter MUST still contain doc_id
            assert indexed_doc_filter.maybe_contains(doc_id) is True



