import os
import sys
sys.stdout.reconfigure(line_buffering=True)
import time
import math
import json
import re
import random
import zipfile
import urllib.request
import logging
import hashlib
from unittest.mock import patch

# Setup path so backend imports work
# __file__ is in backend/benchmark/scripts/
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__))) # backend/benchmark/
WORKSPACE_DIR = os.path.dirname(BASE_DIR) # backend/

# Set database path to backend/chroma_db to ensure consistency with the backend server
os.environ["CHROMA_DB_PATH"] = os.path.abspath(os.path.join(WORKSPACE_DIR, "chroma_db"))

sys.path.append(WORKSPACE_DIR)
sys.path.append(os.path.dirname(WORKSPACE_DIR)) # SmartDocQ/

# Set environment defaults for benchmarking
os.environ.setdefault("SERVICE_TOKEN", "benchmark_token")
os.environ.setdefault("RERANKER_MODEL", "BAAI/bge-reranker-base")
os.environ.setdefault("BENCHMARK_STRICT_RERANKER", "true")

# Disable excessive logging for cleaner benchmark output
logging.basicConfig(level=logging.ERROR)
logger = logging.getLogger(__name__)

DATASETS_DIR = os.path.join(BASE_DIR, "datasets")
SCIFACT_DIR = os.path.join(DATASETS_DIR, "scifact")
RESULTS_DIR = os.path.join(BASE_DIR, "results")

def check_and_download_scifact():
    corpus_path = os.path.join(SCIFACT_DIR, "corpus.jsonl")
    queries_path = os.path.join(SCIFACT_DIR, "queries.jsonl")
    qrels_path = os.path.join(SCIFACT_DIR, "qrels", "test.tsv")
    
    if not (os.path.exists(corpus_path) and os.path.exists(queries_path) and os.path.exists(qrels_path)):
        import ssl
        ssl._create_default_https_context = ssl._create_unverified_context
        
        os.makedirs(DATASETS_DIR, exist_ok=True)
        zip_path = os.path.join(DATASETS_DIR, "scifact.zip")
        url = "https://public.ukp.informatik.tu-darmstadt.de/thakur/BEIR/datasets/scifact.zip"
        print("=" * 60)
        print(f"SciFact files missing. Downloading BEIR SciFact from {url}...")
        print("This may take 1-2 minutes...")
        print("=" * 60)
        urllib.request.urlretrieve(url, zip_path)
        print("Extracting dataset...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(DATASETS_DIR)
        os.remove(zip_path)
        print("SciFact dataset ready!")

def load_corpus() -> dict[str, str]:
    corpus = {}
    corpus_path = os.path.join(SCIFACT_DIR, "corpus.jsonl")
    with open(corpus_path, 'r', encoding='utf-8') as f:
        for line in f:
            data = json.loads(line)
            title = data.get("title", "").strip()
            text = data.get("text", "").strip()
            full_text = f"{title}\n{text}" if title else text
            corpus[data["_id"]] = full_text
    return corpus

def load_queries() -> dict[str, str]:
    queries = {}
    queries_path = os.path.join(SCIFACT_DIR, "queries.jsonl")
    with open(queries_path, 'r', encoding='utf-8') as f:
        for line in f:
            data = json.loads(line)
            queries[data["_id"]] = data["text"]
    return queries

def load_qrels() -> dict[str, list[str]]:
    qrels = {}
    qrels_path = os.path.join(SCIFACT_DIR, "qrels", "test.tsv")
    with open(qrels_path, 'r', encoding='utf-8') as f:
        # Skip header query-id\tcorpus-id\tscore
        next(f)
        for line in f:
            parts = line.strip().split("\t")
            if len(parts) >= 3:
                qid, cid, score = parts[0], parts[1], int(parts[2])
                if score > 0:
                    qrels.setdefault(qid, []).append(cid)
    return qrels

# --- Evaluation Metric Calculations ---
def calculate_metrics(retrieved_ids: list[str], relevant_ids: list[str], k: int = 5) -> dict:
    rel_set = set(relevant_ids)
    retrieved_topk = retrieved_ids[:k]
    
    hits = len(rel_set.intersection(retrieved_topk))
    
    recall = hits / len(rel_set) if rel_set else 0.0
    precision = hits / k if k > 0 else 0.0
    
    mrr = 0.0
    for idx, rid in enumerate(retrieved_topk):
        if rid in rel_set:
            mrr = 1.0 / (idx + 1)
            break
            
    dcg = 0.0
    for idx, rid in enumerate(retrieved_topk):
        if rid in rel_set:
            dcg += 1.0 / math.log2(idx + 2)
            
    ideal_hits = min(k, len(rel_set))
    idcg = sum(1.0 / math.log2(idx + 2) for idx in range(ideal_hits))
    
    ndcg = dcg / idcg if idcg > 0.0 else 0.0
    
    return {
        "recall@5": recall,
        "precision@5": precision,
        "mrr@5": mrr,
        "ndcg@5": ndcg
    }

# --- Batch Embedding Generator ---
def batch_embed_texts(texts: list[str], batch_size: int = 20) -> list:
    import google.generativeai as genai
    import config
    
    if not config.GEMINI_API_KEY:
        raise ValueError("GEMINI_API_KEY is missing inside config!")
        
    genai.configure(api_key=config.GEMINI_API_KEY)
    
    all_embeddings = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i+batch_size]
        prepared_batch = [f"title: scifact | text: {t.strip()}" for t in batch]
        
        # Call API with robust retries for 429 rate limits
        attempt = 0
        backoff = 2.0
        while attempt < 10:
            try:
                res = genai.embed_content(
                    model=config.EMBED_MODEL,
                    content=prepared_batch
                )
                embeddings = res.get("embedding", [])
                if embeddings:
                    all_embeddings.extend(embeddings)
                    break
                else:
                    raise ValueError("Gemini API returned empty embeddings list")
            except Exception as e:
                err_str = str(e).lower()
                if "429" in err_str or "quota" in err_str or "resource_exhausted" in err_str:
                    delay = 60.0
                    m = re.search(r"retry in ([\d\.]+)s", err_str)
                    if m:
                        delay = float(m.group(1)) + 2.0
                    print(f"\n[Rate Limit] Gemini embedding rate limit hit. Sleeping {delay:.2f}s to cool down...")
                    time.sleep(delay)
                    continue  # Rate limits retry indefinitely without exhausting attempt count
                attempt += 1
                if attempt >= 10:
                    print(f"\nError: Gemini embedding batch request failed: {e}")
                    sys.exit(1)
                time.sleep(backoff)
                backoff *= 2
                
        print(f"Embedded {len(all_embeddings)}/{len(texts)} documents...", end="\r")
        time.sleep(4.5) # Rate-limit padding to stay under 15 RPM limit
    print()
    return all_embeddings

