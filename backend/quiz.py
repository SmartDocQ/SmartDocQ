from flask import Blueprint, request, jsonify
import re as _re

# Dependencies to be initialized from main.py
collection = None
has_index = None
fetch_doc_from_node = None
extract_text_for_mimetype = None
TEXT_MODEL = None
genai = None


def init_quiz(_collection, _has_index, _fetch_doc_from_node, _extract_text_for_mimetype, _TEXT_MODEL, _genai):
    global collection, has_index, fetch_doc_from_node, extract_text_for_mimetype, TEXT_MODEL, genai
    collection = _collection
    has_index = _has_index
    fetch_doc_from_node = _fetch_doc_from_node
    extract_text_for_mimetype = _extract_text_for_mimetype
    TEXT_MODEL = _TEXT_MODEL
    genai = _genai


quiz_bp = Blueprint("quiz", __name__)

@quiz_bp.route("/api/document/generate-quiz", methods=["POST"])
def generate_quiz():
    """Generate a quiz based on the uploaded document content.
    Request JSON:
      - doc_id: string (required)
      - num_questions: int (default 10)
      - difficulty: str (easy|medium|hard)
      - question_types: list[str] (subset of [mcq,true_false,short_answer])
    Response JSON: { success, quiz: { questions: [...] } } or { success: false, error }
    """
    body = request.get_json(silent=True) or {}
    doc_id = (body.get("doc_id") or body.get("documentId") or "").strip()
    if not doc_id:
        return jsonify({"success": False, "error": "doc_id is required"}), 400
    try:
        num_questions = int(body.get("num_questions", 10))
    except Exception:
        num_questions = 10
    difficulty = (body.get("difficulty") or "medium").lower()
    qtypes = body.get("question_types") or ["mcq", "true_false", "short_answer"]

    # Build context from indexed chunks if available; else fetch raw text
    context = ""
    try:
        if has_index(doc_id):
            res = collection.get(where={"doc_id": doc_id}, include=["documents"], limit=500)
            docs = (res or {}).get("documents") or []
            # flatten if nested
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

    # Prompt the model to return a strict JSON quiz
    sys_instr = (
        "You are SmartDoc Quiz Generator. Given the document context, generate a quiz strictly about the content. "
        "Return ONLY valid JSON with schema: {\n"
        "  \"questions\": [\n"
        "    {\n"
        "      \"type\": \"mcq|true_false|short_answer\",\n"
        "      \"question\": string,\n"
        "      \"options\": [string, ...] (required for mcq only),\n"
        "      \"correct_answer\": string,\n"
        "      \"explanation\": string\n"
        "    }\n"
        "  ]\n"
        "}\n"
        "- Generate UP TO the requested number of questions.\n"
        "- If the document supports fewer questions, return as many as possible without fabricating facts.\n"
        "- Ensure all questions are answerable using the context.\n"
        "- For mcq, include 3-5 plausible options.\n"
        "- For true_false, use the strings 'true' or 'false'.\n"
        "- Keep explanations concise and factual.\n"
    )
    user_instr = (
        f"Difficulty: {difficulty}. Number of questions: up to {num_questions}. Allowed types: {', '.join(qtypes)}.\n\n"
        "Document Context:\n" + context[:12000]
    )

    try:
        # Prefer structured JSON responses if supported by the SDK
        model = None
        try:
            model = genai.GenerativeModel(
                TEXT_MODEL,
                generation_config={
                    # Ask Gemini to return JSON only. If unsupported, fallback below.
                    "response_mime_type": "application/json",
                    # Tweakables (safe defaults)
                    "temperature": 0.4,
                    "max_output_tokens": 2048,
                },
            )
        except Exception:
            model = genai.GenerativeModel(TEXT_MODEL)

        # Avoid hanging requests: limit to ~30s per generate
        resp = model.generate_content([sys_instr, user_instr], request_options={"timeout": 30})

        # Extract text safely from response
        raw = ""
        try:
            raw = (getattr(resp, "text", "") or "").strip()
        except Exception:
            raw = ""

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

        quiz = _parse_json_safely(raw)
        if quiz is None:
            # Fallback: attempt a second pass asking the model to strictly convert to JSON
            try:
                conv_prompt = (
                    "Convert the following content to valid JSON that matches this schema: "
                    "{\n  \"questions\": [\n    {\n      \"type\": \"mcq|true_false|short_answer\",\n      \"question\": string,\n      \"options\": [string] (for mcq only),\n      \"correct_answer\": string,\n      \"explanation\": string\n    }\n  ]\n}\n"
                    "Respond with JSON only, no extra text.\n\nContent to convert:\n" + (raw or "")
                )
                resp2 = model.generate_content(conv_prompt, request_options={"timeout": 20})
                raw2 = (getattr(resp2, "text", "") or "").strip()
                quiz = _parse_json_safely(raw2)
            except Exception:
                quiz = None

        if not isinstance(quiz, dict) or "questions" not in quiz or not isinstance(quiz.get("questions"), list):
            return jsonify({"success": False, "error": "Model did not return valid JSON quiz. Please try again."}), 502

        # Basic sanitize and trim
        qs = []
        for q in quiz.get("questions", [])[: num_questions]:
            if not isinstance(q, dict):
                continue
            qtype = str(q.get("type", "")).strip().lower()
            if qtype not in ("mcq", "true_false", "short_answer"):
                continue
            question = str(q.get("question", "")).strip()
            if not question:
                continue
            correct = q.get("correct_answer", "")
            if qtype == "true_false":
                correct = str(correct).strip().lower()
                if correct not in ("true", "false"):
                    # Try to coerce booleans
                    if str(correct).strip().lower() in ("t", "yes", "y", "1"):
                        correct = "true"
                    elif str(correct).strip().lower() in ("f", "no", "n", "0"):
                        correct = "false"
                    else:
                        continue
            else:
                correct = str(correct).strip()
                if not correct:
                    continue

            item = {
                "type": qtype,
                "question": question,
                "correct_answer": correct,
                "explanation": str(q.get("explanation", "")).strip(),
            }
            if qtype == "mcq":
                opts = q.get("options") or []
                if not isinstance(opts, list):
                    opts = []
                # Normalize options to strings and include the correct answer if missing
                norm_opts = []
                for o in opts:
                    s = str(o).strip()
                    if s:
                        norm_opts.append(s)
                if str(correct) not in norm_opts:
                    norm_opts.append(str(correct))
                # Ensure 3-5 options; dedupe while preserving order
                seen = set()
                dedup = []
                for o in norm_opts:
                    if o not in seen:
                        dedup.append(o)
                        seen.add(o)
                item["options"] = dedup[:5]
                if len(item["options"]) < 3:
                    # Skip if insufficient options
                    continue

            qs.append(item)

        if not qs:
            return jsonify({"success": False, "error": "No valid questions could be constructed from the model output."}), 502

        # Include metadata so the frontend can reflect counts when fewer than requested
        meta = {
            "requested": num_questions,
            "generated": len(qs),
            "difficulty": difficulty,
            "types": qtypes,
        }
        return jsonify({"success": True, "quiz": {"questions": qs, "meta": meta}})
    except Exception as e:
        return jsonify({"success": False, "error": f"Quiz generation failed: {e}"}), 500
