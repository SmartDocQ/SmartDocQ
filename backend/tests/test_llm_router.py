import pytest
from unittest.mock import MagicMock, patch, ANY
from services.llm_router import LLMRouter, ROUTING_POLICY, _classify_error
from config import TEXT_MODEL, GROQ_MODEL, CEREBRAS_PRIMARY_MODEL, CEREBRAS_FALLBACK_MODEL


def test_task_validation():
    router = LLMRouter()
    with pytest.raises(ValueError, match="Unknown task: 'invalid_task'"):
        router.generate(task="invalid_task", prompt="Test")


def test_routing_policy_is_configured():
    assert ROUTING_POLICY["qa"] == ("gemini", "groq", "cerebras")
    assert ROUTING_POLICY["general_qa"] == ("groq", "gemini", "cerebras")
    assert ROUTING_POLICY["summarization"] == ("gemini", "groq", "cerebras")
    assert ROUTING_POLICY["quiz"] == ("groq", "gemini", "cerebras")
    assert ROUTING_POLICY["flashcards"] == ("groq", "gemini", "cerebras")
    assert ROUTING_POLICY["conversation"] == ("groq", "gemini", "cerebras")


def test_classify_error():
    assert _classify_error(Exception("429 Too Many Requests")) == "rate_limit"
    assert _classify_error(Exception("DeadlineExceeded timeout")) == "timeout"
    assert _classify_error(Exception("401 Unauthorized API_KEY")) == "auth_error"
    assert _classify_error(Exception("400 BadRequest invalid parameter")) == "invalid_request"
    assert _classify_error(Exception("503 Service Unavailable")) == "server_error"
    assert _classify_error(Exception("Connection error")) == "network_error"
    assert _classify_error(Exception("Some random error")) == "unknown"


@patch.object(LLMRouter, "_generate_gemini")
@patch.object(LLMRouter, "_generate_groq")
def test_primary_provider_selection(mock_groq, mock_gemini):
    mock_gemini.return_value = "Gemini answer"
    mock_groq.return_value = "Groq answer"

    router = LLMRouter()

    # QA (Primary: Gemini)
    res = router.generate(task="qa", prompt="What is SmartDoc?")
    assert res["provider"] == "gemini"
    assert res["model"] == TEXT_MODEL
    assert res["text"] == "Gemini answer"
    assert res["fallback_used"] is False
    assert res["fallback_reason"] is None
    mock_gemini.assert_called_once()

    mock_gemini.reset_mock()
    mock_groq.reset_mock()

    # General QA (Primary: Groq)
    res = router.generate(task="general_qa", prompt="Hello world")
    assert res["provider"] == "groq"
    assert res["model"] == GROQ_MODEL
    assert res["text"] == "Groq answer"
    assert res["fallback_used"] is False
    assert res["fallback_reason"] is None
    mock_groq.assert_called_once()


@patch.object(LLMRouter, "_generate_gemini")
@patch.object(LLMRouter, "_generate_groq")
def test_fallback_on_rate_limit(mock_groq, mock_gemini):
    mock_gemini.side_effect = Exception("429 RESOURCE_EXHAUSTED Rate limit exceeded")
    mock_groq.return_value = "Fallback Groq Answer"

    router = LLMRouter()

    res = router.generate(task="qa", prompt="Explain RAG")

    assert res["provider"] == "groq"
    assert res["model"] == GROQ_MODEL
    assert res["text"] == "Fallback Groq Answer"
    assert res["fallback_used"] is True
    assert res["fallback_reason"] == "rate_limit"


@patch.object(LLMRouter, "_generate_gemini")
@patch.object(LLMRouter, "_generate_groq")
def test_non_fallback_on_auth_error(mock_groq, mock_gemini):
    mock_gemini.side_effect = Exception("401 Invalid API_KEY specified")

    router = LLMRouter()

    with pytest.raises(Exception, match="401 Invalid API_KEY"):
        router.generate(task="qa", prompt="Explain RAG")

    mock_groq.assert_not_called()


@patch.object(LLMRouter, "_generate_gemini")
@patch.object(LLMRouter, "_generate_groq")
@patch.object(LLMRouter, "_generate_cerebras")
def test_cerebras_provider_fallback(mock_cerebras, mock_groq, mock_gemini):
    mock_gemini.side_effect = Exception("429 Rate limit")
    mock_groq.side_effect = Exception("503 Service Unavailable")
    mock_cerebras.return_value = "Cerebras 70B Answer"

    router = LLMRouter()
    res = router.generate(task="qa", prompt="Explain deep learning")

    assert res["provider"] == "cerebras"
    assert res["model"] == CEREBRAS_PRIMARY_MODEL
    assert res["text"] == "Cerebras 70B Answer"
    assert res["fallback_used"] is True
    assert res["fallback_reason"] == "server_error"
    mock_cerebras.assert_called_once()


