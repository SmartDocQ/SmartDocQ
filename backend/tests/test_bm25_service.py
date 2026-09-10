import pytest
from unittest.mock import patch

from services.bm25_service import (
    build_bm25_index,
    bm25_search,
    invalidate_bm25_index,
    tokenize,
)
from services import retrieval_service, vector_versioning

# Tokenizer tests
def _kw(text: str) -> set:
    """Wrapper around bm25_service.tokenize that returns a set, matching
    the old _keywords() interface used by tests."""
    return set(tokenize(text))


def _overlap(query: str, doc: str) -> int:
    return len(_kw(query) & _kw(doc))


def test_keywords_preserve_numeric_tokens():
    terms = _kw("team 6 project title")
    assert "6" in terms
    assert _overlap("team 6 project title", "Team 6 final project submission") >= 3


def test_keywords_normalize_leading_zero_numbers():
    terms = _kw("invoice 00045 approved")
    assert "45" in terms
    assert "00045" not in terms
    assert _overlap("invoice 00045", "Invoice 45 approved") >= 2


def test_keywords_do_not_normalize_alphanumeric_identifiers():
    terms = _kw("47QZ9K2M7P CS001 A045X 00123AB")
    assert "47qz9k2m7p" in terms
    assert "cs001" in terms
    assert "a045x" in terms
    assert "00123ab" in terms


def test_keywords_support_team_number_overlap():
    assert _overlap("team 06 project", "Team 6 final project submission") >= 2


def test_keywords_support_marksheet_row_overlap():
    assert _overlap("marksheet row 003", "Row 3 marksheet for student") >= 3


def test_keywords_support_csv_xlsx_identifier_overlap():
    assert _overlap("Sheet1 row 06 total", "Sheet1 Row 6 Total = 95") >= 3


def test_keywords_filters_noise_and_stopwords():
    terms = _kw("a, the; -- x 1 ?")
    assert terms == {"1"}


@pytest.fixture(autouse=True)
def clean_bm25_cache():
    """Ensure cached indices are cleared before/after each test."""
    from services.bm25_service import _bm25_cache, _bm25_lock
    with _bm25_lock:
        _bm25_cache.clear()
    yield
    with _bm25_lock:
        _bm25_cache.clear()


def test_bm25_all_zero_scores_return_empty():
    """Verify that if there is no lexical overlap, all zero scores are filtered out and empty list is returned."""
    chunks = [
        {"chunk_id": "doc1_1", "text": "deep learning optimization algorithms", "is_table": False},
        {"chunk_id": "doc1_2", "text": "convolutional neural network architecture", "is_table": False},
    ]
    build_bm25_index("doc1", chunks)

    # Query with completely disjoint vocabulary
    results = bm25_search("doc1", None, "cooking recipe ingredients")
    assert results == []


def test_bm25_zero_score_results_are_excluded():
    """Verify that zero-score chunks are completely excluded from results and only positive score chunks are returned."""
    chunks = [
        {"chunk_id": "doc2_1", "text": "gradient descent and learning rates", "is_table": False},
        {"chunk_id": "doc2_2", "text": "baking bread in a wood oven", "is_table": False},
        {"chunk_id": "doc2_3", "text": "unrelated third document content", "is_table": False},
    ]
    build_bm25_index("doc2", chunks)

    # doc2_1 matches "learning", doc2_2 and doc2_3 have zero score
    results = bm25_search("doc2", None, "learning algorithm")
    assert len(results) == 1
    cid, score, text, is_tbl = results[0]
    assert cid == "doc2_1"
    assert score > 0.0
    assert text == "gradient descent and learning rates"


def test_bm25_positive_results_remain_sorted():
    """Verify that returned positive results are sorted in descending order of their scores."""
    chunks = [
        {"chunk_id": "doc3_1", "text": "optimizer", "is_table": False},
        {"chunk_id": "doc3_2", "text": "optimizer optimizer optimizer", "is_table": False},
        {"chunk_id": "doc3_3", "text": "completely unrelated text", "is_table": False},
    ]
    build_bm25_index("doc3", chunks)

    results = bm25_search("doc3", None, "optimizer")
    assert len(results) == 2  # unrelated is excluded since its score is 0
    scores = [r[1] for r in results]
    assert scores == sorted(scores, reverse=True)
    # The chunk with more occurrences should have higher score
    assert results[0][0] == "doc3_2"
    assert results[1][0] == "doc3_1"


