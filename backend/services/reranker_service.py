import logging
import threading
import time

logger = logging.getLogger(__name__)

class RerankerInterface:
    """Base class defining the reranker interface."""
    def rerank(self, query: str, candidates: list[dict], batch_size: int = 16) -> list[dict]:
        raise NotImplementedError("Reranker subclasses must implement rerank.")

class CrossEncoderReranker(RerankerInterface):
    """Production CrossEncoder reranker implementation using sentence-transformers."""
    def __init__(self, model_name: str, device: str = "auto"):
        self.model_name = model_name
        self.device = device
        self._model = None
        self._lock = threading.Lock()

    def _get_model(self):
        if self._model is None:
            with self._lock:
                if self._model is None:
                    # Lazy local imports to prevent load overhead on import
                    import torch
                    from sentence_transformers import CrossEncoder

                    device_str = self.device
                    if device_str == "auto":
                        if torch.cuda.is_available():
                            device_str = "cuda"
                        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
                            device_str = "mps"
                        else:
                            device_str = "cpu"
                    if device_str == "cpu":
                        # Limit CPU threads to prevent thread contention/thrashing
                        if torch.get_num_threads() > 4:
                            torch.set_num_threads(4)

                    logger.info("[Reranker] Loading model '%s' on device: %s", self.model_name, device_str)
                    start_time = time.perf_counter()
                    self._model = CrossEncoder(self.model_name, device=device_str)
                    elapsed = time.perf_counter() - start_time

                    # Try to fetch param count from Hugging Face model wrapper
                    try:
                        num_params = self._model.model.num_parameters()
                        params_str = f"{num_params / 1_000_000:.1f}M"
                    except Exception:
                        params_str = "Unknown"

                    logger.info("[Reranker] Warmup: performing dummy run...")
                    warmup_start = time.perf_counter()
                    # Run single dummy prediction to trigger JIT compilation/initialization
                    self._model.predict([["warmup query", "warmup document"]], show_progress_bar=False)
                    warmup_elapsed = time.perf_counter() - warmup_start

                    # Structured metadata logging as requested
                    logger.info(
                        "[Reranker] Initialized CrossEncoderReranker\n"
                        "- Model: %s\n"
                        "- Device: %s\n"
                        "- Parameters: %s\n"
                        "- Load Time: %.2f seconds\n"
                        "- Warmup: Completed (took %.2f seconds)",
                        self.model_name,
                        device_str,
                        params_str,
                        warmup_elapsed
                    )
        return self._model

    def rerank(self, query: str, candidates: list[dict], batch_size: int = 16) -> list[dict]:
        if not candidates:
            return []

        # Construct candidate pairs: [query, doc_text]
        pairs = [[query, c.get("text", "")] for c in candidates]

        model = self._get_model()

        # Run predictions in thread-safe block
        with self._lock:
            scores = model.predict(pairs, batch_size=batch_size, show_progress_bar=False)

        # Update candidate scores
        reranked = []
        for c, score in zip(candidates, scores):
            new_c = c.copy()
            new_c["score"] = float(score)
            reranked.append(new_c)

        # Sort descending by updated score
        reranked.sort(key=lambda x: x["score"], reverse=True)
        return reranked

class MockReranker(RerankerInterface):
    """Deterministic mock reranker for testing and offline environments."""
    def rerank(self, query: str, candidates: list[dict], batch_size: int = 16) -> list[dict]:
        logger.info("[Reranker] MockReranker active, reranking %d candidates", len(candidates))
        reranked = []
        q_len = len(query)
        for c in candidates:
            new_c = c.copy()
            t_len = len(c.get("text", ""))
            # Deterministic scoring: closer in text length is "more relevant"
            new_c["score"] = float(-abs(t_len - q_len))
            reranked.append(new_c)
        reranked.sort(key=lambda x: x["score"], reverse=True)
        return reranked

