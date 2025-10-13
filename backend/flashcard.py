from flask import Blueprint, request, jsonify
import re as _re

# Dependencies to be initialized from main.py
collection = None
has_index = None
fetch_doc_from_node = None
extract_text_for_mimetype = None
TEXT_MODEL = None
genai = None


def init_flashcards(_collection, _has_index, _fetch_doc_from_node, _extract_text_for_mimetype, _TEXT_MODEL, _genai):
    global collection, has_index, fetch_doc_from_node, extract_text_for_mimetype, TEXT_MODEL, genai
    collection = _collection
    has_index = _has_index
    fetch_doc_from_node = _fetch_doc_from_node
    extract_text_for_mimetype = _extract_text_for_mimetype
    TEXT_MODEL = _TEXT_MODEL
    genai = _genai


flashcard_bp = Blueprint("flashcard", __name__)


@flashcard_bp.route("/api/document/generate-flashcards", methods=["POST"])
def generate_flashcards():
    """Generate flashcards based on the uploaded document content.
    Request JSON:
      - doc_id: string (required)
      - num_cards: int (default 20)
    Response JSON: { success, flashcards: [ {front, back, category, difficulty}... ] } or { success: false, error }
    """
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("doc_id") or body.get("documentId") or "").strip()
    if not doc_id:
        return jsonify({"success": False, "error": "doc_id is required"}), 400
    try:
        num_cards = int(body.get("num_cards", 20))
    except Exception:
        num_cards = 20
    # Clamp to reasonable bounds
    num_cards = max(3, min(num_cards, 50))

    # Build context from indexed chunks if available; else fetch raw text
    context = ""
    try:
        if has_index(doc_id):
            res = collection.get(where={"doc_id": doc_id}, include=["documents"], limit=500)
            docs = (res or {}).get("documents") or []
            if docs and isinstance(docs[0], list):
                docs = docs[0]
            context = "\n\n".join(docs)
        else:
            ok, filename, mimetype, data_bytes = fetch_doc_from_node(doc_id)
            if not ok:
                return jsonify({"success": False, "error": filename}), 404
            context = extract_text_for_mimetype(filename, mimetype, data_bytes)
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to load document: {e}"}), 500

    context = (context or "").strip()
    if not context:
        return jsonify({"success": False, "error": "Document has no readable text"}), 400

    # Prompt templates for iterative generation
    sys_instr = (
        "You are SmartDoc Flashcard Generator. Given the document context, generate concise study flashcards strictly about the content. "
        "Return ONLY valid JSON with schema: {\n"
        "  \"flashcards\": [\n"
        "    {\n"
        "      \"front\": string,  // term, concept, or question\n"
        "      \"back\": string,   // clear answer or explanation\n"
        "      \"category\": string,  // optional short section/topic name\n"
        "      \"difficulty\": \"Easy|Medium|Hard\"\n"
        "    }\n"
        "  ]\n"
        "}\n"
        "Rules:\n"
        "- Generate exactly the requested number of cards if possible; if not, generate as many as the context supports.\n"
        "- Each card must be answerable from the context.\n"
        "- Keep 'front' short (<= 140 chars) and 'back' focused (<= 400 chars).\n"
        "- Prefer diverse categories and coverage across the document.\n"
        "- Do not duplicate any previously generated cards provided to you.\n"
    )

    def _build_user_instr(to_generate: int, existing_fronts: list[str]) -> str:
        # Provide existing fronts to help the model avoid duplicates (trim if long)
        avoid_list = "\n".join(f"- {f[:120]}" for f in existing_fronts[:50])
        avoid_block = ("Previously generated (avoid duplicates):\n" + avoid_list + "\n\n") if existing_fronts else ""
        return (
            f"Number of flashcards to generate now: {to_generate}.\n\n"
            + avoid_block +
            "Document Context:\n" + context[:12000]
        )

    try:
        # Prefer structured JSON responses if supported by the SDK
        model = None
        try:
            model = genai.GenerativeModel(
                TEXT_MODEL,
                generation_config={
                    "response_mime_type": "application/json",
                    "temperature": 0.4,
                    "max_output_tokens": 2048,
                },
            )
        except Exception:
            model = genai.GenerativeModel(TEXT_MODEL)

        import json

        def _parse_json_safely(s: str):
            if not s:
                return None
            try:
                return json.loads(s)
            except Exception:
                # Try fenced code blocks ```json ... ```
                m = _re.search(r"```(?:json)?\s*([\s\S]*?)```", s, _re.IGNORECASE)
                if m:
                    inner = m.group(1).strip()
                    try:
                        return json.loads(inner)
                    except Exception:
                        pass
                # Try last {...}
                m2 = _re.search(r"\{[\s\S]*\}", s)
                if m2:
                    try:
                        return json.loads(m2.group(0))
                    except Exception:
                        pass
                return None

        def _generate_batch(to_generate: int, existing_fronts: list[str]):
            """Ask model for a batch of flashcards and return normalized list."""
            prompt = _build_user_instr(to_generate, existing_fronts)
            resp_local = model.generate_content([sys_instr, prompt])
            raw_local = (getattr(resp_local, "text", "") or "").strip()
            data_local = _parse_json_safely(raw_local)
            if data_local is None:
                try:
                    conv_prompt = (
                        "Convert the following content to valid JSON that matches this schema: "
                        "{\n  \"flashcards\": [\n    {\n      \"front\": string,\n      \"back\": string,\n      \"category\": string,\n      \"difficulty\": \"Easy|Medium|Hard\"\n    }\n  ]\n}\n"
                        "Respond with JSON only, no extra text.\n\nContent to convert:\n" + (raw_local or "")
                    )
                    resp2 = model.generate_content(conv_prompt)
                    raw2 = (getattr(resp2, "text", "") or "").strip()
                    data_local = _parse_json_safely(raw2)
                except Exception:
                    data_local = None

            out = []
            if isinstance(data_local, dict) and isinstance(data_local.get("flashcards"), list):
                for c in data_local.get("flashcards", [])[: to_generate]:
                    if not isinstance(c, dict):
                        continue
                    front = str(c.get("front", "")).strip()
                    back = str(c.get("back", "")).strip()
                    if not front or not back:
                        continue
                    if len(front) > 200:
                        front = front[:200].rstrip() + "…"
                    if len(back) > 600:
                        back = back[:600].rstrip() + "…"
                    category = str(c.get("category", "General")).strip() or "General"
                    diff = str(c.get("difficulty", "Medium")).strip().capitalize()
                    if diff not in ("Easy", "Medium", "Hard"):
                        diff = "Medium"
                    out.append({
                        "front": front,
                        "back": back,
                        "category": category,
                        "difficulty": diff,
                    })
            return out

        # Iteratively generate until we reach the requested number or exhaust attempts
        final_cards = []
        seen_pairs = set()
        attempts = 3
        remaining = num_cards

        while remaining > 0 and attempts > 0:
            attempts -= 1
            existing_fronts = [c["front"] for c in final_cards]
            batch = _generate_batch(min(remaining, 15), existing_fronts)
            added_this_round = 0
            for c in batch:
                key = (c["front"], c["back"])
                if key in seen_pairs:
                    continue
                final_cards.append(c)
                seen_pairs.add(key)
                added_this_round += 1
                if len(final_cards) >= num_cards:
                    break
            remaining = num_cards - len(final_cards)
            if added_this_round == 0:
                # No progress; break to avoid looping
                break

        if not final_cards:
            return jsonify({"success": False, "error": "Model did not return valid flashcards. Please try again."}), 502

        return jsonify({"success": True, "flashcards": final_cards[: num_cards]})
    except Exception as e:
        return jsonify({"success": False, "error": f"Flashcard generation failed: {e}"}), 500
