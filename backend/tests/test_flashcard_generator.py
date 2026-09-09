import pytest
from unittest.mock import MagicMock
from features.flashcard import FlashcardGenerator
from services.document_service import DocumentService, DocumentNotFoundError


def test_flashcard_successful_generation():
    doc_service = MagicMock(spec=DocumentService)
    doc_service.get_context.return_value = "SmartDoc is an AI document assistant supporting Flashcards, Quiz, and Summaries."

    mock_model = MagicMock()
    mock_response = MagicMock()
    mock_response.text = '{"flashcards": [{"front": "What is SmartDoc?", "back": "An AI document assistant.", "category": "Overview", "difficulty": "Easy"}]}'
    mock_model.generate_content.return_value = mock_response

    genai_mock = MagicMock()
    genai_mock.GenerativeModel.return_value = mock_model

    generator = FlashcardGenerator(doc_service, "gemini-1.5-flash", genai_mock)
    cards = generator.generate(doc_id="doc_101", num_cards=5)

    assert len(cards) == 1
    assert cards[0]["front"] == "What is SmartDoc?"
    assert cards[0]["back"] == "An AI document assistant."
    assert cards[0]["category"] == "Overview"
    assert cards[0]["difficulty"] == "Easy"


def test_flashcard_missing_document():
    doc_service = MagicMock(spec=DocumentService)
    doc_service.get_context.side_effect = DocumentNotFoundError("Document doc_missing not found")

    genai_mock = MagicMock()
    generator = FlashcardGenerator(doc_service, "gemini-1.5-flash", genai_mock)

    with pytest.raises(DocumentNotFoundError, match="Document doc_missing not found"):
        generator.generate(doc_id="doc_missing")


def test_flashcard_empty_document():
    doc_service = MagicMock(spec=DocumentService)
    doc_service.get_context.return_value = ""

    genai_mock = MagicMock()
    generator = FlashcardGenerator(doc_service, "gemini-1.5-flash", genai_mock)

    with pytest.raises(ValueError, match="Document has no readable text"):
        generator.generate(doc_id="doc_empty")


def test_flashcard_normalization():
    generator = FlashcardGenerator(MagicMock(), "gemini-1.5-flash", MagicMock())

    # Invalid cards skipped
    assert generator._normalize_card({}) is None
    assert generator._normalize_card({"front": "Only front"}) is None

    # Normalization defaults and truncations
    long_front = "A" * 250
    long_back = "B" * 700
    card = {
        "front": long_front,
        "back": long_back,
        "category": "",
        "difficulty": "invalid_difficulty",
    }
    norm = generator._normalize_card(card)
    assert norm is not None
    assert len(norm["front"]) <= 201  # 200 + ellipsis char
    assert norm["front"].endswith("…")
    assert len(norm["back"]) <= 601
    assert norm["back"].endswith("…")
    assert norm["category"] == "General"
    assert norm["difficulty"] == "Medium"


def test_flashcard_deduplication():
    doc_service = MagicMock(spec=DocumentService)
    doc_service.get_context.return_value = "Sample text content for testing deduplication."

    mock_model = MagicMock()
    mock_response = MagicMock()
    # Model returns cards with identical normalized front but different backs
    mock_response.text = '{"flashcards": [{"front": "What is Photosynthesis?", "back": "Converts light energy."}, {"front": "what is photosynthesis?", "back": "Plants use sunlight to make food."}]}'
    mock_model.generate_content.return_value = mock_response

    genai_mock = MagicMock()
    genai_mock.GenerativeModel.return_value = mock_model

    generator = FlashcardGenerator(doc_service, "gemini-1.5-flash", genai_mock)
    cards = generator.generate(doc_id="doc_dedup", num_cards=5)

    # Only the first card survives because the second card has the same normalized front
    assert len(cards) == 1
    assert cards[0]["front"] == "What is Photosynthesis?"


def test_flashcard_num_cards_clamping():
    doc_service = MagicMock(spec=DocumentService)
    doc_service.get_context.return_value = "Content"
    genai_mock = MagicMock()
    generator = FlashcardGenerator(doc_service, "gemini-1.5-flash", genai_mock)

    # Mock _generate_batch to inspect clamped num_cards parameter
    original_generate_batch = generator._generate_batch
    captured_to_generate = []

    def mock_gen_batch(model, sys_instr, to_gen, existing, ctx):
        captured_to_generate.append(to_gen)
        return [{"front": "Q", "back": "A"}]

    generator._generate_batch = mock_gen_batch

    # num_cards = 100 -> clamped to 50
    generator.generate(doc_id="doc_clamp", num_cards=100)
    assert captured_to_generate[0] == 15  # min(remaining=50, 15)

    captured_to_generate.clear()
    # num_cards = 1 -> clamped to 3
    generator.generate(doc_id="doc_clamp", num_cards=1)
    assert captured_to_generate[0] == 3
