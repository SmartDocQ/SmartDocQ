"""Unit tests for IndexedDocBloomFilter registry."""

import threading
import pytest
from services.document_index_registry import IndexedDocBloomFilter, rebuild_index_bloom, indexed_doc_filter


def test_empty_uninitialized_registry():
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    # Not ready yet: fail-open returns True
    assert bloom.is_ready() is False
    assert bloom.maybe_contains("doc1") is True

    # Rebuild initializes filter
    bloom.rebuild([])
    assert bloom.is_ready() is True
    assert bloom.maybe_contains("doc1") is False


def test_add_document():
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    bloom.rebuild([])
    bloom.add("doc1")
    assert bloom.maybe_contains("doc1") is True


def test_different_document():
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    bloom.rebuild([])
    bloom.add("doc1")
    assert bloom.maybe_contains("doc2") is False


def test_remove_document():
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    bloom.rebuild([])
    bloom.add("doc1")
    assert bloom.maybe_contains("doc1") is True
    bloom.remove("doc1")
    assert bloom.maybe_contains("doc1") is False


def test_empty_invalid_doc_id():
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    bloom.rebuild([])
    assert bloom.maybe_contains("") is False
    assert bloom.maybe_contains(None) is False
    bloom.add("")
    bloom.add(None)
    bloom.remove("")
    bloom.remove(None)
    assert bloom.maybe_contains("") is False


def test_invalid_configuration_parameters():
    """Verify that capacity <= 0 or out-of-bounds error_rate raises ValueError."""
    with pytest.raises(ValueError, match="Bloom capacity must be > 0"):
        IndexedDocBloomFilter(capacity=0)

    with pytest.raises(ValueError, match="Bloom capacity must be > 0"):
        IndexedDocBloomFilter(capacity=-10)

    with pytest.raises(ValueError, match="Bloom error rate must be between 0 and 1"):
        IndexedDocBloomFilter(error_rate=0)

    with pytest.raises(ValueError, match="Bloom error rate must be between 0 and 1"):
        IndexedDocBloomFilter(error_rate=1.0)

    with pytest.raises(ValueError, match="Bloom error rate must be between 0 and 1"):
        IndexedDocBloomFilter(error_rate=1.5)



def test_idempotent_set_semantics_duplicate_add():
    """Verify that multiple adds of the same doc_id are idempotent set additions."""
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    bloom.rebuild([])
    bloom.add("doc1")
    bloom.add("doc1")
    bloom.add("doc1")
    assert bloom.maybe_contains("doc1") is True

    # Single removal removes doc1 cleanly because of exact set semantics
    bloom.remove("doc1")
    assert bloom.maybe_contains("doc1") is False


def test_thread_safe_add_remove():
    bloom = IndexedDocBloomFilter(capacity=5000, error_rate=0.01)
    bloom.rebuild([])
    threads = []

    def worker(doc_prefix):
        for i in range(50):
            d_id = f"{doc_prefix}_{i}"
            bloom.add(d_id)
            assert bloom.maybe_contains(d_id) is True
            bloom.remove(d_id)

    for prefix in ["workerA", "workerB", "workerC", "workerD"]:
        t = threading.Thread(target=worker, args=(prefix,))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()


def test_rebuild():
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    bloom.rebuild([])
    bloom.add("doc1")
    bloom.add("doc2")
    assert bloom.maybe_contains("doc1") is True
    assert bloom.maybe_contains("doc2") is True

    bloom.rebuild(["doc3", "doc4"])
    assert bloom.is_ready() is True
    assert bloom.maybe_contains("doc1") is False
    assert bloom.maybe_contains("doc2") is False
    assert bloom.maybe_contains("doc3") is True
    assert bloom.maybe_contains("doc4") is True


def test_false_positive_behavior_non_authoritative():
    """Verify that Bloom returning True does NOT substitute for authoritative verification."""
    bloom = IndexedDocBloomFilter(capacity=1000, error_rate=0.01)
    bloom.rebuild([])
    bloom.add("doc1")

    # Simulated authoritative lookup table
    authoritative_db = {"doc1": False}

    bloom_result = bloom.maybe_contains("doc1")
    assert bloom_result is True

    final_has_index = bloom_result and authoritative_db.get("doc1", False)
    assert final_has_index is False


def test_startup_rebuild_from_storage(monkeypatch):
    """Test that rebuild_index_bloom reads document IDs from storage and sets filter ready."""
    monkeypatch.setattr("config.ENABLE_INDEX_BLOOM", True)
    monkeypatch.setattr(
        "services.document_index_registry.get_all_indexed_doc_ids_from_chroma",
        lambda: {"doc_restart_A", "doc_restart_B"}
    )

    rebuild_index_bloom()
    assert indexed_doc_filter.is_ready() is True
    assert indexed_doc_filter.maybe_contains("doc_restart_A") is True
    assert indexed_doc_filter.maybe_contains("doc_restart_B") is True
    assert indexed_doc_filter.maybe_contains("doc_restart_C") is False

