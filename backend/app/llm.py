import json
import logging
import time
from collections.abc import Iterator

import httpx

from .config import settings

log = logging.getLogger("llm")
MAX_RATE_LIMIT_RETRIES = 4


def _retry_delay(retry_after: str | None, attempt: int) -> float:
    """Honour Retry-After when present, else exponential backoff; capped so requests stay usable."""
    try:
        return min(float(retry_after), 30.0)
    except (TypeError, ValueError):
        return min(2.0 * 2 ** attempt, 30.0)


class LLMError(RuntimeError):
    pass


class OllamaLLM:
    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.llm_model

    def stream(self, system: str, prompt: str, json_mode: bool = False) -> Iterator[str]:
        payload = {
            "model": self.model,
            "stream": True,
            "keep_alive": "30m",  # avoid reloading the model between requests
            **({"format": "json"} if json_mode else {}),
            "options": {"temperature": 0.0 if json_mode else 0.2},
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": prompt}],
        }
        try:
            with httpx.stream("POST", f"{self.base_url}/api/chat", json=payload,
                              timeout=httpx.Timeout(300, connect=10)) as r:
                if r.status_code != 200:
                    r.read()
                    raise LLMError(f"Ollama returned {r.status_code}: {r.text[:200]}")
                for line in r.iter_lines():
                    if not line:
                        continue
                    data = json.loads(line)
                    if token := data.get("message", {}).get("content"):
                        yield token
                    if data.get("done"):
                        break
        except httpx.HTTPError as exc:
            raise LLMError(f"LLM call failed ({exc}). Is Ollama running and "
                           f"'{self.model}' pulled?") from exc

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        return "".join(self.stream(system, prompt, json_mode))


JSON_INSTRUCTION = ("\n\nRespond with a single valid JSON object only: no prose, "
                    "no markdown code fences.")


class AnthropicLLM:
    """Hosted Claude provider. Same interface as OllamaLLM; used when LLM_PROVIDER=anthropic.

    Only prompts go to the API. Embeddings stay local, so documents are never embedded remotely.
    """

    def __init__(self, api_key: str | None = None, model: str | None = None, client=None) -> None:
        key = api_key or settings.anthropic_api_key
        if client is None:
            if not key:
                raise LLMError("ANTHROPIC_API_KEY is not set. Add it to .env or switch "
                               "LLM_PROVIDER back to ollama.")
            import anthropic  # imported lazily so Ollama-only installs don't need it
            client = anthropic.Anthropic(api_key=key)
        self.client = client
        self.model = model or settings.anthropic_model

    def stream(self, system: str, prompt: str, json_mode: bool = False) -> Iterator[str]:
        try:
            with self.client.messages.stream(
                model=self.model,
                max_tokens=2048,
                temperature=0.0 if json_mode else 0.2,
                system=system + (JSON_INSTRUCTION if json_mode else ""),
                messages=[{"role": "user", "content": prompt}],
            ) as stream:
                yield from stream.text_stream
        except LLMError:
            raise
        except Exception as exc:  # the SDK raises many error types; surface a single one
            raise LLMError(f"Claude API call failed: {exc}") from exc

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        return "".join(self.stream(system, prompt, json_mode))


class GroqLLM:
    """Groq's OpenAI-compatible chat API (fast hosted open models). LLM_PROVIDER=groq."""

    def __init__(self, api_key: str | None = None, model: str | None = None,
                 base_url: str | None = None, transport: httpx.BaseTransport | None = None,
                 sleep=time.sleep) -> None:
        self.sleep = sleep
        self.api_key = api_key or settings.groq_api_key
        if not self.api_key:
            raise LLMError("GROQ_API_KEY is not set. Add it to .env or change LLM_PROVIDER.")
        self.model = model or settings.groq_model
        self.base_url = (base_url or settings.groq_base_url).rstrip("/")
        self.transport = transport

    def stream(self, system: str, prompt: str, json_mode: bool = False) -> Iterator[str]:
        payload = {
            "model": self.model,
            "stream": True,
            "temperature": 0.0 if json_mode else 0.2,
            "messages": [{"role": "system", "content": system},
                         {"role": "user", "content": prompt}],
            **({"response_format": {"type": "json_object"}} if json_mode else {}),
        }
        for attempt in range(MAX_RATE_LIMIT_RETRIES + 1):
            try:
                with (
                    httpx.Client(transport=self.transport, timeout=httpx.Timeout(120, connect=10)) as c,
                    c.stream("POST", f"{self.base_url}/chat/completions", json=payload,
                             headers={"Authorization": f"Bearer {self.api_key}"}) as r,
                ):
                    if r.status_code == 429 and attempt < MAX_RATE_LIMIT_RETRIES:
                        r.read()  # nothing streamed yet, so a retry is safe
                        delay = _retry_delay(r.headers.get("retry-after"), attempt)
                    elif r.status_code != 200:
                        r.read()
                        raise LLMError(f"Groq returned {r.status_code}: {r.text[:200]}")
                    else:
                        for line in r.iter_lines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if data == "[DONE]":
                                return
                            choices = json.loads(data).get("choices") or [{}]
                            if token := choices[0].get("delta", {}).get("content"):
                                yield token
                        return
            except httpx.HTTPError as exc:
                raise LLMError(f"Groq call failed ({exc})") from exc
            log.warning("groq rate limited, retrying in %.1fs", delay)
            self.sleep(delay)

    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str:
        return "".join(self.stream(system, prompt, json_mode))


def make_llm():
    """Build the configured provider (LLM_PROVIDER=ollama|anthropic|groq)."""
    if settings.llm_provider == "anthropic":
        return AnthropicLLM()
    if settings.llm_provider == "groq":
        return GroqLLM()
    if settings.llm_provider == "ollama":
        return OllamaLLM()
    raise LLMError(f"Unknown LLM_PROVIDER '{settings.llm_provider}'")
