from flask import Blueprint, request, jsonify
import re as _re
import time as _time
import json
import logging
from services.document_service import DocumentNotFoundError

logger = logging.getLogger(__name__)

# Module-level generator instance configured by main.py
quiz_generator = None

class QuizGenerator:
    """Service handling document quiz generation using Gemini and DocumentService."""

    def __init__(self, document_service, text_model, genai_module):
        self.document_service = document_service
        self.text_model = text_model
        self.genai = genai_module

    def _build_system_instruction(self) -> str:
        return (
            "You are SmartDoc Quiz Generator. Given the document context, generate a quiz strictly about the content. "
            "Return ONLY valid JSON with schema: {\n"
            '  "questions": [\n'
            "    {\n"
            '      "type": "mcq|true_false|short_answer",\n'
            '      "question": string,\n'
            '      "options": [string, ...] (required for mcq only),\n'
            '      "correct_answer": string,\n'
            '      "explanation": string\n'
            "    }\n"
            "  ]\n"
            "}\n"
            "- Ensure there are exactly the requested number of questions.\n"
            "- Ensure all questions are answerable using the context.\n"
            "- For mcq, include 3-5 plausible options.\n"
            "- For true_false, use the strings 'true' or 'false'.\n"
            "- Keep explanations concise and factual.\n"
        )

    def _build_user_instruction(
        self,
        difficulty: str,
        qtypes: list[str],
        context: str,
        to_generate: int,
        existing_questions: list[str],
    ) -> str:
        avoid_list = "\n".join(f"- {q[:180]}" for q in existing_questions[:50])
        avoid_block = (
            "Previously generated (avoid duplicates):\n" + avoid_list + "\n\n"
        ) if existing_questions else ""

        return (
            f"Difficulty: {difficulty}. Number of questions: {to_generate}. Allowed types: {', '.join(qtypes)}.\n\n"
            + avoid_block
            + "Document Context:\n"
            + context[:12000]
        )

    def _create_model(self):
        return self.genai.GenerativeModel(
            self.text_model,
            generation_config={
                "response_mime_type": "application/json",
                "temperature": 0.4,
                "max_output_tokens": 1536,
            },
        )

    def _is_transient_llm_error(self, err: Exception) -> bool:
        msg = str(err or "")
        needles = [
            "504",
            "Deadline Exceeded",
            "503",
            "Service Unavailable",
            "429",
            "RESOURCE_EXHAUSTED",
            "Rate limit",
            "rate limit",
            "ECONNRESET",
            "ETIMEDOUT",
            "timeout",
        ]
        return any(n in msg for n in needles)

    def _generate_content_with_retry(self, model, parts, timeouts=(30, 45, 60)):
        last_err = None
        for i, t in enumerate(timeouts):
            try:
                return model.generate_content(parts, request_options={"timeout": int(t)})
            except Exception as e:
                last_err = e
                if i >= len(timeouts) - 1 or not self._is_transient_llm_error(e):
                    raise
                _time.sleep(0.4 * (i + 1))
        raise last_err

    def _parse_json_safely(self, text: str):
        if not text:
            return None
        try:
            return json.loads(text)
        except Exception:
            pass

        match = _re.search(r"```(?:json)?\s*([\s\S]*?)```", text, _re.IGNORECASE)
        if match:
            try:
                return json.loads(match.group(1).strip())
            except Exception:
                pass

        match2 = _re.search(r"\{[\s\S]*\}", text)
        if match2:
            try:
                return json.loads(match2.group(0))
            except Exception:
                pass

        return None

    def _generate_batch(
        self,
        model,
        system_instruction: str,
        difficulty: str,
        qtypes: list[str],
        context: str,
        to_generate: int,
        existing_questions: list[str],
    ) -> list:
        prompt = self._build_user_instruction(
            difficulty, qtypes, context, to_generate, existing_questions
        )
        response = self._generate_content_with_retry(
            model, [system_instruction, prompt]
        )

        raw = (getattr(response, "text", "") or "").strip()
        data = self._parse_json_safely(raw)

        if not isinstance(data, dict):
            return []

        items = data.get("questions")
        return items if isinstance(items, list) else []

    def _validate_question(self, q: dict, seen_questions: set) -> dict | None:
        if not isinstance(q, dict):
            return None

        qtype = str(q.get("type", "")).strip().lower()
        if qtype not in ("mcq", "true_false", "short_answer"):
            return None

        question = str(q.get("question", "")).strip()
        if not question or question in seen_questions:
            return None

        correct = q.get("correct_answer", "")
        if qtype == "true_false":
            correct = str(correct).strip().lower()
            if correct not in ("true", "false"):
                if correct in ("t", "yes", "y", "1"):
                    correct = "true"
                elif correct in ("f", "no", "n", "0"):
                    correct = "false"
                else:
                    return None
        else:
            correct = str(correct).strip()
            if not correct:
                return None

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
            norm_opts = []
            for o in opts:
                s = str(o).strip()
                if s:
                    norm_opts.append(s)
            if str(correct) not in norm_opts:
                norm_opts.append(str(correct))

            seen_options = set()
            dedup = []
            for o in norm_opts:
                if o not in seen_options:
                    dedup.append(o)
                    seen_options.add(o)
            item["options"] = dedup[:5]
            if len(item["options"]) < 3:
                return None

        return item

    def generate(
        self,
        doc_id: str,
        num_questions: int = 10,
        difficulty: str = "medium",
        question_types: list[str] | str | None = None,
    ) -> list:
        doc_id = (doc_id or "").strip()
        if not doc_id:
            raise ValueError("doc_id is required")

        try:
            num_questions = int(num_questions)
        except Exception:
            num_questions = 10

        difficulty = (difficulty or "medium").lower()

        qtypes = question_types
        if isinstance(qtypes, str):
            qtypes = [s.strip() for s in qtypes.split(",") if s.strip()]
        qtypes = qtypes or ["mcq", "true_false", "short_answer"]

        # Fetch document context using DocumentService
        context = self.document_service.get_context(doc_id)
        context = (context or "").strip()
        if not context:
            raise ValueError("Document has no readable text")

        system_instruction = self._build_system_instruction()
        model = self._create_model()

        qs = []
        seen_questions = set()
        attempts = 3
        remaining = num_questions

        while remaining > 0 and attempts > 0:
            attempts -= 1
            existing_questions = [q["question"] for q in qs]
            batch = self._generate_batch(
                model,
                system_instruction,
                difficulty,
                qtypes,
                context,
                min(remaining, 10),
                existing_questions,
            )
            if not batch:
                break

            added_this_round = 0
            for q in batch:
                item = self._validate_question(q, seen_questions)
                if item is None:
                    continue
                qs.append(item)
                seen_questions.add(item["question"])
                added_this_round += 1
                if len(qs) >= num_questions:
                    break

            remaining = num_questions - len(qs)
            if added_this_round == 0:
                break

        if not qs:
            raise RuntimeError("No valid questions could be constructed from the model output.")

        return qs

