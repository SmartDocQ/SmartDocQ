import pytest
from unittest.mock import MagicMock
from flask import Flask
from features.summarize import (
    TextSummarizer,
    summarize_bp,
    _clean_selection_text,
    _chunk_text,
    _build_prompt,
)


def test_clean_selection_text():
    raw_text = "learn-\ning Python\n• First bullet\n\n\n\n• Second bullet"
    cleaned = _clean_selection_text(raw_text)
    assert "learning Python" in cleaned
    assert "• First bullet" in cleaned
    assert "\n\n\n" not in cleaned


def test_normal_paragraph_chunking():
    p1 = "Paragraph 1 " * 40
    p2 = "Paragraph 2 " * 40
    full_text = f"{p1}\n\n{p2}"
    chunks = _chunk_text(full_text, size=700, overlap=100)
    assert len(chunks) >= 2
    assert all(len(c) <= 700 for c in chunks)


def test_oversized_paragraph_chunking():
    # 10,000 character single paragraph composed of sentences
    single_sentence = "This is a comprehensive test sentence with critical details. "
    oversized_para = single_sentence * 200  # ~12,000 characters without blank lines
    chunks = _chunk_text(oversized_para, size=1600, overlap=200)

    assert len(chunks) > 1
    assert all(len(c) <= 1600 for c in chunks)


def test_oversized_sentence_chunking():
    # 5,000 character single sentence without punctuation
    oversized_sentence = "Word" * 1250  # 5,000 characters
    chunks = _chunk_text(oversized_sentence, size=1600, overlap=200)

    assert len(chunks) >= 4
    assert all(len(c) <= 1600 for c in chunks)


def test_oversized_paragraph_respects_chunk_limit():
    text = "A" * 10000
    chunks = _chunk_text(text, size=1600, overlap=200)

    assert chunks
    assert all(len(chunk) <= 1600 for chunk in chunks)


def test_oversized_sentence_respects_chunk_limit():
    text = "A" * 5000 + "."
    chunks = _chunk_text(text, size=1600, overlap=200)

    assert chunks
    assert all(len(chunk) <= 1600 for chunk in chunks)


def test_every_chunk_max_bound():
    text = ("Long paragraph block. " * 100 + "\n\n") * 5
    chunks = _chunk_text(text, size=1600, overlap=200)

    for i, c in enumerate(chunks):
        assert len(c) <= 1600, f"Chunk {i} exceeded max bound size: {len(c)} > 1600"


def test_chunk_text_invariant_across_configurations():
    complex_text = (
        "Heading 1\n\n"
        + ("Sentence one in big paragraph. " * 50 + "\n\n")
        + ("Superlongword" * 150 + " End of sentence.\n\n")
        + ("Short text block.\n\n") * 3
    )

    for target_size, overlap in [(500, 50), (1000, 100), (1600, 200)]:
        chunks = _chunk_text(complex_text, size=target_size, overlap=overlap)
        assert len(chunks) > 0
        assert all(
            len(c) <= target_size for c in chunks
        ), f"Failed size invariant for target_size={target_size}, overlap={overlap}"


def test_summarizer_single_chunk():
    mock_router = MagicMock()
    mock_router.generate.return_value = {"text": "This is a concise summary of the document."}

    summarizer = TextSummarizer(router=mock_router)
    summary = summarizer.summarize("Short sample text to summarize.", style="concise", bullets=True)

    assert summary == "This is a concise summary of the document."
    assert mock_router.generate.call_count == 1


def test_summarizer_empty_text():
    mock_router = MagicMock()
    summarizer = TextSummarizer(router=mock_router)

    with pytest.raises(ValueError, match="Missing selectionText"):
        summarizer.summarize("   ")


def test_summarizer_map_reduce():
    mock_router = MagicMock()

    def side_effect(task, prompt, **kwargs):
        if "You are aggregating multiple partial summaries" in prompt:
            return {"text": "Final merged summary."}
        else:
            return {"text": "Partial chunk summary."}

    mock_router.generate.side_effect = side_effect

    summarizer = TextSummarizer(router=mock_router)

    long_text = ("Section header.\n\n" + "Word " * 250 + "\n\n") * 4
    summary = summarizer.summarize(long_text, style="detailed", bullets=False)

    assert summary == "Final merged summary."
    assert mock_router.generate.call_count >= 3


@pytest.fixture
def test_app():
    mock_router = MagicMock()
    mock_router.generate.return_value = {"text": "Endpoint generated summary."}

    app = Flask(__name__)
    app.register_blueprint(summarize_bp)
    app.extensions["text_summarizer"] = TextSummarizer(router=mock_router)
    return app


def test_summarize_endpoint_styles(test_app):
    client = test_app.test_client()

    for style in ["short", "concise", "detailed"]:
        resp = client.post(
            "/api/summarize",
            json={
                "selectionText": "Sample text for endpoint style testing.",
                "style": style,
                "bullets": True,
            },
        )
        assert resp.status_code == 200
        assert resp.get_json()["summary"] == "Endpoint generated summary."


def test_summarize_endpoint_invalid_style(test_app):
    client = test_app.test_client()
    resp = client.post(
        "/api/summarize",
        json={
            "selectionText": "Sample text.",
            "style": "banana",
        },
    )
    assert resp.status_code == 400
    assert "Invalid style" in resp.get_json()["error"]


def test_summarize_endpoint_bullets_validation(test_app):
    client = test_app.test_client()

    # Valid booleans
    resp_true = client.post("/api/summarize", json={"selectionText": "Sample text.", "bullets": True})
    assert resp_true.status_code == 200

    resp_false = client.post("/api/summarize", json={"selectionText": "Sample text.", "bullets": False})
    assert resp_false.status_code == 200

    # Invalid boolean types -> 400 Bad Request
    resp_str = client.post("/api/summarize", json={"selectionText": "Sample text.", "bullets": "false"})
    assert resp_str.status_code == 400
    assert "'bullets' parameter must be a boolean" in resp_str.get_json()["error"]

    resp_int = client.post("/api/summarize", json={"selectionText": "Sample text.", "bullets": 1})
    assert resp_int.status_code == 400
    assert "'bullets' parameter must be a boolean" in resp_int.get_json()["error"]


def test_summarize_endpoint_missing_text(test_app):
    client = test_app.test_client()
    resp = client.post("/api/summarize", json={"selectionText": "   "})
    assert resp.status_code == 400
    assert "Missing selectionText" in resp.get_json()["error"]
