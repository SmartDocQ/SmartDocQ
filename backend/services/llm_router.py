"""Task-aware LLM router with multi-provider + internal Cerebras model fallback execution.

Responsible for:
- Multi-provider task policy routing (Gemini vs Groq vs Cerebras)
- Internal Cerebras model fallback (llama-3.3-70b -> llama3.1-8b)
- Total latency budget enforcement
- Error classification into internal categories (rate_limit, server_error, timeout, network_error, auth_error, invalid_request)
- Retryable error fallback
- Provider-specific JSON output handling
- Response normalization preserving actual provider and model used
"""

import logging
import time
from typing import Any, Dict, Optional, Tuple

from cerebras.cloud.sdk import Cerebras
import groq

from config import (
    CEREBRAS_API_KEY,
    CEREBRAS_FALLBACK_MODEL,
    CEREBRAS_MODELS,
    CEREBRAS_PRIMARY_MODEL,
    GEMINI_API_KEY,
    GROQ_API_KEY,
    GROQ_MODEL,
    LLM_FALLBACK_TIMEOUT,
    LLM_PRIMARY_TIMEOUT,
    LLM_TOTAL_TIMEOUT,
    TEXT_MODEL,
)
from services.gemini_client import genai

logger = logging.getLogger(__name__)

# Policy mapping:
# task -> (primary_provider, fallback_provider_1, fallback_provider_2)
ROUTING_POLICY: Dict[str, Tuple[str, ...]] = {
    "qa": ("gemini", "groq", "cerebras"),
    "general_qa": ("groq", "gemini", "cerebras"),
    "summarization": ("gemini", "groq", "cerebras"),
    "quiz": ("groq", "gemini", "cerebras"),
    "flashcards": ("groq", "gemini", "cerebras"),
    "conversation": ("groq", "gemini", "cerebras"),
}

# Error Categories:
# Retryable / Fallback: "rate_limit", "server_error", "timeout", "network_error"
# Non-retryable: "auth_error", "invalid_request", "unknown"
RETRYABLE_CATEGORIES = {"rate_limit", "server_error", "timeout", "network_error"}


def _classify_error(err: Exception) -> str:
    """Classify SDK exceptions into normalized internal error categories."""
    if err is None:
        return "unknown"

    err_type = type(err).__name__
    err_str = str(err).lower()

    # Timeouts
    if "timeout" in err_type.lower() or "deadlineexceeded" in err_str or "timed out" in err_str:
        return "timeout"

    # Rate limits / Resource exhausted
    if (
        "ratelimit" in err_type.lower()
        or "429" in err_str
        or "resource_exhausted" in err_str
        or "too many requests" in err_str
    ):
        return "rate_limit"

    # Auth errors
    if (
        "authentication" in err_type.lower()
        or "api_key" in err_str
        or "401" in err_str
        or "403" in err_str
        or "unauthorized" in err_str
        or "permission" in err_str
    ):
        return "auth_error"

    # Invalid request / parameters
    if (
        "badrequest" in err_type.lower()
        or "invalidargument" in err_str
        or "400" in err_str
        or "422" in err_str
        or "invalid_request" in err_str
    ):
        return "invalid_request"

    # Server errors
    if "500" in err_str or "502" in err_str or "503" in err_str or "504" in err_str or "service unavailable" in err_str:
        return "server_error"

    # Connection / Network
    if "connection" in err_type.lower() or "network" in err_str or "connection error" in err_str:
        return "network_error"

    return "unknown"


