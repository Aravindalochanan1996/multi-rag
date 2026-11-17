import httpx

from .config import settings

EMBED_DIM = 768  # nomic-embed-text; change together with the vector column in db.py


class EmbeddingError(RuntimeError):
    pass


class OllamaEmbedder:
    def __init__(self, base_url: str | None = None, model: str | None = None) -> None:
        self.base_url = (base_url or settings.ollama_base_url).rstrip("/")
        self.model = model or settings.embed_model

    def embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        try:
            r = httpx.post(
                f"{self.base_url}/api/embed",
                json={"model": self.model, "input": texts},
                timeout=120,
            )
            r.raise_for_status()
        except httpx.HTTPError as exc:
            raise EmbeddingError(
                f"Embedding call failed ({exc}). Is Ollama running and "
                f"'{self.model}' pulled?"
            ) from exc
        return r.json()["embeddings"]
