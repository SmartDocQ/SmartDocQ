"""Document index registry using a thread-safe Counting Bloom Filter with local set semantics.

Architectural Contract:
    IndexedDocBloomFilter is a process-local negative lookup accelerator.
    It is not authoritative and is rebuilt from authoritative index state at
    application startup. A Bloom positive requires authoritative validation.
    If Bloom state is not ready or uninitialized, operations fail-open to
    authoritative lookup.

Safety Contract:
  - is_ready() == False               -> Fail-open (bypass Bloom, do authoritative lookup).
  - maybe_contains(doc_id) == False   -> Definitely NOT indexed (0% false negatives when ready).
  - maybe_contains(doc_id) == True    -> MAY be indexed (requires authoritative check).
"""

import math
import hashlib
import threading
import logging
from typing import Iterable, Optional, Set

from config import INDEX_BLOOM_CAPACITY, INDEX_BLOOM_ERROR_RATE

logger = logging.getLogger(__name__)


def _hash_indices(item: str, size: int, k: int) -> list[int]:
    """Generate k bit indices for a string using double hashing with SHA-256."""
    item_bytes = item.encode("utf-8")
    h1 = int(hashlib.sha256(item_bytes).hexdigest()[:16], 16)
    h2 = int(hashlib.sha256(item_bytes + b"_alt").hexdigest()[:16], 16)
    
    indices = []
    for i in range(k):
        index = (h1 + i * h2) % size
        indices.append(index)
    return indices


class IndexedDocBloomFilter:
    """Thread-safe Counting Bloom Filter with exact set membership for process-local acceleration."""

    def __init__(
        self,
        capacity: Optional[int] = None,
        error_rate: Optional[float] = None,
    ):
        if capacity is None:
            capacity = INDEX_BLOOM_CAPACITY

        if error_rate is None:
            error_rate = INDEX_BLOOM_ERROR_RATE

        if capacity <= 0:
            raise ValueError("Bloom capacity must be > 0")

        if not 0 < error_rate < 1:
            raise ValueError("Bloom error rate must be between 0 and 1")

        self.capacity = capacity
        self.error_rate = error_rate


        # Calculate bit array size m and hash function count k
        self.size = max(1, int(-self.capacity * math.log(self.error_rate) / (math.log(2) ** 2)))
        self.k = max(1, int((self.size / self.capacity) * math.log(2)))

        self._counts = [0] * self.size
        self._bit_array = [0] * self.size
        self._members: Set[str] = set()
        self._ready: bool = False
        self._lock = threading.Lock()

    def is_ready(self) -> bool:
        """Return True if the Bloom filter has been populated and is ready for use."""
        with self._lock:
            return self._ready

    def maybe_contains(self, doc_id: str) -> bool:
        """Check if doc_id might be present in the registry.

        Returns:
            False: doc_id is DEFINITELY NOT in registry.
            True : doc_id MAY be in registry (requires authoritative check).
        """
        doc_id = (doc_id or "").strip()
        if not doc_id:
            return False

        indices = _hash_indices(doc_id, self.size, self.k)
        with self._lock:
            if not self._ready:
                return True  # Fail-open: if not ready, act as if item might be present
            for idx in indices:
                if self._bit_array[idx] == 0:
                    return False
        return True

    def add(self, doc_id: str) -> None:
        """Add doc_id to the Bloom filter with idempotent set semantics."""
        doc_id = (doc_id or "").strip()
        if not doc_id:
            return

        indices = _hash_indices(doc_id, self.size, self.k)
        with self._lock:
            if doc_id in self._members:
                return  # Idempotent: already a member

            self._members.add(doc_id)
            for idx in indices:
                self._counts[idx] += 1
                self._bit_array[idx] = 1

    def remove(self, doc_id: str) -> None:
        """Remove doc_id from the Bloom filter safely via exact set membership tracking."""
        doc_id = (doc_id or "").strip()
        if not doc_id:
            return

        indices = _hash_indices(doc_id, self.size, self.k)
        with self._lock:
            if doc_id not in self._members:
                return  # Only remove if doc_id is a recorded member

            self._members.remove(doc_id)
            for idx in indices:
                if self._counts[idx] > 0:
                    self._counts[idx] -= 1
                    if self._counts[idx] == 0:
                        self._bit_array[idx] = 0

    def rebuild(self, doc_ids: Optional[Iterable[str]] = None) -> None:
        """Reset and rebuild the Bloom filter with a fresh set of doc_ids, marking filter ready."""
        with self._lock:
            self._members.clear()
            self._counts = [0] * self.size
            self._bit_array = [0] * self.size
            if doc_ids:
                for d_id in doc_ids:
                    d_id = (d_id or "").strip()
                    if d_id and d_id not in self._members:
                        self._members.add(d_id)
                        indices = _hash_indices(d_id, self.size, self.k)
                        for idx in indices:
                            self._counts[idx] += 1
                            self._bit_array[idx] = 1
            self._ready = True


# Global singleton instance
indexed_doc_filter = IndexedDocBloomFilter()


def get_all_indexed_doc_ids_from_chroma() -> Set[str]:
    """Collect all unique doc_ids present in Chroma DB metadatas."""
    doc_ids = set()
    try:
        from db.chroma import collection
        res = collection.get(include=["metadatas"]) or {}
        metas = res.get("metadatas") or []
        for meta in metas:
            if isinstance(meta, dict) and meta.get("doc_id"):
                d_id = str(meta["doc_id"]).strip()
                if d_id:
                    doc_ids.add(d_id)
    except Exception as e:
        logger.error("[Registry] Error reading doc_ids from Chroma: %s", e)
        raise  # Reraise so rebuild handler can leave Bloom in not_ready state
    return doc_ids


def rebuild_index_bloom() -> int:
    """Rebuild Bloom filter at application startup if enabled. Leaves Bloom in not_ready state on failure or when disabled."""
    from config import ENABLE_INDEX_BLOOM
    if not ENABLE_INDEX_BLOOM:
        logger.info("[Registry] ENABLE_INDEX_BLOOM is False; Bloom filter is disabled in dev mode")
        return 0

    try:
        doc_ids = get_all_indexed_doc_ids_from_chroma()
        indexed_doc_filter.rebuild(doc_ids)
        logger.info("[Registry] Bloom startup rebuild completed with %d document IDs", len(doc_ids))
        return len(doc_ids)
    except Exception as e:
        logger.error("[Registry] Bloom startup rebuild failed: %s; continuing in fail-open mode", e)
        return 0