# --- Log Capture Handler for Latency Metrics ---
class LatencyCaptureHandler(logging.Handler):
    def __init__(self):
        super().__init__()
        self.latencies = []
        
    def emit(self, record):
        msg = record.getMessage()
        if "[Retrieval Latency]" in msg:
            m = re.search(
                r"embed_query_ms=([\d\.]+).*?"
                r"chroma_query_ms=([\d\.]+).*?"
                r"bm25_ms=([\d\.]+).*?"
                r"fusion_ms=([\d\.]+).*?"
                r"rerank_ms=([\d\.]+).*?"
                r"retrieval_total_ms=([\d\.]+)", 
                msg
            )
            if m:
                self.latencies.append({
                    "embed_ms": float(m.group(1)),
                    "chroma_ms": float(m.group(2)),
                    "bm25_ms": float(m.group(3)),
                    "fusion_ms": float(m.group(4)),
                    "rerank_ms": float(m.group(5)),
                    "total_ms": float(m.group(6))
                })

def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass
    print("=" * 60)
    print("BEIR SCIFACT DATASET RERANKER BENCHMARK")
    print(f"Reranker Model: {os.environ.get('RERANKER_MODEL')}")
    print(f"Device Setting: {os.environ.get('RERANKER_DEVICE', 'auto')}")
    print("=" * 60)
    
    # Check and download SciFact BEIR dataset if missing
    check_and_download_scifact()
    
    # Load dataset
    print("Loading SciFact dataset...")
    corpus = load_corpus()
    queries = load_queries()
    qrels = load_qrels()
    
    # Load config and embedding info
    import config
    print(f"Active Embedding Model: {config.EMBED_MODEL}")
    
    # Load sample size config (default: 50, 0 or negative runs on all queries)
    sample_size = int(os.environ.get("BENCHMARK_SAMPLE", "50"))
    random.seed(42)
    valid_qids = [qid for qid in queries if qid in qrels and qrels[qid]]
    if sample_size <= 0:
        sampled_qids = sorted(valid_qids)
    else:
        sampled_qids = random.sample(valid_qids, min(sample_size, len(valid_qids)))
    eval_queries = [{"id": qid, "text": queries[qid]} for qid in sampled_qids]
    
    # Load corpus size config (default: full 5183, 0 or negative uses full corpus)
    corpus_size = int(os.environ.get("BENCHMARK_CORPUS_SIZE", "5183"))
    if corpus_size <= 0 or corpus_size >= len(corpus):
        selected_doc_ids = sorted(corpus.keys())
    else:
        # Collect relevant abstracts for evaluated queries
        rel_doc_ids = set()
        for qid in sampled_qids:
            rel_doc_ids.update(qrels[qid])
            
        # Sample noise abstracts to make it equal to corpus_size
        all_doc_ids = list(corpus.keys())
        noise_doc_ids = [doc_id for doc_id in all_doc_ids if doc_id not in rel_doc_ids]
        sampled_noise_ids = random.sample(noise_doc_ids, min(max(0, corpus_size - len(rel_doc_ids)), len(noise_doc_ids)))
        selected_doc_ids = sorted(list(rel_doc_ids) + sampled_noise_ids)
        
    # Prune corpus to selected documents
    corpus = {doc_id: corpus[doc_id] for doc_id in selected_doc_ids if doc_id in corpus}
    
    print(f"Loaded evaluation corpus details:")
    print(f"- Total SciFact Corpus Abstracts: {len(corpus)}")
    print(f"- Selected Queries for Evaluation: {len(eval_queries)}")
    
    from db.chroma import collection
    
    corpus_signature = hashlib.sha256(
        "\n".join(
            f"{doc_id}:{corpus[doc_id]}"
            for doc_id in sorted(corpus)
        ).encode("utf-8")
    ).hexdigest()[:12]
    active_version = f"scifact_benchmark_v1_{len(corpus)}_{corpus_signature}"
    is_offline = os.environ.get("RERANKER_MODEL") in ("mock", "test") or os.environ.get("BENCHMARK_OFFLINE") == "true"
    
    # Check force reindex
    if os.environ.get("BENCHMARK_FORCE_REINDEX") == "true":
        print("Forced reindex enabled. Deleting existing database chunks...")
        try:
            collection.delete(where={"index_version": active_version})
            collection.delete(where={"doc_id": "scifact_eval"})
        except Exception as e:
            print("Chroma cleanup info/warning:", e)
            
    # Retrieve all existing IDs from Chroma across all scifact versions to reuse valid 3072-dim embeddings
    print("Checking database for already indexed documents...")
    existing_by_doc = {}
    try:
        res = collection.get(
            include=["documents", "embeddings", "metadatas"],
            limit=10000
        )
        if res is not None and "ids" in res and len(res["ids"]) > 0:
            embeddings = res.get("embeddings")
            documents = res.get("documents")
            metadatas = res.get("metadatas")
            ids = res.get("ids", [])
            
            for i, chunk_id in enumerate(ids):
                metadata = metadatas[i] if metadatas is not None else {}
                emb = embeddings[i] if embeddings is not None else None
                doc_text = documents[i] if documents is not None else ""
                
                if emb is not None and len(emb) == 3072:
                    m_doc_id = metadata.get("source_doc_id") or metadata.get("doc_id_clean")
                    if not m_doc_id:
                        m = re.search(r"Abstract Document (\d+)", doc_text)
                        if m:
                            m_doc_id = m.group(1)
                        elif ":" in chunk_id:
                            m_doc_id = chunk_id.split(":")[-1]
                        elif "_" in chunk_id:
                            m_doc_id = chunk_id.rsplit("_", 1)[0]
                    
                    if m_doc_id:
                        existing_by_doc[str(m_doc_id)] = {
                            "embedding": emb,
                            "document": doc_text,
                            "metadata": metadata
                        }
    except Exception as e:
        print("Chroma check warning/info:", e)
        
    sorted_doc_ids = sorted(corpus.keys())
    reusable_doc_ids = []
    missing_doc_ids = []

    for doc_id in sorted_doc_ids:
        if str(doc_id) in existing_by_doc:
            reusable_doc_ids.append(doc_id)
        else:
            missing_doc_ids.append(doc_id)

    print(f"Existing compatible embeddings found: {len(existing_by_doc)}")
    print(f"Reusable embeddings: {len(reusable_doc_ids)}")
    print(f"New embeddings required: {len(missing_doc_ids)}")

    # Migrate / upsert reusable embeddings into active_version
    if reusable_doc_ids:
        print(f"Migrating {len(reusable_doc_ids)} existing 3072-dim Gemini-2 embeddings into index version '{active_version}'...")
        r_ids = []
        r_embs = []
        r_docs = []
        r_metas = []
        for doc_id in reusable_doc_ids:
            old = existing_by_doc[str(doc_id)]
            r_ids.append(f"{doc_id}_0")
            r_embs.append(old["embedding"])
            r_docs.append(corpus[doc_id])
            r_metas.append({
                "doc_id": "scifact_eval",
                "source_doc_id": str(doc_id),
                "index_version": active_version,
                "embedding_model": config.EMBED_MODEL,
                "chunk_index": 0,
                "token_count": len(corpus[doc_id].split()),
                "is_table": False
            })
        collection.upsert(
            ids=r_ids,
            embeddings=r_embs,
            documents=r_docs,
            metadatas=r_metas
        )

    if missing_doc_ids:
        print(f"Preparing Gemini embedding for {len(missing_doc_ids)} missing documents...")
        
        batch_size = 20
        total_missing = len(missing_doc_ids)
        
        # Prepare configuration for embedding calls
        import google.generativeai as genai
        if not is_offline:
            if not config.GEMINI_API_KEY:
                raise ValueError("GEMINI_API_KEY is missing inside config!")
            genai.configure(api_key=config.GEMINI_API_KEY)
            print("Calling Gemini batch embedding API and persisting in batches of 20...")
        else:
            expected_dim = 3072
            try:
                sample_doc = collection.get(limit=1, include=["embeddings"])
                if sample_doc is not None and sample_doc.get("embeddings") is not None and len(sample_doc["embeddings"]) > 0:
                    expected_dim = len(sample_doc["embeddings"][0])
            except Exception:
                pass
            print(f"Offline/mock mode: Generating dummy {expected_dim}-dimensional embeddings...")

        for i in range(0, total_missing, batch_size):
            b_doc_ids = missing_doc_ids[i:i+batch_size]
            b_texts = [corpus[doc_id] for doc_id in b_doc_ids]
            
            # 1. Generate embeddings for this batch
            if is_offline:
                b_embeddings = [[0.1] * expected_dim for _ in range(len(b_doc_ids))]
            else:
                prepared_batch = [f"title: scifact | text: {t.strip()}" for t in b_texts]
                max_attempts = 5
                backoff = 2.0
                b_embeddings = None
                for attempt in range(max_attempts):
                    try:
                        res = genai.embed_content(
                            model=config.EMBED_MODEL,
                            content=prepared_batch
                        )
                        b_embeddings = res.get("embedding", [])
                        if b_embeddings:
                            break
                        else:
                            raise ValueError("Gemini API returned empty embeddings list")
                    except Exception as e:
                        err_str = str(e).lower()
                        if "429" in err_str or "quota" in err_str:
                            delay = 60.0
                            m = re.search(r"retry in ([\d\.]+)s", err_str)
                            if m:
                                delay = float(m.group(1)) + 2.0
                            print(f"\n[Rate Limit] Gemini embedding rate limit hit. Sleeping {delay:.2f}s to cool down...")
                            time.sleep(delay)
                            continue
                        if attempt == max_attempts - 1:
                            print(f"\nError: Gemini embedding batch request failed: {e}")
                            sys.exit(1)
                        time.sleep(backoff)
                        backoff *= 2
                if b_embeddings is None:
                    print(f"\nError: Failed to embed batch {i} to {i + len(b_doc_ids)}")
                    sys.exit(1)
            
            # 2. Persist this batch immediately to ChromaDB
            chroma_ids = [f"{doc_id}_0" for doc_id in b_doc_ids]
            chroma_metadatas = []
            for doc_id in b_doc_ids:
                chroma_metadatas.append({
                    "doc_id": doc_id,
                    "index_version": active_version,
                    "embedding_model": config.EMBED_MODEL,
                    "pipeline_version": config.INDEX_PIPELINE_VERSION,
                    "chunking_version": config.CHUNKING_VERSION,
                    "source_type": "txt",
                    "filename": "scifact",
                    "chunk_index": 0,
                    "token_count": len(corpus[doc_id].split()),
                    "is_table": False
                })
            
            collection.upsert(
                ids=chroma_ids,
                embeddings=b_embeddings,
                documents=b_texts,
                metadatas=chroma_metadatas
            )
            
            completed = min(i + batch_size, total_missing)
            print(f"Embedded & persisted {completed}/{total_missing} documents...", end="\r")
            
            # Rate-limit delay (4.5s) only for online mode
            if not is_offline and completed < total_missing:
                time.sleep(4.5)
                
        print("\nChromaDB index ingestion complete and up to date.")
    else:
        print(f"All {len(sorted_doc_ids)} documents are already indexed under version {active_version}!")
        
    # Re-build BM25 index on all documents registered under scifact_eval
    print("Building/updating BM25 index on all abstracts...")
    from services.bm25_service import build_bm25_index
    bm25_chunks = []
    for doc_id in sorted_doc_ids:
        bm25_chunks.append({
            "chunk_id": f"{doc_id}_0",
            "text": corpus[doc_id],
            "is_table": False
        })
    build_bm25_index("scifact_eval", bm25_chunks, active_version)
    print("Indexing phase complete!")
        
    # Warmup the model
    if os.environ.get("RERANKER_MODEL") not in ("mock", "test"):
        print("\nInitializing reranker model and performing warmup run...")
        from services.reranker_service import RerankerManager
        try:
            manager = RerankerManager()
            manager.get_reranker()
            print("Model loaded successfully.")
            
            # Pre-warm retrieval service with a valid context query against scifact_eval
            with patch("services.vector_versioning.get_index_state", return_value={"activeVersion": active_version}), \
                 patch("config.ENABLE_RERANKER", True):
                import services.retrieval_service as rs
                rs.retrieve_context("human cerebral white matter assessed in vivo", "scifact_eval")
            print("Retrieval service pre-warmed.")
        except Exception as e:
            allow_mock = os.environ.get("BENCHMARK_ALLOW_MOCK_FALLBACK", "false").lower() == "true"
            if not allow_mock:
                raise RuntimeError(f"Real reranker failed to initialize: {e}") from e
            print(f"Warning: Failed to load real model: {e}. Falling back to MockReranker.")
            os.environ["RERANKER_MODEL"] = "mock"
            is_offline = True
            
    # --- Register Latency Handler ---
    latency_handler = LatencyCaptureHandler()
    rs_logger = logging.getLogger("services.retrieval_service")
    rs_logger.setLevel(logging.INFO)
    rs_logger.addHandler(latency_handler)
    
    # --- Query Embedding Cache (Avoids redundant network calls for identical query runs) ---
    from services.embedding_service import embed_query
    original_embed_query = embed_query
    output_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "results"))
    os.makedirs(output_dir, exist_ok=True)
    query_cache_file = os.path.join(output_dir, "query_emb_cache.json")
    query_emb_cache = {}
    if os.path.exists(query_cache_file):
        try:
            with open(query_cache_file, "r", encoding="utf-8") as f:
                query_emb_cache = json.load(f)
            print(f"Loaded {len(query_emb_cache)} cached query embeddings from disk.")
        except Exception:
            query_emb_cache = {}
    quota_exceeded = False
    
    # Retrieve embedding dimension from database dynamically if possible
    expected_dim = 3072
    try:
        sample_doc = collection.get(limit=1, include=["embeddings"])
        if sample_doc is not None and sample_doc.get("embeddings") is not None and len(sample_doc["embeddings"]) > 0:
            expected_dim = len(sample_doc["embeddings"][0])
            print(f"Detected database embedding dimension: {expected_dim}")
    except Exception as e:
        print("Warning: Could not check database embedding dimension, using default 3072.", e)
    
    if os.environ.get("RERANKER_MODEL") in ("mock", "test") or os.environ.get("BENCHMARK_OFFLINE") == "true":
        quota_exceeded = True
        
    def cached_embed_query(question, timeout_sec=20):
        nonlocal quota_exceeded
        if question in query_emb_cache:
            return query_emb_cache[question]
            
        if quota_exceeded:
            emb = [0.1] * expected_dim
        else:
            max_query_attempts = 10
            backoff = 3.0
            emb = None
            for attempt in range(max_query_attempts):
                try:
                    emb = original_embed_query(question, timeout_sec)
                    if emb is not None and len(emb) == expected_dim:
                        break
                except Exception as e:
                    err_str = str(e).lower()
                    if "429" in err_str or "quota" in err_str or "resource_exhausted" in err_str:
                        delay = 60.0
                        m = re.search(r"retry in ([\d\.]+)s", err_str)
                        if m:
                            delay = float(m.group(1)) + 2.0
                        print(f"\n[Query Embed Rate Limit] Gemini quota hit. Sleeping {delay:.1f}s...")
                        time.sleep(delay)
                        continue
                    print(f"\n[Query Embed Warning] Attempt {attempt+1}/{max_query_attempts} error: {e}")
                
                if attempt < max_query_attempts - 1:
                    print(f"\n[Query Embed Rate Limit] Retrying query embedding in {backoff:.1f}s (attempt {attempt+1}/{max_query_attempts})...")
                    time.sleep(backoff)
                    backoff *= 2
                    
            if emb is None:
                print("\nError: Gemini query embedding failed (returned None) after max retries. Aborting benchmark.")
                sys.exit(1)
            if len(emb) != expected_dim:
                raise ValueError(f"Embedding dimension mismatch: query={len(emb)}, database={expected_dim}")
                
        query_emb_cache[question] = emb
        try:
            with open(query_cache_file, "w", encoding="utf-8") as f:
                json.dump(query_emb_cache, f)
        except Exception:
            pass
        return emb

    # --- Setup Dynamic Interceptors and Patches ---
    import services.retrieval_service as rs
    
    # BEIR/SciFact benchmark override:
    # SmartDocQ normally scopes retrieval to a single user document.
    # SciFact evaluates against the complete corpus, so replace the normal
    # doc_id restriction with the benchmark's active index_version filter.
    original_query = collection.query
    def patched_query(query_embeddings=None, n_results=10, where=None, include=None, **kwargs):
        if where and "$and" in where:
            for cond in where["$and"]:
                if "index_version" in cond:
                    where = {"index_version": cond["index_version"]}
                    break
        return original_query(
            query_embeddings=query_embeddings,
            n_results=n_results,
            where=where,
            include=include,
            **kwargs
        )
        
    collection.query = patched_query
    rs.collection.query = patched_query

    # Verify index dimensions for both ChromaDB and BM25 before evaluation
    print("\nVerifying index dimensions...")
    try:
        chroma_res = collection.get(where={"index_version": active_version}, include=[], limit=10000)
        chroma_count = len(chroma_res.get("ids", []))
    except Exception as e:
        chroma_count = 0
        print("Chroma size check warning:", e)
        
    from services.bm25_service import _bm25_cache
    bm25_entry = _bm25_cache.get(("scifact_eval", active_version))
    bm25_count = len(bm25_entry["chunk_ids"]) if bm25_entry else 0
    
    print(f"- Expected corpus size: {len(corpus)}")
    print(f"- Chroma indexed chunks: {chroma_count}")
    print(f"- BM25 indexed chunks:   {bm25_count}")
    
    if chroma_count != len(corpus) or bm25_count != len(corpus):
        print("Error: Index dimensions do not match corpus size! Index corruption or partial build detected.")
        if not is_offline:
            print("Aborting benchmark. Please run with BENCHMARK_FORCE_REINDEX=true to rebuild.")
            sys.exit(1)

    print("\nRunning Evaluation Loop...")
    
    # Timing and quality tracking
    baseline_results = []
    reranked_results = []
    per_query_report = []
    
    baseline_latencies = []
    reranked_latencies = []
    query_latency_deltas = []
    candidate_pool_sizes = []
    
    # Reranker statistics
    candidate_order_changed = 0
    top5_membership_changed_count = 0
    top5_order_changed_count = 0
    top1_changed_count = 0
    total_movement = 0.0
    movement_count = 0
    ndcg_improved_count = 0
    ndcg_unchanged_count = 0
    ndcg_degraded_count = 0
    mrr_improved_count = 0
    mrr_unchanged_count = 0
    mrr_degraded_count = 0
    with patch("services.vector_versioning.get_index_state", return_value={"activeVersion": active_version}), \
         patch("services.retrieval_service.embed_query", side_effect=cached_embed_query), \
         patch("config.ENABLE_RERANKER_CACHE", False):
          
        for idx, q_item in enumerate(eval_queries):
            qid = q_item["id"]
            query_text = q_item["text"]
            relevant_ids = qrels[qid]
            
            # Print progress
            safe_query_text = query_text[:50].encode('ascii', 'replace').decode('ascii')
            print(f"Evaluating query {idx + 1}/{len(eval_queries)}: '{safe_query_text}...'", end="\r")
            
            # Capture handler log index prior to this query execution to avoid cross-query alignment drift
            latency_start_idx = len(latency_handler.latencies)
            
            # Alternating execution order to eliminate systematic OS scheduling or warm-state latency biases
            run_reranked_first = (idx % 2 == 1)
            
            if run_reranked_first:
                # 1. Run Reranked (Reranker enabled)
                with patch("config.ENABLE_RERANKER", True):
                    reranked_candidates = rs.retrieve_context(query_text, "scifact_eval", return_candidates=True)
                # 2. Run Baseline (Reranker disabled)
                with patch("config.ENABLE_RERANKER", False):
                    baseline_candidates = rs.retrieve_context(query_text, "scifact_eval", return_candidates=True)
            else:
                # 1. Run Baseline (Reranker disabled)
                with patch("config.ENABLE_RERANKER", False):
                    baseline_candidates = rs.retrieve_context(query_text, "scifact_eval", return_candidates=True)
                # 2. Run Reranked (Reranker enabled)
                with patch("config.ENABLE_RERANKER", True):
                    reranked_candidates = rs.retrieve_context(query_text, "scifact_eval", return_candidates=True)
                
            # Extract document IDs directly from the returned candidates list safely via rsplit
            baseline_ids = [c["chunk_id"].rsplit("_", 1)[0] for c in baseline_candidates] if baseline_candidates else []
            reranked_ids = [c["chunk_id"].rsplit("_", 1)[0] for c in reranked_candidates] if reranked_candidates else []
            
            candidate_pool_sizes.append(len(baseline_ids))
            
            # Calculate metrics
            m_base = calculate_metrics(baseline_ids, relevant_ids)
            m_rerank = calculate_metrics(reranked_ids, relevant_ids)
            
            # Calculate Candidate Pool Recall (recall@pool) and Recall@rerank_input prior to reranking
            rel_set = set(relevant_ids)
            hits_pool = len(rel_set.intersection(baseline_ids))
            recall_pool = hits_pool / len(rel_set) if rel_set else 0.0
            
            rerank_input_ids = baseline_ids[:config.RERANK_TOP_K]
            hits_bge_input = len(rel_set.intersection(rerank_input_ids))
            recall_bge_input = hits_bge_input / len(rel_set) if rel_set else 0.0
            
            m_base["recall@pool"] = recall_pool
            m_base["recall@bge_input"] = recall_bge_input
            m_rerank["recall@pool"] = recall_pool
            m_rerank["recall@bge_input"] = recall_bge_input
            
            baseline_results.append(m_base)
            reranked_results.append(m_rerank)
            
            # Record query-level NDCG outcomes
            ndcg_delta = m_rerank["ndcg@5"] - m_base["ndcg@5"]
            if ndcg_delta > 0:
                ndcg_improved_count += 1
            elif ndcg_delta < 0:
                ndcg_degraded_count += 1
            else:
                ndcg_unchanged_count += 1
                
            # Record query-level MRR outcomes
            mrr_delta = m_rerank["mrr@5"] - m_base["mrr@5"]
            if mrr_delta > 0:
                mrr_improved_count += 1
            elif mrr_delta < 0:
                mrr_degraded_count += 1
            else:
                mrr_unchanged_count += 1
            
            # Separate baseline and reranked latency logs from handler based on execution order
            new_latencies = latency_handler.latencies[latency_start_idx:]
            if len(new_latencies) != 2:
                raise RuntimeError(
                    f"Expected exactly 2 latency records logged for query {qid}, got {len(new_latencies)}. "
                    f"Check if duplicate log events or failures occurred."
                )
                
            log_first = new_latencies[0]
            log_second = new_latencies[1]
            if run_reranked_first:
                reranked_latencies.append(log_first)
                baseline_latencies.append(log_second)
                query_delta = (log_first["total_ms"] - log_first["embed_ms"]) - (log_second["total_ms"] - log_second["embed_ms"])
            else:
                baseline_latencies.append(log_first)
                reranked_latencies.append(log_second)
                query_delta = (log_second["total_ms"] - log_second["embed_ms"]) - (log_first["total_ms"] - log_first["embed_ms"])
            query_latency_deltas.append(query_delta)
            
            # Target Top-5 for granular comparison and movement metrics
            baseline_top5 = baseline_ids[:5]
            reranked_top5 = reranked_ids[:5]
            
            if baseline_ids != reranked_ids:
                candidate_order_changed += 1
            if set(baseline_top5) != set(reranked_top5):
                top5_membership_changed_count += 1
            if baseline_top5 != reranked_top5:
                top5_order_changed_count += 1
            if baseline_top5 and reranked_top5 and baseline_top5[0] != reranked_top5[0]:
                top1_changed_count += 1
                
            # Calculate rank movement restricted strictly to Top-5
            for rank_idx, doc in enumerate(baseline_top5):
                if doc in reranked_top5:
                    move = abs(rank_idx - reranked_top5.index(doc))
                else:
                    move = 5 - rank_idx
                total_movement += move
                movement_count += 1
            for rank_idx, doc in enumerate(reranked_top5):
                if doc not in baseline_top5:
                    move = 5 - rank_idx
                    total_movement += move
                    movement_count += 1
                    
            # Record per-query details
            per_query_report.append({
                "query": query_text,
                "relevant_ground_truth": relevant_ids,
                "baseline_retrieved": baseline_ids,
                "reranked_retrieved": reranked_ids,
                "ndcg_before": m_base["ndcg@5"],
                "ndcg_after": m_rerank["ndcg@5"],
                "recall_before": m_base["recall@5"],
                "recall_after": m_rerank["recall@5"]
            })
            
            # Rate limit spacing: only sleep between unique queries, and only if not in mock/offline mode
            if idx < len(eval_queries) - 1 and not quota_exceeded:
                time.sleep(4.5)
            
    print(f"\nCompleted evaluation over {len(eval_queries)} queries.")
    rs_logger.removeHandler(latency_handler)
    
    # Calculate average metrics
    avg_base = {k: sum(r[k] for r in baseline_results) / len(baseline_results) for k in ["ndcg@5", "mrr@5", "recall@5", "precision@5", "recall@pool", "recall@bge_input"]}
    avg_rerank = {k: sum(r[k] for r in reranked_results) / len(reranked_results) for k in ["ndcg@5", "mrr@5", "recall@5", "precision@5", "recall@pool", "recall@bge_input"]}
    
    # Calculate latency averages for baseline
    b_embed = [l["embed_ms"] for l in baseline_latencies]
    b_chroma = [l["chroma_ms"] for l in baseline_latencies]
    b_bm25 = [l["bm25_ms"] for l in baseline_latencies]
    b_fusion = [l["fusion_ms"] for l in baseline_latencies]
    b_total = [l["total_ms"] for l in baseline_latencies]
    
    avg_b_embed = sum(b_embed) / len(b_embed) if b_embed else 0.0
    avg_b_chroma = sum(b_chroma) / len(b_chroma) if b_chroma else 0.0
    avg_b_bm25 = sum(b_bm25) / len(b_bm25) if b_bm25 else 0.0
    avg_b_fusion = sum(b_fusion) / len(b_fusion) if b_fusion else 0.0
    avg_b_total = sum(b_total) / len(b_total) if b_total else 0.0
    
    # Calculate latency averages for reranked
    r_embed = [l["embed_ms"] for l in reranked_latencies]
    r_chroma = [l["chroma_ms"] for l in reranked_latencies]
    r_bm25 = [l["bm25_ms"] for l in reranked_latencies]
    r_fusion = [l["fusion_ms"] for l in reranked_latencies]
    r_rerank = [l["rerank_ms"] for l in reranked_latencies]
    r_total = [l["total_ms"] for l in reranked_latencies]
    
    avg_r_embed = sum(r_embed) / len(r_embed) if r_embed else 0.0
    avg_r_chroma = sum(r_chroma) / len(r_chroma) if r_chroma else 0.0
    avg_r_bm25 = sum(r_bm25) / len(r_bm25) if r_bm25 else 0.0
    avg_r_fusion = sum(r_fusion) / len(r_fusion) if r_fusion else 0.0
    avg_r_rerank = sum(r_rerank) / len(r_rerank) if r_rerank else 0.0
    avg_r_total = sum(r_total) / len(r_total) if r_total else 0.0
    
    baseline_excl_embed = avg_b_total - avg_b_embed
    reranked_excl_embed = avg_r_total - avg_r_embed
    paired_pipeline_delta = sum(query_latency_deltas) / len(query_latency_deltas) if query_latency_deltas else 0.0
    paired_pipeline_delta_pct = (
        paired_pipeline_delta / baseline_excl_embed * 100
        if baseline_excl_embed > 0
        else 0.0
    )
    avg_movement = total_movement / movement_count if movement_count > 0 else 0.0
    avg_candidate_pool_size = sum(candidate_pool_sizes) / len(candidate_pool_sizes) if candidate_pool_sizes else 0.0
    
    def pct(count, total):
        return (count / total * 100) if total else 0.0
        
    # Save per-query details to results folder
    os.makedirs(RESULTS_DIR, exist_ok=True)
    per_query_path = os.path.join(RESULTS_DIR, "per_query_results.json")
    with open(per_query_path, "w") as f:
        json.dump(per_query_report, f, indent=4)
        
    # Save summary metrics report
    report_path = os.path.join(RESULTS_DIR, "scifact_metrics.json")
    summary = {
        "corpus_info": {
            "documents_indexed": len(corpus),
            "queries_evaluated": len(eval_queries)
        },
        "model_info": {
            "embedding_model": config.EMBED_MODEL,
            "reranker_model": os.environ.get("RERANKER_MODEL")
        },
        "retrieval_config": {
            "dense_top_k": 20,
            "bm25_top_k": 20,
            "configured_max_candidate_pool_size": 40,
            "rerank_top_k": config.RERANK_TOP_K,
            "final_top_k": config.FINAL_CONTEXT_TOP_K
        },
        "candidate_pool": {
            "max_configured": 40,
            "average_actual": avg_candidate_pool_size,
            "min_actual": min(candidate_pool_sizes) if candidate_pool_sizes else 0,
            "max_actual": max(candidate_pool_sizes) if candidate_pool_sizes else 0
        },
        "query_embedding_cache": {
            "enabled": True,
            "shared_between_baseline_and_reranked": True,
            "query_embedding_latency": {
                "baseline_actual_ms": avg_b_embed,
                "reranked_shared_cached_ms": avg_b_embed
            }
        },
        "latency_baseline_ms": {
            "dense_search": avg_b_chroma,
            "bm25": avg_b_bm25,
            "rrf": avg_b_fusion,
            "pipeline_total_excl_embed": baseline_excl_embed,
            "total": avg_b_total
        },
        "latency_reranked_ms": {
            "dense_search": avg_r_chroma,
            "bm25": avg_r_bm25,
            "rrf": avg_r_fusion,
            "cross_encoder": avg_r_rerank,
            "pipeline_total_excl_embed": reranked_excl_embed,
            "total_estimated_with_shared_embed": avg_b_embed + reranked_excl_embed
        },
        "reranker_component_overhead_ms": avg_r_rerank,
        "paired_pipeline_delta_ms": paired_pipeline_delta,
        "paired_pipeline_delta_pct": paired_pipeline_delta_pct,
        "baseline_metrics": avg_base,
        "reranked_metrics": avg_rerank,
        "reranker_statistics": {
            "queries_evaluated": len(eval_queries),
            "queries_processed_by_reranker": len(eval_queries),
            "candidate_order_changed": candidate_order_changed,
            "candidate_order_changed_pct": pct(candidate_order_changed, len(eval_queries)),
            "top5_membership_changed": top5_membership_changed_count,
            "top5_membership_changed_pct": pct(top5_membership_changed_count, len(eval_queries)),
            "top5_order_changed": top5_order_changed_count,
            "top5_order_changed_pct": pct(top5_order_changed_count, len(eval_queries)),
            "top1_changed": top1_changed_count,
            "top1_changed_pct": pct(top1_changed_count, len(eval_queries)),
            "avg_rank_movement": avg_movement,
            "ndcg_improved": ndcg_improved_count,
            "ndcg_unchanged": ndcg_unchanged_count,
            "ndcg_degraded": ndcg_degraded_count,
            "mrr_improved": mrr_improved_count,
            "mrr_unchanged": mrr_unchanged_count,
            "mrr_degraded": mrr_degraded_count
        }
    }
    with open(report_path, "w") as f:
        json.dump(summary, f, indent=4)
        
    # Print final output in the requested layout
    print("\n" + "=" * 60)
    print("FINAL BENCHMARK EVALUATION SUMMARY")
    print("=" * 60)
    print("SciFact Corpus")
    print(f"Documents Indexed: {len(corpus)}")
    print(f"Queries Evaluated: {len(eval_queries)}")
    print(f"\nEmbedding Model: {summary['model_info']['embedding_model']}")
    print(f"Reranker: {summary['model_info']['reranker_model']}")
    
    print(f"\nAverage Latency")
    print(f"\nBaseline:")
    print(f"  Embedding: {avg_b_embed:.2f} ms")
    print(f"  Dense Search: {avg_b_chroma:.2f} ms")
    print(f"  BM25: {avg_b_bm25:.2f} ms")
    print(f"  RRF: {avg_b_fusion:.2f} ms")
    print(f"  Pipeline Total (excl. embedding):   {baseline_excl_embed:.2f} ms")
    print(f"  End-to-End Total (incl. embedding): {avg_b_total:.2f} ms")
    
    reranked_sim_e2e = reranked_excl_embed + avg_b_embed
    print(f"\nReranked:")
    print(f"  Shared Query Embedding:             {avg_b_embed:.2f} ms")
    print(f"  Dense Search:                       {avg_r_chroma:.2f} ms")
    print(f"  BM25:                               {avg_r_bm25:.2f} ms")
    print(f"  RRF:                                {avg_r_fusion:.2f} ms")
    print(f"  CrossEncoder:                       {avg_r_rerank:.2f} ms")
    print(f"  Pipeline Total (excl. embedding):   {reranked_excl_embed:.2f} ms")
    print(f"  Estimated E2E (shared embedding):   {reranked_sim_e2e:.2f} ms")
    
    print(f"\nBGE CrossEncoder Latency: {avg_r_rerank:.2f} ms")
    print(f"Paired Pipeline Delta:    {paired_pipeline_delta:+.2f} ms")
    print(f"Paired Pipeline Overhead: {paired_pipeline_delta_pct:+.2f}%")
    
    print(f"\nRetrieval Metrics")
    print("| Metric | Baseline (Hybrid RRF) | Reranked (Hybrid RRF + BGE) | Delta | Relative Gain |")
    print("| :--- | :---: | :---: | :---: | :---: |")
    for k in ["recall@5", "precision@5", "mrr@5", "ndcg@5"]:
        val_base = avg_base[k]
        val_rerank = avg_rerank[k]
        diff = val_rerank - val_base
        sign = "+" if diff >= 0 else ""
        relative_gain = (diff / val_base * 100) if val_base > 0 else 0.0
        gain_sign = "+" if relative_gain >= 0 else ""
        print(f"| {k.upper()} | {val_base:.4f} | {val_rerank:.4f} | {sign}{diff:.4f} | {gain_sign}{relative_gain:.2f}% |")
        
    print(f"\nCandidate Retrieval Coverage")
    print(f"----------------------------")
    print(f"Recall@Pool:          {avg_base['recall@pool']:.4f}")
    print(f"Recall@BGE Input:     {avg_base['recall@bge_input']:.4f}")
    print(f"Average Pool Size:    {avg_candidate_pool_size:.1f} candidates (min={min(candidate_pool_sizes) if candidate_pool_sizes else 0}, max={max(candidate_pool_sizes) if candidate_pool_sizes else 0})")
        
    total_q = len(eval_queries)
    print(f"\nReranker Statistics")
    print(f"Queries evaluated: {total_q}")
    print(f"Queries processed by reranker: {total_q}")
    print(f"Queries with candidate ordering changes:          {candidate_order_changed} / {total_q} ({pct(candidate_order_changed, total_q):.1f}%)")
    print(f"Top-5 membership changed:                        {top5_membership_changed_count} / {total_q} ({pct(top5_membership_changed_count, total_q):.1f}%)")
    print(f"Top-5 order changed:                             {top5_order_changed_count} / {total_q} ({pct(top5_order_changed_count, total_q):.1f}%)")
    print(f"Top-1 changed:                                   {top1_changed_count} / {total_q} ({pct(top1_changed_count, total_q):.1f}%)")
    print(f"Average Top-5 rank displacement (custom):        {avg_movement:.2f} positions")
    
    print(f"\nnDCG@5 Outcomes:")
    print(f"  Improved:  {ndcg_improved_count} / {total_q} ({pct(ndcg_improved_count, total_q):.1f}%)")
    print(f"  Unchanged: {ndcg_unchanged_count} / {total_q} ({pct(ndcg_unchanged_count, total_q):.1f}%)")
    print(f"  Degraded:  {ndcg_degraded_count} / {total_q} ({pct(ndcg_degraded_count, total_q):.1f}%)")
    
    print(f"\nMRR@5 Outcomes:")
    print(f"  Improved:  {mrr_improved_count} / {total_q} ({pct(mrr_improved_count, total_q):.1f}%)")
    print(f"  Unchanged: {mrr_unchanged_count} / {total_q} ({pct(mrr_unchanged_count, total_q):.1f}%)")
    print(f"  Degraded:  {mrr_degraded_count} / {total_q} ({pct(mrr_degraded_count, total_q):.1f}%)")
    
    try:
        import psutil
        process = psutil.Process(os.getpid())
        mem_mb = process.memory_info().rss / (1024 * 1024)
        print(f"\nCurrent Process Memory Usage: {mem_mb:.2f} MB")
    except ImportError:
        pass
    print(f"Metrics saved to {report_path}")
    print(f"Per-query reports saved to {per_query_path}")
    print("=" * 60)

if __name__ == "__main__":
    main()
