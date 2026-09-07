import time
import pytest
from unittest.mock import MagicMock, patch

from services import reranker_service
from services.reranker_service import (
    RerankerCache,
    RerankerManager,
    MockReranker,
    CrossEncoderReranker,
    rerank
)

# Reset singleton and caching between tests
@pytest.fixture(autouse=True)
def reset_reranker_state():
    RerankerManager._instance = None
    reranker_service._cache_instance = None
    yield

def test_mock_reranker_scores():
    reranker = MockReranker()
    candidates = [
        {"chunk_id": "c1", "text": "Short", "score": 0.5},
        {"chunk_id": "c2", "text": "Very long text description", "score": 0.3},
        {"chunk_id": "c3", "text": "Medium length text", "score": 0.8},
    ]
    query = "Medium len text"  # Length 15
    # c3 text is "Medium length text" (Length 18, diff 3)
    # c1 text is "Short" (Length 5, diff 10)
    # c2 text is "Very long text description" (Length 26, diff 11)
    
    result = reranker.rerank(query, candidates)
    
    assert len(result) == 3
    assert result[0]["chunk_id"] == "c3"
    assert result[1]["chunk_id"] == "c1"
    assert result[2]["chunk_id"] == "c2"
    assert result[0]["score"] == -3.0

def test_reranker_manager_singleton(monkeypatch):
    monkeypatch.setattr("config.RERANKER_MODEL", "mock")
    manager1 = RerankerManager()
    manager2 = RerankerManager()
    assert manager1 is manager2

    r1 = manager1.get_reranker()
    r2 = manager2.get_reranker()
    assert r1 is r2
    assert isinstance(r1, MockReranker)

def test_reranker_cache_lru():
    cache = RerankerCache(max_size=2, ttl=100)
    
    q1 = "query one"
    c1 = [{"chunk_id": "1", "score": 1.0, "text": "a"}]
    r1 = [{"chunk_id": "1", "score": 0.9, "text": "a"}]
    
    q2 = "query two"
    c2 = [{"chunk_id": "2", "score": 1.0, "text": "b"}]
    r2 = [{"chunk_id": "2", "score": 0.8, "text": "b"}]
    
    q3 = "query three"
    c3 = [{"chunk_id": "3", "score": 1.0, "text": "c"}]
    r3 = [{"chunk_id": "3", "score": 0.7, "text": "c"}]

    cache.set(q1, c1, r1)
    cache.set(q2, c2, r2)
    
    # Verify cache hits
    assert cache.get(q1, c1)[0]["score"] == 0.9
    assert cache.get(q2, c2)[0]["score"] == 0.8

    # Evict q1 by adding q3
    # Accessing q2 first makes q1 the LRU candidate
    cache.get(q2, c2)
    cache.set(q3, c3, r3)

    assert cache.get(q1, c1) is None  # Evicted
    assert cache.get(q2, c2) is not None
    assert cache.get(q3, c3) is not None

def test_reranker_cache_ttl():
    cache = RerankerCache(max_size=5, ttl=1)  # 1 second TTL
    
    query = "test query"
    candidates = [{"chunk_id": "1", "score": 1.0, "text": "a"}]
    result = [{"chunk_id": "1", "score": 0.9, "text": "a"}]

    cache.set(query, candidates, result)
    assert cache.get(query, candidates) is not None

    time.sleep(1.1)
    assert cache.get(query, candidates) is None  # Expired

def test_reranker_cache_key_shift():
    cache = RerankerCache(max_size=5, ttl=100)
    query = "test query"
    
    # Base candidates
    c = [{"chunk_id": "1", "score": 1.0, "text": "a"}]
    r = [{"chunk_id": "1", "score": 0.95, "text": "a"}]
    
    cache.set(query, c, r)
    assert cache.get(query, c) is not None

    # Shift score
    c_new_score = [{"chunk_id": "1", "score": 0.5, "text": "a"}]
    assert cache.get(query, c_new_score) is None  # Cache miss due to score change

    # Shift ID
    c_new_id = [{"chunk_id": "2", "score": 1.0, "text": "a"}]
    assert cache.get(query, c_new_id) is None  # Cache miss due to ID change

def test_public_rerank_and_cache(monkeypatch):
    monkeypatch.setattr("config.RERANKER_MODEL", "mock")
    monkeypatch.setattr("config.ENABLE_RERANKER_CACHE", True)
    monkeypatch.setattr("config.RERANKER_CACHE_SIZE", 10)
    monkeypatch.setattr("config.RERANKER_CACHE_TTL", 100)
    
    candidates = [{"chunk_id": "c1", "text": "test document", "score": 1.0}]
    query = "test"
    
    # Track MockReranker rerank calls
    with patch.object(MockReranker, 'rerank', wraps=MockReranker().rerank) as mock_rerank_method:
        res1 = rerank(query, candidates)
        assert len(res1) == 1
        assert mock_rerank_method.call_count == 1
        
        # Second call should hit the cache and not call MockReranker.rerank
        res2 = rerank(query, candidates)
        assert len(res2) == 1
        assert mock_rerank_method.call_count == 1  # Still 1

def test_rerank_fallback_on_exception(monkeypatch):
    monkeypatch.setattr("config.RERANKER_MODEL", "mock")
    
    candidates = [{"chunk_id": "c1", "text": "test", "score": 1.0}]
    
    # Mock RerankerManager to return a reranker that throws an exception
    bad_reranker = MagicMock()
    bad_reranker.rerank.side_effect = Exception("GPU out of memory")
    
    with patch.object(RerankerManager, 'get_reranker', return_value=bad_reranker):
        # Should catch exception and return original candidates gracefully
        result = rerank("query", candidates)
        assert result == candidates
