"""Document-level helpers that don't belong to LLM generation or raw retrieval.
- Heading extraction from text
- Topic suggestion for a document (used by the ask greeting flow)
"""
import re
import logging

from state.memory_store import consent_state
from services.retrieval_service import fetch_doc_from_node
from utils.extraction import extract_text_for_mimetype

logger = logging.getLogger(__name__)


class DocumentNotFoundError(Exception):
    """Raised when a requested document cannot be found in Chroma index or Node storage."""
    pass


class DocumentService:
    """Document service handling context loading and text extraction."""

    def __init__(
        self,
        collection=None,
        has_index=None,
        fetch_doc_from_node=None,
        extract_text_for_mimetype=None,
    ):
        self.collection = collection
        self.has_index = has_index
        self.fetch_doc_from_node = fetch_doc_from_node
        self.extract_text_for_mimetype = extract_text_for_mimetype

    def get_context(self, doc_id: str) -> str:
        """Build context from indexed Chroma chunks if available; else fetch raw text from Node."""
        doc_id = (doc_id or "").strip()
        if not doc_id:
            return ""

        context = ""

        # Attempt 1: Fetch indexed chunks from vector database if indexed
        if self.has_index and callable(self.has_index) and self.has_index(doc_id):
            if self.collection:
                res = self.collection.get(where={"doc_id": doc_id}, include=["documents"], limit=500)
                docs = (res or {}).get("documents") or []
                if docs and isinstance(docs[0], list):
                    docs = docs[0]
                context = "\n\n".join(docs)

        # Attempt 2: Fallback to fetching raw file text from Node API
        if not context and self.fetch_doc_from_node and self.extract_text_for_mimetype:
            ok, filename, mimetype, data_bytes = self.fetch_doc_from_node(doc_id)
            if not ok:
                raise DocumentNotFoundError(filename or f"Document {doc_id} not found")
            if data_bytes:
                context = self.extract_text_for_mimetype(filename, mimetype, data_bytes)

        return (context or "").strip()


GENERIC_TOPICS = [
    "Introduction", "Overview", "Summary", "Background", "Objectives",
    "Methodology", "Approach", "Results", "Discussion", "Conclusion",
    "Features", "Requirements", "Limitations", "Future Work",
]

_KEYWORD_SET = {k.lower() for k in GENERIC_TOPICS}
_KEYWORD_PAT = re.compile(r"\b(" + "|".join(re.escape(k) for k in _KEYWORD_SET) + r")\b")
_NUM_PAT = re.compile(r"^\d+(?:\.\d+){0,3}\s+.{3,80}$")


def _norm(s: str) -> str:
    return re.sub(r"\s+", " ", s.lower().strip(" :.-"))


def extract_headings_from_text(text: str, limit: int = 6) -> list:
    if not text:
        return []

    candidates = []
    seen: set = set()

    for ln in (l.strip() for l in text.splitlines()):
        if not ln or len(ln) > 100:
            continue

        low = ln.lower()

        alpha_ratio = sum(c.isalpha() for c in ln) / max(len(ln), 1)
        is_upperish = ln.upper() == ln and alpha_ratio > 0.6

        ends_colon = ln.endswith(":") and 3 <= len(ln) <= 80
        looks_numbered = bool(_NUM_PAT.match(ln))
        has_keyword = bool(_KEYWORD_PAT.search(low))

        words = ln.split()

        # tighter short_title heuristic
        short_title = (
            1 <= len(words) <= 5
            and ln[0].isupper()
            and ln[-1] not in ".?!"
        )

        score = 0
        score += 2 if looks_numbered else 0
        score += 2 if is_upperish else 0
        score += 1 if ends_colon else 0
        score += 2 if has_keyword else 0
        score += 1 if short_title else 0

        if score >= 2:
            key = _norm(ln)
            if key not in seen:
                seen.add(key)
                candidates.append(ln.strip().rstrip(": ."))
                if len(candidates) >= limit:
                    break

    return candidates


def suggest_topics_for_doc(doc_id: str) -> list:
    st = consent_state.get(doc_id) or {}

    if st.get("sensitive") and not st.get("confirmed"):
        return GENERIC_TOPICS[:6]

    try:
        ok, filename, mimetype, data_bytes = fetch_doc_from_node(doc_id)
        if not ok:
            return GENERIC_TOPICS[:6]

        text = extract_text_for_mimetype(
            filename or "document",
            mimetype or "",
            data_bytes or b""
        )

        heads = extract_headings_from_text(text, limit=6)
        return heads if heads else GENERIC_TOPICS[:6]

    except Exception as e:
        logger.warning(
            "[DocumentService] Failed to fetch topics for %s: %s",
            doc_id,
            e
        )
        return GENERIC_TOPICS[:6]