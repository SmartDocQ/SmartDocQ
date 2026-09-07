from dotenv import load_dotenv
load_dotenv()

import os
import re

FRONTEND_ORIGINS = os.environ.get("FRONTEND_ORIGINS", "http://localhost:3000")
try:
    MAX_UPLOAD_SIZE_MB = int(os.environ.get("MAX_UPLOAD_SIZE_MB", "15"))
    if MAX_UPLOAD_SIZE_MB <= 0:
        MAX_UPLOAD_SIZE_MB = 15
except ValueError:
    MAX_UPLOAD_SIZE_MB = 15

MAX_UPLOAD_SIZE = MAX_UPLOAD_SIZE_MB * 1024 * 1024
MAX_CONTENT_LENGTH = MAX_UPLOAD_SIZE

# ====== CORS ORIGINS PROCESSING ======
def build_allowed_origins(origins_str: str) -> list:
    try:
        raw = [o.strip() for o in origins_str.split(",") if o.strip()]
    except Exception:
        return ["http://localhost:3000"]

    processed = []
    for entry in raw:
        if entry.startswith("*."):
            domain = re.escape(entry[2:])
            processed.append(fr"https?://.*\.{domain}$")
        elif entry.startswith("http://*.") or entry.startswith("https://*."):
            scheme, rest = entry.split("://", 1)
            domain = rest[2:]
            domain_escaped = re.escape(domain)
            processed.append(fr"{scheme}://.*\.{domain_escaped}$")
        else:
            processed.append(entry)
    return processed

ALLOWED_ORIGINS = build_allowed_origins(FRONTEND_ORIGINS)

# ====== API / SERVICE CONFIG ======
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
NODE_BASE_URL = os.environ.get("NODE_BASE_URL", "http://localhost:5000")
SERVICE_TOKEN = os.environ.get("SERVICE_TOKEN")
if not SERVICE_TOKEN:
    raise ValueError("SERVICE_TOKEN environment variable is required")
NODE_FETCH_TIMEOUT = int(os.environ.get("NODE_FETCH_TIMEOUT", "45"))
CHUNK_UPSERT_URL = os.environ.get("CHUNK_UPSERT_URL", f"{NODE_BASE_URL}/api/search/internal/chunks/upsert")

# ====== MODEL CONFIG ======
TEXT_MODEL = os.environ.get("TEXT_MODEL", "models/gemini-2.5-flash")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "models/gemini-embedding-2")

# ====== INDEXING / PIPELINE VERSIONING ======
# Bump this when you make changes that should force reindexing even if the
# embedding model stays the same (e.g., new chunking strategy, new cleaners).
INDEX_PIPELINE_VERSION = os.environ.get("INDEX_PIPELINE_VERSION", "7")
CHUNKING_VERSION = os.environ.get("CHUNKING_VERSION", "3")
NOISE_HEADERS = {
    entry.strip().lower()
    for entry in os.environ.get(
        "NOISE_HEADERS",
        "references,bibliography,acknowledgements,acknowledgments,appendix,author contributions,funding,conflict of interest,ethics statement,supplementary material",
    ).split(",")
    if entry.strip()
}

# ====== CHUNKING PIPELINE PARAMETERS ======
CHUNK_TARGET_TOKENS = int(os.environ.get("CHUNK_TARGET_TOKENS", "512"))
CHUNK_SOFT_LIMIT = int(os.environ.get("CHUNK_SOFT_LIMIT", "600"))
CHUNK_HARD_LIMIT = int(os.environ.get("CHUNK_HARD_LIMIT", "700"))
CHUNK_OVERLAP_TOKENS = int(os.environ.get("CHUNK_OVERLAP_TOKENS", "80"))
IGNORE_REFERENCE_SECTIONS = os.environ.get("IGNORE_REFERENCE_SECTIONS", "True").strip().lower() in ("1", "true", "yes")


# Batch size used by the indexer when upserting chunks into Chroma.
# Can be tuned without code changes.
INDEX_BATCH_SIZE = int(os.environ.get("INDEX_BATCH_SIZE", "64"))

# ====== CHROMA CONFIG ======
CHROMA_DB_PATH = os.environ.get("CHROMA_DB_PATH", os.path.join(os.getcwd(), "chroma_db"))

# ====== MISC ======
URL_REGEX = re.compile(
    r"(https?://[^\s]+|www\.[^\s]+|ftp://[^\s]+|mailto:[^\s]+|t\.me/[^\s]+|discord\.gg/[^\s]+)",
    re.IGNORECASE
)
NOISE_DISTANCE_THRESHOLD = 0.6

# ====== SECURITY CONFIG ======
JAILBREAK_THRESHOLD = int(os.environ.get("JAILBREAK_THRESHOLD", "3"))

# When enabled, client-facing error responses may include exception details.
FLASK_DEBUG = os.environ.get("FLASK_DEBUG", "0").strip().lower() in ("1", "true", "yes")

# ====== SPREADSHEET PREVIEW CONFIG ======
MAX_PREVIEW_ROWS_PER_SHEET = int(os.environ.get("MAX_PREVIEW_ROWS_PER_SHEET", "500"))
MAX_PREVIEW_COLUMNS = int(os.environ.get("MAX_PREVIEW_COLUMNS", "100"))

# ====== RERANKER CONFIG ======
ENABLE_RERANKER = os.environ.get("ENABLE_RERANKER", "False").strip().lower() in ("1", "true", "yes")
RERANKER_MODEL = os.environ.get("RERANKER_MODEL", "BAAI/bge-reranker-base")
RERANKER_DEVICE = os.environ.get("RERANKER_DEVICE", "auto")
RERANK_TOP_K = int(os.environ.get("RERANK_TOP_K", "15"))
FINAL_CONTEXT_TOP_K = int(os.environ.get("FINAL_CONTEXT_TOP_K", "5"))
ENABLE_RERANKER_CACHE = os.environ.get("ENABLE_RERANKER_CACHE", "True").strip().lower() in ("1", "true", "yes")
RERANKER_CACHE_SIZE = int(os.environ.get("RERANKER_CACHE_SIZE", "128"))
RERANKER_CACHE_TTL = int(os.environ.get("RERANKER_CACHE_TTL", "1800"))  # 30 minutes
RERANKER_BATCH_SIZE = int(os.environ.get("RERANKER_BATCH_SIZE", "16"))

