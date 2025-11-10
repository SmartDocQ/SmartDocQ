import os
from typing import List, Dict, Tuple, Optional
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, Filter, FieldCondition, MatchValue, PointStruct

QDRANT_URL = os.environ.get("QDRANT_URL")  # e.g. https://xyz-region-xxxx.qdrant.tech
QDRANT_API_KEY = os.environ.get("QDRANT_API_KEY")
QDRANT_COLLECTION = os.environ.get("QDRANT_COLLECTION", "documents")
QDRANT_TIMEOUT = int(os.environ.get("QDRANT_TIMEOUT_SEC", "30"))

# We lazily infer vector size from first embedding we see.
_vector_size: Optional[int] = None
_client: Optional[QdrantClient] = None
_initialized = False

class VectorStoreError(RuntimeError):
    pass


def init_client():
    global _client, _initialized
    if _initialized:
        return _client
    if not QDRANT_URL or not QDRANT_API_KEY:
        raise VectorStoreError("Missing QDRANT_URL or QDRANT_API_KEY environment variables")
    _client = QdrantClient(url=QDRANT_URL, api_key=QDRANT_API_KEY, timeout=QDRANT_TIMEOUT)
    _initialized = True
    return _client


def ensure_collection(vector_size: int):
    client = init_client()
    try:
        existing = client.get_collection(QDRANT_COLLECTION)
        # If exists, optionally validate vector size
        params = existing.config.params
        if params is not None and hasattr(params, 'vectors'):
            vs = params.vectors
            if hasattr(vs, 'size') and vs.size != vector_size:
                raise VectorStoreError(f"Existing collection vector size {vs.size} != expected {vector_size}")
        return
    except Exception:
        # Create new collection
        client.recreate_collection(
            collection_name=QDRANT_COLLECTION,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE)
        )


def upsert_chunks(doc_id: str, filename: str, chunk_records: List[Dict]):
    client = init_client()
    if not chunk_records:
        return 0
    # Infer vector size from first embedding length (requires 'embedding' key already filled)
    global _vector_size
    points: List[PointStruct] = []
    added = 0
    for rec in chunk_records:
        emb = rec.get('embedding')
        text = rec.get('text')
        if emb is None or text is None:
            continue
        if _vector_size is None:
            _vector_size = len(emb)
            ensure_collection(_vector_size)
        payload = {
            'doc_id': doc_id,
            'chunk': rec.get('chunk'),
            'filename': filename,
            'sheet': rec.get('sheet'),
            'text': text,
        }
        points.append(PointStruct(id=f"{doc_id}_{rec.get('chunk')}", vector=emb, payload=payload))
        added += 1
    if points:
        client.upsert(collection_name=QDRANT_COLLECTION, points=points, wait=True)
    return added


def delete_doc(doc_id: str):
    client = init_client()
    client.delete(collection_name=QDRANT_COLLECTION, filter=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]))


def has_doc(doc_id: str) -> bool:
    client = init_client()
    # Search for one point only
    try:
        r = client.scroll(collection_name=QDRANT_COLLECTION, limit=1, filter=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]))
        points = r[0]
        return bool(points)
    except Exception:
        return False


def query_doc(doc_id: str, embedding: List[float], top_k: int = 12) -> List[Tuple[str, float]]:
    client = init_client()
    if _vector_size is None:
        return []
    try:
        results = client.search(
            collection_name=QDRANT_COLLECTION,
            query_vector=embedding,
            limit=top_k,
            filter=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))]),
            with_payload=True,
            with_vectors=False
        )
        out = []
        for p in results:
            text = (p.payload or {}).get('text')
            dist = p.score  # higher is better for cosine similarity in Qdrant
            out.append((text, dist))
        return out
    except Exception:
        return []


def list_docs() -> List[Dict]:
    client = init_client()
    docs_map: Dict[str, Dict] = {}
    # Scroll through points (limit batches)
    page_limit = 256
    next_page = None
    try:
        while True:
            points, next_page = client.scroll(collection_name=QDRANT_COLLECTION, limit=page_limit, offset=next_page)
            for p in points:
                payload = p.payload or {}
                doc_id = payload.get('doc_id')
                if not doc_id:
                    continue
                if doc_id not in docs_map:
                    docs_map[doc_id] = {
                        '_id': doc_id,
                        'name': payload.get('filename', 'document'),
                        'type': 'text',
                        'size': 0
                    }
            if not next_page:
                break
    except Exception:
        pass
    return list(docs_map.values())


def health() -> Dict:
    client = init_client()
    try:
        coll = client.get_collection(QDRANT_COLLECTION)
        vectors = getattr(getattr(coll.config, 'params', None), 'vectors', None)
        size = getattr(vectors, 'size', None)
        return {'ok': True, 'collection': QDRANT_COLLECTION, 'vector_size': size}
    except Exception as e:
        return {'ok': False, 'error': str(e), 'collection': QDRANT_COLLECTION}


def get_doc_texts(doc_id: str, limit: int = 500) -> List[str]:
    """Return up to 'limit' chunk texts for a given document."""
    client = init_client()
    texts: List[str] = []
    next_page = None
    page_limit = min(256, max(1, limit))
    try:
        while len(texts) < limit:
            points, next_page = client.scroll(
                collection_name=QDRANT_COLLECTION,
                limit=page_limit,
                offset=next_page,
                filter=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))])
            )
            for p in points:
                t = (p.payload or {}).get('text')
                if t:
                    texts.append(t)
                    if len(texts) >= limit:
                        break
            if not next_page:
                break
    except Exception:
        pass
    return texts


def update_filename(doc_id: str, new_name: str):
    """Update filename payload for all points of a document."""
    client = init_client()
    client.set_payload(
        collection_name=QDRANT_COLLECTION,
        payload={"filename": new_name},
        filter=Filter(must=[FieldCondition(key="doc_id", match=MatchValue(value=doc_id))])
    )
