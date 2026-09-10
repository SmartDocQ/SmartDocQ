"""
BM25 service.

Maintains an in-process TTL cache of BM25 indices keyed by (doc_id, index_version).
The index is built once during document indexing and reused across all
queries in the same process — no per-query Node HTTP calls, no per-query
BM25 rebuilds.

Cache invalidation:
  - TTL-based     : entries expire after BM25_CACHE_TTL seconds (default 10800 / 3 h)
  - Hash-based    : if file_hash changes the entry is replaced on next index
  - Explicit      : call invalidate_bm25_index() on re-index / delete

Tokenizer mirrors the existing retrieval_service keyword logic:
  - Strip leading zeros from numerics  (e.g. "021" → "21")
  - Lowercase + split on non-alphanumeric boundaries
  - Remove stop-words and single-character tokens
"""

import re
import threading
import time
import logging

from rank_bm25 import BM25Okapi

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Tokenizer  (mirrors the _keywords() logic previously in retrieval_service)
# ---------------------------------------------------------------------------

_STOP_WORDS = {
    "the", "a", "an", "and", "or", "of", "in", "on", "to", "for",
    "is", "are", "was", "were", "be", "with", "by", "at", "from",
    "as", "that", "this", "it", "its", "if", "then", "than", "into",
    "about", "over", "under", "within", "between",
}

def _normalize_numeric_tokens(text: str) -> str:
    """Strip leading zeros from numeric tokens (e.g. '021' -> '21')."""
    return re.sub(r"\b0+(\d+)\b", r"\1", text or "")

def tokenize(text: str) -> list[str]:
    """Tokenize *text* for BM25 indexing / querying.

    Steps:
      1. Normalize leading zeros in numbers.
      2. Lowercase.
      3. Split on any non-alphanumeric character.
      4. Drop stop-words and single-character tokens (unless purely numeric).
    """
    normalized = _normalize_numeric_tokens(text or "")
    toks = re.split(r"[^A-Za-z0-9]+", normalized.lower())
    return [
        t
        for t in toks
        if t and (len(t) >= 2 or t.isdigit()) and t not in _STOP_WORDS
    ]

# ---------------------------------------------------------------------------
# In-process cache
# ---------------------------------------------------------------------------

BM25_CACHE_TTL: int = 10800  # seconds — 3 hours

_bm25_cache: dict[tuple[str, str | None], dict] = {}
_bm25_lock = threading.Lock()

def build_bm25_index(
    doc_id: str,
    chunks: list[dict],
    index_version: str | None = None,
    *,
    file_hash: str | None = None,
) -> None:
    """Build and cache a BM25 index for *doc_id* and *index_version*.

    Called at the end of every indexing run so the index is immediately
    available without a warm-up query.

    Parameters
    ----------
    doc_id:
        Stable document identifier (same string used in ChromaDB metadata).
    chunks:
        List of dicts, each with:
          - ``chunk_id``  (str)   e.g. ``"abc123_17"``
          - ``text``      (str)   raw chunk text (not the embedded header)
          - ``is_table``  (bool)  whether this chunk originated from a table
    index_version:
        Unique version identifier string.
    file_hash:
        SHA-256 of the source file bytes.  Stored so a changed hash triggers
        cache replacement on the next index run.
    """
    if not doc_id or not chunks:
        return

    chunk_ids: list[str] = []
    texts: list[str] = []
    is_table_flags: list[bool] = []

    for c in chunks:
        cid = c.get("chunk_id", "")
        text = c.get("text", "")
        if not cid or not text:
            continue
        chunk_ids.append(cid)
        texts.append(text)
        is_table_flags.append(bool(c.get("is_table", False)))

    if not chunk_ids:
        logger.warning("[BM25] No valid chunks for doc_id=%s version=%s -- skipping index build", doc_id, index_version)
        return

    tokenized = [tokenize(t) for t in texts]
    bm25 = BM25Okapi(tokenized)
    chunk_id_to_index = {cid: idx for idx, cid in enumerate(chunk_ids)}

    with _bm25_lock:
        _bm25_cache[(doc_id, index_version)] = {
            "bm25": bm25,
            "chunk_ids": chunk_ids,
            "texts": texts,
            "chunk_id_to_index": chunk_id_to_index,
            "is_table": is_table_flags,
            "file_hash": file_hash,
            "expires_at": time.time() + BM25_CACHE_TTL,
        }

    logger.info(
        "[BM25] Index built: doc_id=%s version=%s chunks=%d file_hash=%s",
        doc_id,
        index_version,
        len(chunk_ids),
        (file_hash or "")[:16] or "none",
    )

