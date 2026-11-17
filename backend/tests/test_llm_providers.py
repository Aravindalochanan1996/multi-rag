import json

import httpx
import pytest

from app import llm as llm_module
from app.analysis import analyse_fit
from app.llm import AnthropicLLM, GroqLLM, LLMError, OllamaLLM, make_llm


class FakeStreamCtx:
    def __init__(self, parts, boom=None):
        self.parts, self.boom = parts, boom

    def __enter__(self):
        if self.boom:
            raise self.boom
        return self

    def __exit__(self, *exc):
        return False

    @property
    def text_stream(self):
        yield from self.parts


class FakeMessages:
    def __init__(self, parts, boom=None):
        self.parts, self.boom, self.kwargs = parts, boom, None

    def stream(self, **kwargs):
        self.kwargs = kwargs
        return FakeStreamCtx(self.parts, self.boom)


class FakeClient:
    def __init__(self, parts=(), boom=None):
        self.messages = FakeMessages(list(parts), boom)


def test_streams_text_and_passes_model_and_system():
    client = FakeClient(["Hel", "lo"])
    llm = AnthropicLLM(client=client, model="claude-test")
    assert "".join(llm.stream("sys", "hi")) == "Hello"
    kw = client.messages.kwargs
    assert kw["model"] == "claude-test" and kw["system"] == "sys"
    assert kw["messages"] == [{"role": "user", "content": "hi"}]


def test_json_mode_appends_instruction_and_zero_temperature():
    client = FakeClient(["{}"])
    AnthropicLLM(client=client).complete("sys", "hi", json_mode=True)
    kw = client.messages.kwargs
    assert "single valid JSON object" in kw["system"] and kw["temperature"] == 0.0


def test_sdk_errors_become_llm_error():
    llm = AnthropicLLM(client=FakeClient(boom=RuntimeError("rate limited")))
    with pytest.raises(LLMError, match="rate limited"):
        llm.complete("s", "p")


def test_missing_key_gives_actionable_error(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "anthropic_api_key", "")
    with pytest.raises(LLMError, match="ANTHROPIC_API_KEY"):
        AnthropicLLM()


def test_factory_selects_provider(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "llm_provider", "ollama")
    assert isinstance(make_llm(), OllamaLLM)
    monkeypatch.setattr(llm_module.settings, "llm_provider", "nope")
    with pytest.raises(LLMError, match="Unknown"):
        make_llm()


def test_fit_analysis_accepts_fenced_json_from_hosted_model():
    payload = {"requirements": [{"requirement": "Python", "priority": "required",
                                 "status": "met", "evidence": "Python"}]}
    fenced = "Here you go:\n```json\n" + json.dumps(payload) + "\n```"
    llm = AnthropicLLM(client=FakeClient([fenced]))
    result = analyse_fit("j", "t", "REQUIREMENTS\nPython", "SKILLS\nPython", llm)
    assert result.score == 100


def groq_transport(chunks, status=200, seen=None):
    def handler(request):
        if seen is not None:
            seen.append(json.loads(request.content))
            seen.append(request.headers["authorization"])
        lines = [f"data: {json.dumps({'choices': [{'delta': {'content': c}}]})}\n\n"
                 for c in chunks]
        body = "".join(lines) + "data: [DONE]\n\n"
        return httpx.Response(status, content=body.encode())
    return httpx.MockTransport(handler)


def test_groq_streams_openai_style_sse():
    seen = []
    llm = GroqLLM(api_key="k", transport=groq_transport(["Hel", "lo"], seen=seen))
    assert llm.complete("sys", "hi", json_mode=True) == "Hello"
    body, auth = seen
    assert body["response_format"] == {"type": "json_object"} and body["stream"] is True
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    assert auth == "Bearer k"


def test_groq_http_error_becomes_llm_error():
    llm = GroqLLM(api_key="k", transport=groq_transport([], status=401))
    with pytest.raises(LLMError, match="401"):
        llm.complete("s", "p")


def test_groq_requires_key(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "groq_api_key", "")
    with pytest.raises(LLMError, match="GROQ_API_KEY"):
        GroqLLM()


def test_factory_builds_groq(monkeypatch):
    monkeypatch.setattr(llm_module.settings, "llm_provider", "groq")
    monkeypatch.setattr(llm_module.settings, "groq_api_key", "k")
    assert isinstance(make_llm(), GroqLLM)


def test_groq_retries_on_429_then_succeeds_without_duplicate_output():
    calls = {"n": 0}
    sleeps = []

    def handler(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(429, headers={"retry-after": "2"}, content=b"{}")
        chunk = json.dumps({"choices": [{"delta": {"content": "ok"}}]})
        body = f"data: {chunk}\n\ndata: [DONE]\n\n"
        return httpx.Response(200, content=body.encode())

    llm = GroqLLM(api_key="k", transport=httpx.MockTransport(handler), sleep=sleeps.append)
    assert llm.complete("s", "p") == "ok"
    assert calls["n"] == 3 and sleeps == [2.0, 2.0]


def test_groq_gives_up_after_max_retries():
    llm = GroqLLM(api_key="k", transport=httpx.MockTransport(lambda r: httpx.Response(429, content=b"{}")),
                  sleep=lambda s: None)
    with pytest.raises(LLMError, match="429"):
        llm.complete("s", "p")