def set_quiz_generator(generator: QuizGenerator):
    """Set the QuizGenerator instance for the blueprint."""
    global quiz_generator
    quiz_generator = generator


quiz_bp = Blueprint("quiz", __name__)

@quiz_bp.route("/api/document/generate-quiz", methods=["POST", "GET", "OPTIONS"])
def generate_quiz():
    """Generate a quiz based on the uploaded document content."""
    if request.method == "OPTIONS":
        return ("", 204)

    if quiz_generator is None:
        return jsonify({"success": False, "error": "Quiz service not initialized"}), 500

    if request.method == "GET":
        body = {
            "doc_id": request.args.get("doc_id") or request.args.get("documentId"),
            "num_questions": request.args.get("num_questions"),
            "difficulty": request.args.get("difficulty"),
            "question_types": request.args.get("question_types"),
        }
    else:
        body = request.get_json(silent=True) or {}

    doc_id = (body.get("doc_id") or body.get("documentId") or "").strip()
    num_questions = body.get("num_questions", 10)
    difficulty = body.get("difficulty", "medium")
    qtypes = body.get("question_types")

    try:
        questions = quiz_generator.generate(
            doc_id=doc_id,
            num_questions=num_questions,
            difficulty=difficulty,
            question_types=qtypes,
        )
        return jsonify({"success": True, "quiz": {"questions": questions}})

    except DocumentNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 404

    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400

    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 502

    except Exception as e:
        logger.exception("Quiz generation unexpected error: %s", e)
        return jsonify({"success": False, "error": f"Quiz generation failed: {e}"}), 500
