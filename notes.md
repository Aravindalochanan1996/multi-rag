# Build notes (raw material for the README, write in your own words)

Log decisions as you go: "I chose X over Y because ...".

## AI usage rules
- AI drafts code; I review every diff.
- AI does not write README prose or design decisions. The README was drafted from my answers and then edited.
- I say how the code is structured first (modules, components, utilities), then let it write the code.
- Project rules live in `CLAUDE.md` so every session follows the same ones: no LangChain, type hints, tests
  beside every module, `ruff` and `pytest` pass before commit, uploaded text is data, answers cite or refuse.
- I run the app and the tests myself instead of trusting "it works".
- No secrets in git. Keys live in `.env`, which is git-ignored. (A Groq key was pasted into a chat once, so
  it needs rotating.)
- Small commits, one concern each, merged to `main` only after CI is green.

## Decisions
- Plain Python, no LangChain, so every step of retrieval and prompting is readable.
- Postgres + pgvector instead of a separate vector database: one store, exact cosine search is fast enough at
  this size.
- Local embeddings (`nomic-embed-text` via Ollama) so documents never leave the machine for embedding.
- Prepending the document title to each chunk before embedding. Retrieval hit rate went from 33% to 100%.
- The fit score is computed in code (required counts double, partial counts half), not by the model, and
  quotes are checked against the resume.
- Refuse without calling the LLM when the best match is below the similarity threshold (0.5).
- Pluggable LLM provider (Ollama, Groq, Anthropic) behind one interface.
- Long analyses stream over SSE so a proxy doesn't drop them.
- URL import blocks private addresses and LinkedIn/Indeed/Glassdoor, with a paste fallback.

## Where the AI got it wrong / I corrected it
- Several tests had wrong expected values; the code was right and the tests were sloppy.
- A rule requiring requirement names of 2+ characters rejected "R". The eval run caught it.
- The first fit-analysis design blocked for minutes and failed behind a proxy. Replaced with streaming.
- The first hosted model name (`llama-3.3-70b-versatile`) did not exist for my key. Found by listing models.
- The resume-tips checks missed invented results with no numbers in them, so I added a claims check.
- Chat comparison questions missed resume chunks until retrieval was balanced across resume and job.

## Eval numbers (retrieval hit rate, groundedness)
- Golden eval (`backend/evals`): all metrics 1.0 on the last run, including retrieval hit rate.
- Retrieval hit rate 33% -> 100% after adding the document title to the embedded text.
- Fit analysis: about 2 s on Groq versus 85-170 s on a local model.
- 155 tests, 87% line coverage.

## Things I skipped on purpose
- Login and multi-user support, database migrations, frontend tests, rate limiting, OCR for scanned PDFs,
  load testing.
- The eval set does not yet cover interview prep, resume tips or URL import.
- Hybrid search and reranking.