def invalidate_bm25_index(doc_id: str, index_version: str | None = None) -> None:
    """Remove the cached BM25 index for (doc_id, index_version).

    Called by the indexer before re-indexing or deleting a document so that
    stale data is never served during the indexing window.
    """
    with _bm25_lock:
        removed = _bm25_cache.pop((doc_id, index_version), None)
    if removed is not None:
        logger.debug("[BM25] Invalidated index for doc_id=%s version=%s", doc_id, index_version)

def invalidate_all_bm25_versions(doc_id: str) -> None:
    """Remove all cached BM25 index versions for a document."""
    with _bm25_lock:
        keys_to_remove = [k for k in _bm25_cache.keys() if k[0] == doc_id]
        for k in keys_to_remove:
            _bm25_cache.pop(k, None)
    if keys_to_remove:
        logger.debug("[BM25] Invalidated all versions for doc_id=%s", doc_id)

def get_bm25_chunk_count(doc_id: str, index_version: str | None = None) -> int:
    """Return count of chunks in cached BM25 index for (doc_id, index_version)."""
    with _bm25_lock:
        entry = _bm25_cache.get((doc_id, index_version))
        if isinstance(entry, dict):
            return len(entry.get("chunk_ids", []))
    return 0

def bm25_search(
    doc_id: str,
    index_version: str | None,
    query: str,
    *,
    top_k: int = 20,
) -> list[tuple[str, float, str, bool]]:
    """Run BM25 search against the cached index for (doc_id, index_version).

    Returns
    -------
    list of ``(chunk_id, bm25_score, text, is_table)``
        Sorted by *bm25_score* descending.  Returns ``[]`` if the cache entry
        is missing or expired -- the caller falls back to vector-only results.
    """
    if not doc_id or not query:
        return []

    key = (doc_id, index_version)
    with _bm25_lock:
        entry = _bm25_cache.get(key)
        if not isinstance(entry, dict):
            logger.debug("[BM25] Cache miss for doc_id=%s version=%s", doc_id, index_version)
            return []
        if time.time() >= entry.get("expires_at", 0):
            _bm25_cache.pop(key, None)
            logger.debug("[BM25] Cache expired for doc_id=%s version=%s", doc_id, index_version)
            return []
        # Snapshot references under the lock.
        # BM25Okapi.get_scores() is read-only so no write-lock needed after this.
        bm25: BM25Okapi = entry["bm25"]
        chunk_ids: list[str] = entry["chunk_ids"]
        texts: list[str] = entry["texts"]
        is_table_flags: list[bool] = entry["is_table"]

    q_tokens = tokenize(query)
    if not q_tokens:
        logger.debug("[BM25] Query tokenized to empty for doc_id=%s query=%r", doc_id, query)
        return []

    raw_scores = bm25.get_scores(q_tokens)

    ranked = sorted(
        zip(chunk_ids, raw_scores, texts, is_table_flags),
        key=lambda x: float(x[1]),
        reverse=True,
    )

    return [
        (cid, float(score), text, is_tbl)
        for cid, score, text, is_tbl in ranked
        if float(score) > 0
    ][:top_k]
