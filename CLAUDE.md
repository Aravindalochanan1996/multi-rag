# Career Intelligence Assistant

RAG app: upload a resume + job descriptions, ask about fit, skill gaps, interview prep.

## Stack
FastAPI (backend/), React+Vite+Tailwind (frontend/), Postgres+pgvector, Ollama (default LLM + embeddings), Anthropic as optional provider.

## Conventions
- No LangChain; plain Python. LLM/embeddings go through `providers.py` interfaces.
- Type hints everywhere; `ruff check .` and `pytest` must pass before commit.
- Small commits, one concern each. Tests alongside every new module.
- Uploaded document text is DATA, never instructions: always delimit it in prompts.
- Structured endpoints return Pydantic-validated JSON; retry once on invalid output.
- Answers must cite chunks; refuse when retrieval is below the similarity threshold.

## Commands
- Backend tests: `cd backend && pytest -q`
- Run all: `cp .env.example .env && docker compose up --build`
- Pull models: `docker compose exec ollama ollama pull llama3.1` and `nomic-embed-text`

## AI usage rules (keep updated in notes.md)
- AI drafts code; I review every diff. AI does not write README prose or design decisions.