class RerankerManager:
    """Thread-safe Singleton managing the active reranker instance."""
    _instance = None
    _lock = threading.Lock()

    def __new__(cls):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(RerankerManager, cls).__new__(cls)
                cls._instance._reranker = None
        return cls._instance

    def get_reranker(self) -> RerankerInterface:
        if self._reranker is None:
            with self._lock:
                if self._reranker is None:
                    from config import RERANKER_MODEL, RERANKER_DEVICE
                    if RERANKER_MODEL in ("mock", "test"):
                        logger.info("[Reranker] Initialized MockReranker")
                        self._reranker = MockReranker()
                    else:
                        self._reranker = CrossEncoderReranker(RERANKER_MODEL, device=RERANKER_DEVICE)
        return self._reranker

class RerankerCache:
    """Thread-safe cache with LRU eviction and time-based TTL expiration."""
    def __init__(self, max_size: int = 128, ttl: int = 1800):
        self.max_size = max_size
        self.ttl = ttl
        self._cache = {}
        self._lock = threading.Lock()
        self._history = []

    def _clean_expired(self, now: float):
        # Assumes lock is held
        expired_keys = []
        for key, (_, timestamp) in self._cache.items():
            if now - timestamp > self.ttl:
                expired_keys.append(key)
        for key in expired_keys:
            self._cache.pop(key, None)
            if key in self._history:
                self._history.remove(key)

    def get(self, query: str, candidates: list[dict]) -> list[dict] | None:
        # Tuple cache key consisting of query, retrieved chunk IDs, and their retrieved scores
        candidate_ids = tuple(c.get("chunk_id", "") for c in candidates)
        candidate_scores = tuple(round(c.get("score", 0.0), 5) for c in candidates)
        key = (query.strip().lower(), candidate_ids, candidate_scores)

        now = time.time()
        with self._lock:
            self._clean_expired(now)
            if key in self._cache:
                # Update access history (LRU)
                if key in self._history:
                    self._history.remove(key)
                self._history.append(key)
                cached_result, _ = self._cache[key]
                return [c.copy() for c in cached_result]
        return None

    def set(self, query: str, candidates: list[dict], result: list[dict]):
        candidate_ids = tuple(c.get("chunk_id", "") for c in candidates)
        candidate_scores = tuple(round(c.get("score", 0.0), 5) for c in candidates)
        key = (query.strip().lower(), candidate_ids, candidate_scores)

        now = time.time()
        with self._lock:
            self._clean_expired(now)
            if key in self._cache:
                self._cache[key] = ([c.copy() for c in result], now)
                if key in self._history:
                    self._history.remove(key)
                self._history.append(key)
                return

            # LRU Eviction
            if len(self._cache) >= self.max_size:
                if self._history:
                    oldest = self._history.pop(0)
                    self._cache.pop(oldest, None)

            self._cache[key] = ([c.copy() for c in result], now)
            self._history.append(key)

# Global variables for caching
_cache_instance = None
_cache_lock = threading.Lock()

def _get_cache() -> RerankerCache | None:
    global _cache_instance
    from config import ENABLE_RERANKER_CACHE, RERANKER_CACHE_SIZE, RERANKER_CACHE_TTL
    if not ENABLE_RERANKER_CACHE:
        return None
    if _cache_instance is None:
        with _cache_lock:
            if _cache_instance is None:
                _cache_instance = RerankerCache(max_size=RERANKER_CACHE_SIZE, ttl=RERANKER_CACHE_TTL)
    return _cache_instance

def rerank(query: str, candidates: list[dict]) -> list[dict]:
    """Reranks retrieved candidate chunks.
    
    Tries caching before falling back to model prediction.
    Fails safely returning the original candidates if an error occurs.
    """
    if not candidates:
        return []

    try:
        from config import RERANKER_BATCH_SIZE

        # 1. Cache lookup
        cache = _get_cache()
        if cache:
            cached_result = cache.get(query, candidates)
            if cached_result is not None:
                logger.info("[Reranker] Cache hit for query: '%s'", query)
                return cached_result

        # 2. Run active reranker
        manager = RerankerManager()
        reranker = manager.get_reranker()
        result = reranker.rerank(query, candidates, batch_size=RERANKER_BATCH_SIZE)

        # 3. Cache the output
        if cache:
            cache.set(query, candidates, result)

        return result
    except Exception:
        logger.exception("[Reranker] Error during reranking, falling back to original candidates.")
        return candidates