@patch.object(LLMRouter, "_generate_gemini")
@patch.object(LLMRouter, "_generate_groq")
@patch.object(LLMRouter, "_generate_cerebras")
def test_cerebras_internal_model_fallback(mock_cerebras, mock_groq, mock_gemini):
    mock_gemini.side_effect = Exception("429 Rate limit")
    mock_groq.side_effect = Exception("504 Gateway Timeout")

    def cerebras_side_effect(*args, **kwargs):
        if kwargs.get("model") == CEREBRAS_PRIMARY_MODEL:
            raise Exception("429 Rate limit exceeded on 70B")
        return "Cerebras 8B Answer"

    mock_cerebras.side_effect = cerebras_side_effect

    router = LLMRouter()
    res = router.generate(task="qa", prompt="Explain neural networks")

    assert res["provider"] == "cerebras"
    assert res["model"] == CEREBRAS_FALLBACK_MODEL
    assert res["text"] == "Cerebras 8B Answer"
    assert res["fallback_used"] is True
    assert res["fallback_reason"] == "cerebras_model_rate_limit"


@patch.object(LLMRouter, "_generate_gemini")
@patch.object(LLMRouter, "_generate_groq")
@patch.object(LLMRouter, "_generate_cerebras")
def test_cerebras_non_retryable_auth_error(mock_cerebras, mock_groq, mock_gemini):
    mock_gemini.side_effect = Exception("429 Rate limit")
    mock_groq.side_effect = Exception("429 Rate limit")
    mock_cerebras.side_effect = Exception("401 Unauthorized API key")

    router = LLMRouter()

    with pytest.raises(Exception, match="401 Unauthorized"):
        router.generate(task="qa", prompt="Test auth")

    # Should only call Cerebras primary model once and fail immediately without attempting fallback model
    assert mock_cerebras.call_count == 1
    assert mock_cerebras.call_args[1]["model"] == CEREBRAS_PRIMARY_MODEL


@patch("services.llm_router.genai")
def test_generate_gemini_json(mock_genai):
    mock_model = MagicMock()
    mock_resp = MagicMock()
    mock_resp.text = '{"answer": "JSON result"}'
    mock_model.generate_content.return_value = mock_resp
    mock_genai.GenerativeModel.return_value = mock_model

    router = LLMRouter()
    res = router._generate_gemini("Prompt text", response_json=True, temperature=0.5, max_tokens=100, timeout=10)

    assert res == '{"answer": "JSON result"}'
    mock_genai.GenerativeModel.assert_called_once_with(
        ANY,
        generation_config={"temperature": 0.5, "response_mime_type": "application/json", "max_output_tokens": 100}
    )


@patch.object(LLMRouter, "_get_groq_client")
def test_generate_groq_json(mock_get_client):
    mock_client = MagicMock()
    mock_completion = MagicMock()
    mock_choice = MagicMock()
    mock_choice.message.content = '{"questions": []}'
    mock_completion.choices = [mock_choice]
    mock_client.chat.completions.create.return_value = mock_completion
    mock_get_client.return_value = mock_client

    router = LLMRouter()
    res = router._generate_groq("Prompt text", response_json=True, temperature=0.4, max_tokens=500, timeout=10)

    assert res == '{"questions": []}'
    mock_client.chat.completions.create.assert_called_once()
    kwargs = mock_client.chat.completions.create.call_args[1]
    assert kwargs["response_format"] == {"type": "json_object"}
    assert kwargs["temperature"] == 0.4
    assert kwargs["max_tokens"] == 500


@patch.object(LLMRouter, "_get_cerebras_client")
def test_generate_cerebras_json(mock_get_client):
    mock_client = MagicMock()
    mock_completion = MagicMock()
    mock_choice = MagicMock()
    mock_choice.message.content = '{"cards": []}'
    mock_completion.choices = [mock_choice]
    mock_client.chat.completions.create.return_value = mock_completion
    mock_get_client.return_value = mock_client

    router = LLMRouter()
    res = router._generate_cerebras("Prompt text", response_json=True, temperature=0.4, max_tokens=500, timeout=10, model=CEREBRAS_PRIMARY_MODEL)

    assert res == '{"cards": []}'
    mock_client.chat.completions.create.assert_called_once()
    kwargs = mock_client.chat.completions.create.call_args[1]
    assert kwargs["model"] == CEREBRAS_PRIMARY_MODEL
    assert kwargs["response_format"] == {"type": "json_object"}


@patch.object(LLMRouter, "_generate_gemini")
@patch.object(LLMRouter, "_generate_groq")
def test_fallback_float_timeout_preservation(mock_groq, mock_gemini):
    mock_gemini.side_effect = Exception("429 Rate limit")
    mock_groq.return_value = "Groq Float Timeout Answer"

    router = LLMRouter()
    # start_time=100.0 (deadline=115.0), primary_timeout=100.0 (10.0s), fallback_timeout=114.2 (0.8s)
    with patch("time.perf_counter", side_effect=[100.0, 100.0, 114.2]):
        res = router.generate(task="qa", prompt="Test float budget")

    assert res["provider"] == "groq"
    assert res["text"] == "Groq Float Timeout Answer"
    timeout_arg = mock_groq.call_args[0][4]
    assert timeout_arg == pytest.approx(0.8, abs=1e-2)