def test_bm25_top_k_applies_to_positive_results():
    """Verify that top_k applies after filtering for positive results, returning the highest-ranked positive results."""
    chunks = [
        {"chunk_id": "doc4_1", "text": "term match one", "is_table": False},
        {"chunk_id": "doc4_2", "text": "term match match two", "is_table": False},
        {"chunk_id": "doc4_3", "text": "term match match match three", "is_table": False},
        {"chunk_id": "doc4_4", "text": "completely unrelated text", "is_table": False},
    ]
    build_bm25_index("doc4", chunks)

    # Query matching the positive docs with top_k = 2
    results = bm25_search("doc4", None, "match", top_k=2)
    assert len(results) == 2
    # Verify we get the highest-scored matches
    assert results[0][0] == "doc4_3"
    assert results[1][0] == "doc4_2"


def test_retrieval_uses_vector_results_when_bm25_returns_empty():
    """Verify that hybrid retrieval falls back to vector-only results naturally if BM25 search returns empty."""
    with patch("services.vector_versioning.get_index_state") as mock_state:
        mock_state.return_value = {"activeVersion": "v1"}

        # Mock bm25_search to return empty (simulating zero lexical overlap)
        with patch("services.retrieval_service.bm25_search") as mock_bm25:
            mock_bm25.return_value = []

            # Mock Chroma query results
            with patch("services.retrieval_service.collection") as mock_coll:
                mock_coll.get.return_value = {
                    "ids": ["dummy_chunk"],
                    "documents": ["dummy_text"],
                    "metadatas": [{"doc_id": "doc5", "index_version": "v1", "embedding_model": "models/text-embedding-004", "pipeline_version": "6"}]
                }
                mock_coll.query.return_value = {
                    "documents": [["Semantic match content in document"]],
                    "distances": [[0.35]],
                    "metadatas": [[{"doc_id": "doc5", "is_table": False}]],
                }

                # Mock embed_query to return dummy embedding
                with patch("services.retrieval_service.embed_query") as mock_embed:
                    mock_embed.return_value = [0.1, 0.2, 0.3]

                    ctx, err = retrieval_service.retrieve_context("semantic query", "doc5")

                    assert err is None
                    assert ctx == "Semantic match content in document"
                    mock_bm25.assert_called_once()


def test_bm25_cache_update_operation(clean_bm25_cache):
    from services.bm25_service import _bm25_cache, _bm25_lock

    with _bm25_lock:
        _bm25_cache[("doc_update", "v1")] = {
            "chunk_ids": ["c0", "c1", "c2"],
            "texts": ["Text 0", "Text 1", "Text 2"],
            "chunk_id_to_index": {"c0": 0, "c1": 1, "c2": 2},
        }

    # Perform update operation
    cid = "c1"
    new_text = "Updated Text 1"
    with _bm25_lock:
        entry = _bm25_cache[("doc_update", "v1")]
        idx = entry["chunk_id_to_index"].get(cid)
        assert idx == 1
        entry["texts"][idx] = new_text

    assert entry["texts"][entry["chunk_id_to_index"][cid]] == "Updated Text 1"


def test_bm25_cache_insert_operation(clean_bm25_cache):
    from services.bm25_service import _bm25_cache, _bm25_lock

    with _bm25_lock:
        _bm25_cache[("doc_insert", "v1")] = {
            "chunk_ids": ["c0", "c1"],
            "texts": ["Text 0", "Text 1"],
            "chunk_id_to_index": {"c0": 0, "c1": 1},
        }

    new_cid = "c2"
    new_text = "Inserted Text 2"
    with _bm25_lock:
        entry = _bm25_cache[("doc_insert", "v1")]
        idx = len(entry["chunk_ids"])
        entry["chunk_ids"].append(new_cid)
        entry["texts"].append(new_text)
        entry["chunk_id_to_index"][new_cid] = idx

    assert new_cid in entry["chunk_id_to_index"]
    assert entry["chunk_id_to_index"][new_cid] == entry["chunk_ids"].index(new_cid)
    assert entry["texts"][entry["chunk_id_to_index"][new_cid]] == "Inserted Text 2"


def test_bm25_cache_delete_operation(clean_bm25_cache):
    from services.bm25_service import _bm25_cache, _bm25_lock

    with _bm25_lock:
        _bm25_cache[("doc_delete", "v1")] = {
            "chunk_ids": ["c0", "c1", "c2", "c3"],
            "texts": ["Text 0", "Text 1", "Text 2", "Text 3"],
            "chunk_id_to_index": {"c0": 0, "c1": 1, "c2": 2, "c3": 3},
        }

    delete_cid = "c1"
    with _bm25_lock:
        entry = _bm25_cache[("doc_delete", "v1")]
        idx = entry["chunk_id_to_index"].pop(delete_cid, None)
        assert idx == 1
        entry["chunk_ids"].pop(idx)
        entry["texts"].pop(idx)
        entry["chunk_id_to_index"] = {c: i for i, c in enumerate(entry["chunk_ids"])}

    assert delete_cid not in entry["chunk_id_to_index"]
    for i, c in enumerate(entry["chunk_ids"]):
        assert entry["chunk_id_to_index"][c] == i

