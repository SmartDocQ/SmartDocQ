import pytest
from unittest.mock import MagicMock
from features.quiz import QuizGenerator
from services.document_service import DocumentService


def test_quiz_generator_validation():
    doc_service = MagicMock(spec=DocumentService)
    mock_router = MagicMock()

    generator = QuizGenerator(doc_service, router=mock_router)

    seen = set()

    # Valid MCQ
    mcq = {
        "type": "mcq",
        "question": "What is Python?",
        "options": ["A language", "A snake", "An OS"],
        "correct_answer": "A language",
        "explanation": "High level programming language."
    }
    validated = generator._validate_question(mcq, seen)
    assert validated is not None
    assert validated["question"] == "What is Python?"
    assert len(validated["options"]) == 3
    seen.add(validated["question"])
    assert "What is Python?" in seen

    # Duplicate question should return None
    duplicate = generator._validate_question(mcq, seen)
    assert duplicate is None


def test_quiz_generator_missing_doc_id():
    doc_service = MagicMock(spec=DocumentService)
    mock_router = MagicMock()

    generator = QuizGenerator(doc_service, router=mock_router)

    with pytest.raises(ValueError, match="doc_id is required"):
        generator.generate(doc_id="")


def test_quiz_generator_no_readable_text():
    doc_service = MagicMock(spec=DocumentService)
    doc_service.get_context.return_value = ""
    mock_router = MagicMock()

    generator = QuizGenerator(doc_service, router=mock_router)

    with pytest.raises(ValueError, match="Document has no readable text"):
        generator.generate(doc_id="doc_123")


def test_quiz_generator_successful_generate():
    doc_service = MagicMock(spec=DocumentService)
    doc_service.get_context.return_value = "Python is a high-level programming language created by Guido van Rossum."

    mock_router = MagicMock()
    mock_router.generate.return_value = {
        "text": '{"questions": [{"type": "true_false", "question": "Python was created by Guido van Rossum?", "correct_answer": "true", "explanation": "It was created by Guido."}]}'
    }

    generator = QuizGenerator(doc_service, router=mock_router)

    questions = generator.generate(doc_id="doc_123", num_questions=1, difficulty="easy")
    assert len(questions) == 1
    assert questions[0]["type"] == "true_false"
    assert questions[0]["correct_answer"] == "true"
