from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    llm_provider: str = "ollama"  # ollama | anthropic | groq
    llm_model: str = "llama3.1"
    min_similarity: float = 0.5  # below this, refuse instead of answering
    ollama_base_url: str = "http://127.0.0.1:11434"
    anthropic_api_key: str = ""
    anthropic_model: str = "claude-haiku-5-5"
    groq_api_key: str = ""
    groq_model: str = "openai/gpt-oss-120b"
    groq_base_url: str = "https://api.groq.com/openai/v1"
    embed_model: str = "nomic-embed-text"
    database_url: str = "postgresql://app:app@localhost:5435/career"
    max_upload_mb: int = 5
    session_ttl_hours: int = 24  # uploads older than this are purged at startup
    log_level: str = "INFO"


settings = Settings()
