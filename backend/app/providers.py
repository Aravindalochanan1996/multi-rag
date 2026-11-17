"""Swappable LLM / embedding providers. Implementations are TODO."""
from collections.abc import Iterator
from typing import Protocol


class LLMProvider(Protocol):
    def complete(self, system: str, prompt: str, json_mode: bool = False) -> str: ...

    def stream(self, system: str, prompt: str, json_mode: bool = False) -> Iterator[str]: ...


class Embedder(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...
