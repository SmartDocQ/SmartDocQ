from flask import Blueprint, request, jsonify, current_app
import re as _re
import json
import logging
from services.document_service import DocumentNotFoundError
from services.llm_router import router as default_router

logger = logging.getLogger(__name__)

class FlashcardGenerator:
    """Service handling flashcard generation via LLM router."""

    def __init__(self, document_service, router=None):
        self.document_service = document_service
        self.router = router or default_router

    def _build_system_instruction(self) -> str:
        return (
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

    def _build_user_instruction(
        self,
        to_generate: int,
        existing_fronts: list[str],
        context: str,
    ) -> str:
        avoid_list = "\n".join(f"- {f[:120]}" for f in existing_fronts[:50])
        avoid_block = (
            "Previously generated (avoid duplicates):\n" + avoid_list + "\n\n"
        ) if existing_fronts else ""

        return (
            f"Number of flashcards to generate now: {to_generate}.\n\n"
            + avoid_block
            + "Document Context:\n"
            + context[:12000]
        )

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

    def _normalize_card(self, raw: dict) -> dict | None:
        if not isinstance(raw, dict):
            return None
        front = str(raw.get("front", "")).strip()
        back = str(raw.get("back", "")).strip()
        if not front or not back:
            return None
        
        if len(front) > 200:
            front = front[:200].rstrip() + "…"
        if len(back) > 600:
            back = back[:600].rstrip() + "…"

        category = str(raw.get("category", "") or "General").strip()
        diff = str(raw.get("difficulty", "") or "Medium").strip().capitalize()
        if diff not in ("Easy", "Medium", "Hard"):
            diff = "Medium"

        return {
            "front": front,
            "back": back,
            "category": category,
            "difficulty": diff,
        }

    def _generate_batch(
        self,
        system_instruction: str,
        to_generate: int,
        existing_fronts: list[str],
        context: str,
    ) -> list:
        user_instruction = self._build_user_instruction(to_generate, existing_fronts, context)
        prompt = f"{system_instruction}\n\n{user_instruction}"
        res = self.router.generate(
            task="flashcards",
            prompt=prompt,
            response_json=True,
            temperature=0.4,
            max_tokens=2048,
        )
        raw = (res.get("text", "") or "").strip()
        data = self._parse_json_safely(raw)

        if not isinstance(data, dict):
            return []

        cards = data.get("flashcards")
        if not isinstance(cards, list):
            return []

        out = []
        for c in cards[:to_generate]:
            normalized = self._normalize_card(c)
            if normalized:
                out.append(normalized)

        return out

    def generate(self, doc_id: str, num_cards: int = 20) -> list:
        doc_id = (doc_id or "").strip()
        if not doc_id:
            raise ValueError("doc_id is required")

        try:
            num_cards = int(num_cards)
        except Exception:
            num_cards = 20
        num_cards = max(3, min(num_cards, 50))

        # Fetch document context using DocumentService (propagates DocumentNotFoundError if doc missing)
        context = self.document_service.get_context(doc_id)
        context = (context or "").strip()
        if not context:
            raise ValueError("Document has no readable text")

        system_instruction = self._build_system_instruction()

        final_cards = []
        seen_pairs = set()
        seen_fronts = set()
        attempts = 3
        remaining = num_cards

        while remaining > 0 and attempts > 0:
            attempts -= 1
            existing_fronts = [c["front"] for c in final_cards]
            batch = self._generate_batch(
                system_instruction,
                min(remaining, 15),
                existing_fronts,
                context,
            )
            added_this_round = 0
            for c in batch:
                front_key = c["front"].strip().casefold()
                pair_key = (front_key, c["back"].strip().casefold())

                if front_key in seen_fronts or pair_key in seen_pairs:
                    continue

                seen_fronts.add(front_key)
                seen_pairs.add(pair_key)
                final_cards.append(c)
                added_this_round += 1
                if len(final_cards) >= num_cards:
                    break

            remaining = num_cards - len(final_cards)
            if added_this_round == 0:
                break

        if not final_cards:
            raise RuntimeError("Model did not return valid flashcards. Please try again.")

        return final_cards[:num_cards]


flashcard_bp = Blueprint("flashcard", __name__)


@flashcard_bp.route("/api/document/generate-flashcards", methods=["POST", "OPTIONS"])
def generate_flashcards():
    """Generate flashcards based on the uploaded document content."""
    if request.method == "OPTIONS":
        return ("", 204)

    flashcard_generator = current_app.extensions.get("flashcard_generator")
    if flashcard_generator is None:
        return jsonify({"success": False, "error": "Flashcard service not initialized"}), 500

    body = request.get_json(silent=True) or {}
    doc_id = (body.get("doc_id") or body.get("documentId") or "").strip()
    num_cards = body.get("num_cards", 20)

    try:
        cards = flashcard_generator.generate(
            doc_id=doc_id,
            num_cards=num_cards,
        )
        return jsonify({"success": True, "flashcards": cards})

    except DocumentNotFoundError as e:
        return jsonify({"success": False, "error": str(e)}), 404

    except ValueError as e:
        return jsonify({"success": False, "error": str(e)}), 400

    except RuntimeError as e:
        return jsonify({"success": False, "error": str(e)}), 502

    except Exception as e:
        logger.exception("Flashcard generation unexpected error: %s", e)
        return jsonify({"success": False, "error": f"Flashcard generation failed: {e}"}), 500