class LLMRouter:
    def __init__(self):
        self._groq_client = None
        self._cerebras_client = None

    def _get_groq_client(self) -> groq.Groq:
        if self._groq_client is None:
            self._groq_client = groq.Groq(api_key=GROQ_API_KEY)
        return self._groq_client

    def _get_cerebras_client(self) -> Cerebras:
        if self._cerebras_client is None:
            self._cerebras_client = Cerebras(api_key=CEREBRAS_API_KEY)
        return self._cerebras_client

    def _generate_gemini(
        self,
        prompt: str,
        response_json: bool,
        temperature: float,
        max_tokens: Optional[int],
        timeout: float,
    ) -> str:
        gen_config: Dict[str, Any] = {"temperature": temperature}
        if response_json:
            gen_config["response_mime_type"] = "application/json"
        if max_tokens:
            gen_config["max_output_tokens"] = max_tokens

        model = genai.GenerativeModel(TEXT_MODEL, generation_config=gen_config if gen_config else None)
        resp = model.generate_content(prompt, request_options={"timeout": float(timeout)})
        if resp and resp.text:
            return resp.text.strip()
        raise RuntimeError("Empty response from Gemini")

    def _generate_groq(
        self,
        prompt: str,
        response_json: bool,
        temperature: float,
        max_tokens: Optional[int],
        timeout: float,
    ) -> str:
        client = self._get_groq_client()
        kwargs: Dict[str, Any] = {
            "model": GROQ_MODEL,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "timeout": float(timeout),
        }
        if response_json:
            kwargs["response_format"] = {"type": "json_object"}
        if max_tokens:
            kwargs["max_tokens"] = max_tokens

        chat_completion = client.chat.completions.create(**kwargs)
        if (
            chat_completion
            and chat_completion.choices
            and chat_completion.choices[0].message
            and chat_completion.choices[0].message.content
        ):
            return chat_completion.choices[0].message.content.strip()
        raise RuntimeError("Empty response from Groq")

    def _generate_cerebras(
        self,
        prompt: str,
        response_json: bool,
        temperature: float,
        max_tokens: Optional[int],
        timeout: float,
        model: str,
    ) -> str:
        client = self._get_cerebras_client()
        kwargs: Dict[str, Any] = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": temperature,
            "timeout": float(timeout),
        }
        if response_json:
            kwargs["response_format"] = {"type": "json_object"}
        if max_tokens:
            kwargs["max_tokens"] = max_tokens

        chat_completion = client.chat.completions.create(**kwargs)
        if (
            chat_completion
            and chat_completion.choices
            and chat_completion.choices[0].message
            and chat_completion.choices[0].message.content
        ):
            return chat_completion.choices[0].message.content.strip()
        raise RuntimeError(f"Empty response from Cerebras model '{model}'")

    def _generate_cerebras_with_fallback(
        self,
        prompt: str,
        response_json: bool,
        temperature: float,
        max_tokens: Optional[int],
        deadline: float,
    ) -> dict:
        """Internal model fallback for Cerebras: llama-3.3-70b -> llama3.1-8b."""
        last_err = None
        model_fallback_reason = None

        for idx, model in enumerate(CEREBRAS_MODELS):
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                raise TimeoutError("Total LLM latency budget exhausted during Cerebras model execution.")

            # IMPORTANT:
            # This timeout is bounded by the SAME global deadline
            # owned by LLMRouter.generate().
            # It is NOT a new 15-second budget.
            model_timeout = min(
                float(LLM_FALLBACK_TIMEOUT if idx > 0 else LLM_PRIMARY_TIMEOUT),
                max(0.0, remaining),
            )
            if model_timeout <= 0:
                raise TimeoutError("Total LLM latency budget exhausted before Cerebras model attempt.")

            try:
                text = self._generate_cerebras(
                    prompt=prompt,
                    response_json=response_json,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=model_timeout,
                    model=model,
                )
                return {
                    "text": text,
                    "model": model,
                    "model_fallback_used": (idx > 0),
                    "model_fallback_reason": model_fallback_reason,
                }
            except Exception as err:
                category = _classify_error(err)
                last_err = err
                logger.warning(
                    f"[LLMRouter] Cerebras model '{model}' failed (attempt {idx + 1}/{len(CEREBRAS_MODELS)}). "
                    f"Category: '{category}', Error: {err}"
                )

                if category not in RETRYABLE_CATEGORIES:
                    raise err

                model_fallback_reason = f"cerebras_model_{category}"
                if idx == len(CEREBRAS_MODELS) - 1:
                    raise err

        if last_err:
            raise last_err
        raise RuntimeError("Cerebras generation failed on all models.")

    def _call_provider(
        self,
        provider: str,
        prompt: str,
        response_json: bool,
        temperature: float,
        max_tokens: Optional[int],
        timeout: float,
        deadline: float,
    ) -> dict:
        if provider == "gemini":
            text = self._generate_gemini(prompt, response_json, temperature, max_tokens, timeout)
            return {"text": text, "model": TEXT_MODEL, "model_fallback_used": False, "model_fallback_reason": None}
        elif provider == "groq":
            text = self._generate_groq(prompt, response_json, temperature, max_tokens, timeout)
            return {"text": text, "model": GROQ_MODEL, "model_fallback_used": False, "model_fallback_reason": None}
        elif provider == "cerebras":
            return self._generate_cerebras_with_fallback(
                prompt=prompt,
                response_json=response_json,
                temperature=temperature,
                max_tokens=max_tokens,
                deadline=deadline,
            )
        else:
            raise ValueError(f"Unknown provider: {provider}")

    def generate(
        self,
        task: str,
        prompt: str,
        response_json: bool = False,
        temperature: float = 0.7,
        max_tokens: Optional[int] = None,
    ) -> dict:
        """Route generation request through primary and fallback providers within total latency budget."""
        if task not in ROUTING_POLICY:
            raise ValueError(f"Unknown task: '{task}'. Supported tasks: {list(ROUTING_POLICY.keys())}")

        providers = ROUTING_POLICY[task]
        start_time = time.perf_counter()
        deadline = start_time + float(LLM_TOTAL_TIMEOUT)

        last_provider_err = None
        provider_fallback_reason = None

        for idx, provider in enumerate(providers):
            remaining = deadline - time.perf_counter()
            if remaining <= 0:
                logger.error(
                    f"[LLMRouter] Latency budget exhausted ({time.perf_counter() - start_time:.2f}s elapsed >= {LLM_TOTAL_TIMEOUT}s budget)."
                )
                if last_provider_err:
                    raise last_provider_err
                raise TimeoutError(f"[LLMRouter] Latency budget exhausted before calling provider '{provider}'.")

            attempt_timeout = min(
                float(LLM_PRIMARY_TIMEOUT if idx == 0 else LLM_FALLBACK_TIMEOUT),
                max(0.0, remaining),
            )
            if attempt_timeout <= 0:
                if last_provider_err:
                    raise last_provider_err
                raise TimeoutError(f"[LLMRouter] Latency budget exhausted before calling provider '{provider}'.")

            try:
                result = self._call_provider(
                    provider=provider,
                    prompt=prompt,
                    response_json=response_json,
                    temperature=temperature,
                    max_tokens=max_tokens,
                    timeout=attempt_timeout,
                    deadline=deadline,
                )

                # Determine fallback_used and fallback_reason
                fallback_used = (idx > 0) or result.get("model_fallback_used", False)

                if result.get("model_fallback_used"):
                    fallback_reason = result.get("model_fallback_reason")
                elif idx > 0:
                    fallback_reason = provider_fallback_reason
                else:
                    fallback_reason = None

                return {
                    "text": result["text"],
                    "provider": provider,
                    "model": result["model"],
                    "fallback_used": fallback_used,
                    "fallback_reason": fallback_reason,
                }
            except Exception as err:
                category = _classify_error(err)
                last_provider_err = err
                logger.warning(
                    f"[LLMRouter] Provider '{provider}' failed for task '{task}'. "
                    f"Category: '{category}', Error: {err}"
                )

                if category not in RETRYABLE_CATEGORIES:
                    raise err

                provider_fallback_reason = category
                if idx == len(providers) - 1:
                    raise err

        if last_provider_err:
            raise last_provider_err
        raise RuntimeError("LLM routing failed for all providers.")


router = LLMRouter()
generate = router.generate
