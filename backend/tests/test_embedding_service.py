import pytest
from unittest.mock import patch, MagicMock

import services.embedding_service as emb_service
from config import EMBEDDING_TIMEOUT, EMBEDDING_TOTAL_TIMEOUT


def test_embed_query_formatting():
    """Verify that query embedding prepends the task and query format with configured default timeout."""
    with patch("services.embedding_service._generate_embedding") as mock_gen:
        mock_gen.return_value = [0.1, 0.2, 0.3]

        res = emb_service.embed_query("What is RRF?")

        assert res == [0.1, 0.2, 0.3]
        mock_gen.assert_called_once_with(
            "task: question answering | query: What is RRF?",
            EMBEDDING_TIMEOUT
        )


def test_embed_document_formatting():
    """Verify document embedding formatting with title and context and default timeout."""
    with patch("services.embedding_service._generate_embedding") as mock_gen:
        mock_gen.return_value = [0.1, 0.2, 0.3]

        # Scenario 1: Title and context provided
        res = emb_service.embed_document(
            text="chunk content",
            title="doc.pdf",
            context="Section: Introduction"
        )
        assert res == [0.1, 0.2, 0.3]
        mock_gen.assert_called_with(
            "title: doc.pdf | text: Section: Introduction\n\nchunk content",
            EMBEDDING_TIMEOUT
        )

        # Scenario 2: No title, no context
        mock_gen.reset_mock()
        emb_service.embed_document(text="simple content")
        mock_gen.assert_called_once_with(
            "title: none | text: simple content",
            EMBEDDING_TIMEOUT
        )


def test_gemini_api_call_has_no_task_type_and_passes_request_options():
    """Verify the Google GenAI embedding request contains no task_type and passes request_options timeout."""
    with patch("google.generativeai.embed_content") as mock_embed:
        mock_embed.return_value = {"embedding": [0.9, 0.8, 0.7]}

        res = emb_service._generate_embedding("some prepared text", timeout_sec=5.0)

        assert res == [0.9, 0.8, 0.7]
        mock_embed.assert_called_once()
        kwargs = mock_embed.call_args[1]
        assert "task_type" not in kwargs
        assert kwargs["content"] == "some prepared text"
        assert kwargs["request_options"]["timeout"] == 5.0


def test_gemini_timeout_returns_none():
    """Verify that an exception raised by SDK (e.g. timeout) results in None."""
    with patch("google.generativeai.embed_content") as mock_embed:
        mock_embed.side_effect = Exception("Request timed out")

        res = emb_service._generate_embedding("test query", timeout_sec=5.0)
        assert res is None


def test_embed_document_retry_succeeds_on_second_attempt():
    """Verify document embedding retries on failure and succeeds on attempt 2."""
    with patch("services.embedding_service._generate_embedding") as mock_gen, \
         patch("time.sleep") as mock_sleep:
        mock_gen.side_effect = [None, [0.1, 0.2, 0.3]]

        res = emb_service.embed_document(text="chunk data", timeout_sec=5, total_timeout_sec=10)

        assert res == [0.1, 0.2, 0.3]
        assert mock_gen.call_count == 2
        mock_sleep.assert_called_once()


def test_embed_document_total_deadline_exceeded_truncates_retries():
    """Verify that if remaining deadline is <= 0, retries halt immediately."""
    with patch("services.embedding_service._generate_embedding") as mock_gen, \
         patch("time.perf_counter") as mock_counter, \
         patch("time.sleep") as mock_sleep:
        mock_counter.side_effect = [100.0, 100.0, 104.0]
        mock_gen.return_value = None

        res = emb_service.embed_document(text="data", timeout_sec=5, total_timeout_sec=3)

        assert res is None
        assert mock_gen.call_count == 1
        mock_sleep.assert_not_called()


def test_old_api_removal():
    """Verify generate_embeddings is no longer in services.embedding_service."""
    assert not hasattr(emb_service, "generate_embeddings")