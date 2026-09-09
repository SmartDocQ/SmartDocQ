import pytest
from services.document_service import DocumentService, extract_headings_from_text


class MockCollection:
    def __init__(self, documents_return=None):
        self.documents_return = documents_return or ["Chunk 1 content", "Chunk 2 content"]

    def get(self, where=None, include=None, limit=500):
        return {"documents": self.documents_return}


def test_get_context_empty_doc_id():
    service = DocumentService()
    assert service.get_context("") == ""
    assert service.get_context(None) == ""


def test_get_context_indexed_document():
    mock_collection = MockCollection(["Paragraph 1", "Paragraph 2"])
    has_index = lambda doc_id: True

    service = DocumentService(
        collection=mock_collection,
        has_index=has_index,
    )

    context = service.get_context("doc_123")
    assert context == "Paragraph 1\n\nParagraph 2"


def test_get_context_fallback_to_node():
    has_index = lambda doc_id: False

    def mock_fetch_doc_from_node(doc_id):
        return True, "test.pdf", "application/pdf", b"fake bytes"

    def mock_extract_text_for_mimetype(filename, mimetype, data_bytes):
        return "Extracted raw PDF content"

    service = DocumentService(
        has_index=has_index,
        fetch_doc_from_node=mock_fetch_doc_from_node,
        extract_text_for_mimetype=mock_extract_text_for_mimetype,
    )

    context = service.get_context("doc_456")
    assert context == "Extracted raw PDF content"


def test_extract_headings_pure_function():
    text = "1. Introduction\nSome body text here.\n2. Methodology\nMore details."
    headings = extract_headings_from_text(text)
    assert "1. Introduction" in headings
    assert "2. Methodology" in headings
