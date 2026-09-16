import logging
import time

import google.generativeai as genai

from config import (
    EMBED_MODEL,
    EMBEDDING_TIMEOUT,
    EMBEDDING_TOTAL_TIMEOUT,
    GEMINI_API_KEY,
)

logger = logging.getLogger(__name__)

if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)


def _embed_call(text: str, timeout_sec: float):
    return genai.embed_content(
        model=EMBED_MODEL,
        content=text,
        request_options={"timeout": float(timeout_sec)},
    )

def _generate_embedding(text: str, timeout_sec: float = EMBEDDING_TIMEOUT):
    """Perform a Gemini embedding request with a network-level timeout."""
    try:
        result = _embed_call(text, timeout_sec)
        return result.get("embedding") if isinstance(result, dict) else None

    except Exception as e:
        logger.error("Embedding error: %s", e)
        return None

def embed_query(question: str, timeout_sec: int = EMBEDDING_TIMEOUT):
    """Format and generate query embedding."""
    if not question or not question.strip():
        return None

    prepared = f"task: question answering | query: {question.strip()}"
    return _generate_embedding(prepared, timeout_sec)

def embed_document(
    text: str,
    title: str | None = None,
    context: str | None = None,
    timeout_sec: int = EMBEDDING_TIMEOUT,
    total_timeout_sec: int = EMBEDDING_TOTAL_TIMEOUT,
):
    """Generate a document embedding with bounded retries and total deadline."""
    if not text or not text.strip():
        return None

    title_str = title.strip() if title and title.strip() else "none"
    text_str = text.strip()

    if context and context.strip():
        content = f"{context.strip()}\n\n{text_str}"
    else:
        content = text_str

    prepared = f"title: {title_str} | text: {content}"

    max_attempts = 3
    backoff = 1.0
    deadline = time.perf_counter() + float(total_timeout_sec)

    for attempt in range(max_attempts):
        remaining = deadline - time.perf_counter()

        if remaining <= 0:
            logger.warning("Embedding total timeout exhausted before attempt %d", attempt + 1)
            return None

        attempt_timeout = min(float(timeout_sec), remaining)

        emb = _generate_embedding(prepared, attempt_timeout)

        if emb:
            return emb

        remaining = deadline - time.perf_counter()

        if attempt >= max_attempts - 1 or remaining <= 0:
            break

        sleep_time = min(backoff, remaining)

        logger.warning(
            "Embedding failed. Retrying in %.1fs "
            "(attempt %d/%d, %.2fs remaining)...",
            sleep_time,
            attempt + 1,
            max_attempts,
            remaining,
        )

        time.sleep(sleep_time)
        backoff *= 2

    logger.warning("Embedding failed after %d attempts within total timeout", max_attempts)
    return None