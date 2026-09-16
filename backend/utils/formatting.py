import re

OUT_OF_DOC_PATTERNS = (
    "not in the context",
    "context provided does not contain",
    "provided context does not contain",
    "does not contain information",
    "doesn't contain information",
    "i couldn't find",
    "i could not find",
    "couldn't find in your document",
    "could not find in your document",
    "not found in your document",
    "not found in the document",
    "no relevant information",
    "not available in the document",
    "outside the document",
    "outside of the document",
    "not present in the document",
)

def format_response(text: str) -> str:
    """Improve the formatting of AI responses for better readability."""
    text = re.sub(r'\n\s*\n\s*\n+', '\n\n', text)
    text = re.sub(r'[ \t]+', ' ', text)
    text = re.sub(r'(\w)\. ([A-Z])', r'\1.\n\n\2', text)
    text = re.sub(r'^\s*[-•*]\s*', '• ', text, flags=re.MULTILINE)
    text = re.sub(r'^\s*(\d+)\.\s*', r'\1. ', text, flags=re.MULTILINE)
    text = re.sub(r'([.!?])\s*(•|\d+\.)', r'\1\n\n\2', text)
    text = re.sub(r':(\s*)(•|\d+\.)', r':\n\n\1\2', text)
    text = re.sub(r'([^:\n]):\s*\n', r'\1:\n\n', text)
    return text.strip()

def is_out_of_doc_answer(text: str) -> bool:
    """Heuristically detect when the LLM indicates the answer isn't in the provided context/document."""
    low = (text or "").strip().lower()
    if not low:
        return False

    return any(p in low for p in OUT_OF_DOC_PATTERNS)