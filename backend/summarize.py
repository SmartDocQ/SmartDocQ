from flask import Blueprint, request, jsonify
import re
from typing import List, Tuple, Optional


summarize_bp = Blueprint("summarize", __name__)


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


def _chunk_text(text: str, size: int = 1600, overlap: int = 200) -> List[str]:
    """Chunk text with paragraph awareness, similar to main.chunk_text but self-contained.
    Keeps a small overlap so map-reduce summaries retain continuity.
    """
    text = (text or "").strip()
    if not text:
        return []
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    if not paras:
        paras = [text]
    windows, buf, cur = [], [], 0
    for p in paras:
        plen = len(p) + 2
        if not buf or cur + plen <= size:
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

Selection:\n\n{selection}

Summary:
"""


def _map_reduce_summary(genai, model_name: str, selection: str, style: str, bullets: bool) -> str:
    model = genai.GenerativeModel(model_name)
    chunks = _chunk_text(selection)
    if len(chunks) <= 1:
        resp = model.generate_content(_build_prompt(selection, style, bullets), request_options={"timeout": 30})
        return (getattr(resp, "text", "") or "").strip()

    partials = []
    for ch in chunks:
        r = model.generate_content(_build_prompt(ch, style, bullets), request_options={"timeout": 30})
        partials.append((getattr(r, "text", "") or "").strip())

    # Reduce step
    combined = "\n\n".join(p for p in partials if p)
    reduce_prompt = f"""
You are aggregating multiple partial summaries of a longer selection. Merge them into a single cohesive summary.
Remove redundancy, keep important details and numbers, and keep the tone neutral.
Target length: {'120-180 words' if style=='concise' else '200-300 words' if style=='detailed' else '80-120 words'}.

Partials:\n\n{combined}

Final summary:
"""
    final = model.generate_content(reduce_prompt, request_options={"timeout": 30})
    return (getattr(final, "text", "") or "").strip()


def init_summarizer(TEXT_MODEL: str, genai_module):
    """Initialize routes with provided model config. Call from main.py after genai.configure()."""

    @summarize_bp.route("/api/summarize", methods=["POST"])
    def summarize_endpoint():
        body = request.get_json(silent=True) or {}
        selection_text = (body.get("selectionText") or body.get("text") or "").strip()
        # Optional context for audit and UI anchors
        doc_id = (body.get("docId") or body.get("doc_id") or "").strip()
        pages = body.get("pages")  # optional [start,end] or list
        style = (body.get("style") or "concise").lower()
        bullets = bool(body.get("bullets", True))

        if not selection_text:
            return jsonify({"error": "Missing selectionText"}), 400

        cleaned = _clean_selection_text(selection_text)
        try:
            summary = _map_reduce_summary(genai_module, TEXT_MODEL, cleaned, style, bullets)
            if not summary:
                return jsonify({"error": "Failed to summarize"}), 500
            return jsonify({
                "summary": summary,
                "doc_id": doc_id or None,
                "pages": pages,
                "length": len(cleaned),
            })
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    return summarize_bp
