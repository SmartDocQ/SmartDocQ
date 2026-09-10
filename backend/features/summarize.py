from flask import Blueprint, request, jsonify, current_app
import re
import logging
from typing import List, Optional

from config import FLASK_DEBUG

summarize_bp = Blueprint("summarize", __name__)
logger = logging.getLogger(__name__)

VALID_STYLES = {"short", "concise", "detailed"}

def _clean_selection_text(text: str) -> str:
    """Normalize selection text from PDF/Word to improve summary quality.
    - De-hyphenate line breaks inside words
    - Unwrap hard-wrapped lines where appropriate
    - Normalize bullets
    - Trim excessive whitespace
    """
    if not text:
        return ""
    t = text.replace("\r", "")
    # de-hyphenate line breaks like "learn-\ning" -> "learning"
    t = re.sub(r"([A-Za-z])-[\n\r]+([A-Za-z])", r"\1\2", t)
    # unwrap lines when the next line starts with lower-case or mid-sentence
    t = re.sub(r"([^\n])\n(?!\n)([a-z0-9(])", r"\1 \2", t)
    # collapse >2 consecutive newlines to exactly 2
    t = re.sub(r"\n\s*\n\s*\n+", "\n\n", t)
    # normalize bullets
    t = re.sub(r"^\s*[-•*]\s*", "• ", t, flags=re.MULTILINE)
    return t.strip()

def _split_oversized_block(block: str, size: int, overlap: int = 200) -> List[str]:
    """Two-stage split for blocks exceeding size limit:
    1. Sentence-aware split on sentence boundaries
    2. Hard character split for sentences still exceeding size limit
    Leaves room for the configured overlap when blocks are combined into windows.
    """
    effective_max = max(size - max(overlap, 0) - 2, 100)
    if len(block) <= effective_max:
        return [block]

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", block) if s.strip()]
    if not sentences:
        sentences = [block]

    result = []
    for s in sentences:
        if len(s) <= effective_max:
            result.append(s)
        else:
            # Stage 2: hard character split
            for i in range(0, len(s), effective_max):
                chunk = s[i : i + effective_max].strip()
                if chunk:
                    result.append(chunk)
    return result

def _chunk_text(text: str, size: int = 1600, overlap: int = 200) -> List[str]:
    """Chunk text with paragraph awareness, sentence splitting, and hard max bounds.
    Keeps a small overlap so map-reduce summaries retain continuity.
    """
    text = (text or "").strip()
    if not text:
        return []

    raw_paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not raw_paras:
        raw_paras = [text]

    # Pre-process paragraphs: split any oversized paragraph into <= effective_max blocks
    paras = []
    for p in raw_paras:
        paras.extend(_split_oversized_block(p, size, overlap))

    windows, buf, cur = [], [], 0
    for p in paras:
        plen = len(p) + 2
        if not buf:
            buf.append(p)
            cur = plen
        elif cur + plen <= size:
            buf.append(p)
            cur += plen
        else:
            joined = "\n\n".join(buf)
            windows.append(joined)
            if overlap > 0 and len(joined) > overlap:
                tail = joined[-overlap:]
                buf = [tail, p]
                cur = len(tail) + plen
            else:
                buf = [p]
                cur = plen
    if buf:
        windows.append("\n\n".join(buf))
    return windows

def _build_prompt(selection: str, style: str = "concise", bullets: bool = True) -> str:
    bullet_hint = "Use bullet points where helpful." if bullets else "Write as short paragraphs."
    style_hint = {
        "concise": "Keep it concise (5-8 bullets or ~120-180 words).",
        "detailed": "Be detailed but focused (8-12 bullets or ~200-300 words).",
        "short": "Very short (3-5 bullets or ~80-120 words).",
    }.get(style, "Keep it concise (5-8 bullets or ~120-180 words).")
    return f"""
You are a helpful assistant. Summarize the selection below faithfully without adding facts.
Preserve key terms, numbers, and definitions. {bullet_hint} {style_hint}

Selection:

{selection}

Summary:
"""

from services.llm_router import router as default_router

class TextSummarizer:
    """Service handling text summarization via LLM router."""

    def __init__(self, router=None):
        self.router = router or default_router

    def summarize(self, selection_text: str, style: str = "concise", bullets: bool = True) -> str:
        cleaned = _clean_selection_text(selection_text)
        if not cleaned:
            raise ValueError("Missing selectionText")

        chunks = _chunk_text(cleaned)
        if len(chunks) <= 1:
            prompt = _build_prompt(cleaned, style, bullets)
            res = self.router.generate(task="summarization", prompt=prompt)
            return (res.get("text", "") or "").strip()

        partials = []
        for ch in chunks:
            prompt = _build_prompt(ch, style, bullets)
            res = self.router.generate(task="summarization", prompt=prompt)
            partials.append((res.get("text", "") or "").strip())

        combined = "\n\n".join(p for p in partials if p)
        reduce_prompt = f"""
You are aggregating multiple partial summaries of a longer selection. Merge them into a single cohesive summary.
Remove redundancy, keep important details and numbers, and keep the tone neutral.
Target length: {'120-180 words' if style=='concise' else '200-300 words' if style=='detailed' else '80-120 words'}.

Partials:

{combined}

Final summary:
"""
        res = self.router.generate(task="summarization", prompt=reduce_prompt)
        return (res.get("text", "") or "").strip()


@summarize_bp.route("/api/summarize", methods=["POST", "OPTIONS"])
def summarize_endpoint():
    """Summarize text selection via TextSummarizer retrieved from current_app.extensions."""
    if request.method == "OPTIONS":
        return ("", 204)

    summarizer = current_app.extensions.get("text_summarizer")
    if summarizer is None:
        return jsonify({"error": "Summarizer service not initialized"}), 500

    body = request.get_json(silent=True) or {}
    selection_text = (body.get("selectionText") or body.get("text") or "").strip()
    doc_id = (body.get("docId") or body.get("doc_id") or "").strip()
    pages = body.get("pages")
    style_raw = body.get("style")
    style = (style_raw or "concise").lower()
    bullets_val = body.get("bullets", True)

    if not selection_text:
        return jsonify({"error": "Missing selectionText"}), 400

    if style not in VALID_STYLES:
        return jsonify({"error": "Invalid style. Must be one of: short, concise, detailed"}), 400

    if not isinstance(bullets_val, bool):
        return jsonify({"error": "'bullets' parameter must be a boolean"}), 400
    bullets = bullets_val

    try:
        summary = summarizer.summarize(selection_text=selection_text, style=style, bullets=bullets)
        if not summary:
            return jsonify({"error": "Failed to summarize"}), 500
        cleaned = _clean_selection_text(selection_text)
        return jsonify({
            "summary": summary,
            "doc_id": doc_id or None,
            "pages": pages,
            "length": len(cleaned),
        })
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    except Exception as e:
        logger.exception("Unexpected error in /api/summarize")
        message = str(e) if FLASK_DEBUG else "An unexpected server error occurred."
        return jsonify({"error": message}), 500