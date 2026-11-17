# Runbook

How to run, configure, operate and troubleshoot the Career Intelligence Assistant.

## 1. Components and ports

| Component | Docker mode | Local dev mode | Notes |
|---|---|---|---|
| Web UI (nginx) | http://localhost:8090 | — | proxies `/api/*` → api, 600 s read timeout for streaming |
| Web UI (Vite) | — | http://localhost:5173 | hot reload; proxy target set by `API_URL` (default `http://127.0.0.1:8000`) |
| API (FastAPI) | http://localhost:8091 | http://127.0.0.1:8010 (your choice) | Swagger at `/docs` |
| Postgres + pgvector | `localhost:5435` | `localhost:5435` | user/password `app`/`app`, db `career`; Postgres itself listens on **5435** (set via `postgres -p 5435`) |
| Ollama | host `:11434` | host `:11434` | required for embeddings; used for chat only if `LLM_PROVIDER=ollama` |

Host ports are overridable: `WEB_PORT` (default 8090) and `API_PORT` (default 8091) in `.env` or the shell.

## 2. First-time setup

```bash
cp .env.example .env            # edit values, see §3
ollama pull nomic-embed-text    # always required
ollama pull llama3.1            # only for LLM_PROVIDER=ollama
```

## 3. Configuration (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `LLM_PROVIDER` | `ollama` | `ollama`, `groq` or `anthropic` |
| `LLM_MODEL` | `llama3.1` | Ollama chat model |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Use `127.0.0.1`, not `localhost` (see Troubleshooting) |
| `GROQ_API_KEY` / `GROQ_MODEL` | — / `openai/gpt-oss-120b` | Groq (OpenAI-compatible API) |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | — / `claude-haiku-5-5` | Anthropic |
| `EMBED_MODEL` | `nomic-embed-text` | Embedding model (768-dim; changing dimension requires changing `EMBED_DIM` and recreating the DB) |
| `DATABASE_URL` | `postgresql://app:app@localhost:5435/career` | Docker overrides the host to `db:5435` |
| `MIN_SIMILARITY` | `0.5` | Below this best-match score the assistant refuses instead of answering |
| `MAX_UPLOAD_MB` | `5` | Upload size cap |
| `SESSION_TTL_HOURS` | `24` | Documents older than this are deleted when the API starts |
| `LOG_LEVEL` | `INFO` | JSON logs to stdout |

**Secrets:** `.env` is git-ignored. Never commit keys. Rotate any key that has been pasted into a chat or shared screen.

**Provider trade-off:** `ollama` keeps all text on your machine but a fit analysis takes about 1.5–3 minutes on CPU;
`groq`/`anthropic` return it in seconds but send resume/job text to the provider. Embeddings are always local.

## 4. Run with Docker (recommended)

```bash
docker compose up --build -d        # db, api, web
docker compose ps                   # all should be Up; db "healthy"
curl http://localhost:8090/api/health
```

- Restart one service after editing `.env`: `docker compose up -d api`
- Logs: `docker compose logs -f api`
- Optional bundled Ollama instead of the host's: `docker compose --profile ollama up -d`, then set
  `DOCKER_OLLAMA_URL=http://ollama:11434` and pull models inside it
  (`docker compose exec ollama ollama pull nomic-embed-text`). Don't run both on port 11434.
- Stop: `docker compose down` (keeps data). Wipe all data: `docker compose down -v`.

The `api` container reaches host Ollama through `host.docker.internal:11434`.

## 5. Run locally without Docker (hot reload)

```bash
# 1) database
docker compose up -d db

# 2) backend (from backend/)
python -m venv .venv && . .venv/Scripts/activate        # Windows Git Bash; use bin/activate on macOS/Linux
pip install -r requirements.txt -r requirements-dev.txt
set -a && . ../.env && set +a                            # load env vars (Settings reads the environment)
uvicorn app.main:app --port 8010 --reload

# 3) frontend (from frontend/)
npm install
API_URL=http://127.0.0.1:8010 npm run dev -- --port 5173
```

The schema is created automatically on API startup (idempotent). Open http://localhost:5173.

## 6. Health checks

| Check | Command | Healthy result |
|---|---|---|
| API up + provider | `curl localhost:8091/health` | `{"status":"ok","llm_provider":"…"}` |
| Through the web proxy | `curl localhost:8090/api/health` | same |
| Database | `docker compose exec db psql -p 5435 -U app -d career -c "select count(*) from documents"` | a number |
| Ollama + models | `ollama list` | `nomic-embed-text` present |
| Embeddings work | upload any text file in the UI | document appears with N chunks |

## 7. Common operations

**Switch LLM provider:** edit `LLM_PROVIDER` (+ key/model) in `.env`, then `docker compose up -d api` (or restart uvicorn).

**List available Groq models for your key** (key stays on your machine):
```bash
curl -s https://api.groq.com/openai/v1/models -H "Authorization: Bearer $GROQ_API_KEY"
```

**Inspect stored data:**
```bash
docker compose exec db psql -p 5435 -U app -d career -c \
 "select d.doc_type, d.title, count(c.id) chunks from documents d left join chunks c on c.doc_id=d.id group by 1,2"
```

**Clear data:** refreshing the page wipes that page's session automatically; the ✕ buttons delete single documents. Manual full wipe: `docker compose exec db psql -p 5435 -U app -d career -c "truncate documents cascade"`.

**Re-ingest after changing chunking/embedding logic:** delete the document in the UI and upload it again
(old vectors are not rebuilt automatically).

**Run tests / lint:**
```bash
cd backend && pytest -q && ruff check .
```

**Run the golden eval** (needs DB + Ollama embeddings + a working LLM):
```bash
cd backend
set -a && . ../.env && set +a
python -m evals.run                 # add --skip-fit or --only q01,q07
cat evals/results/latest.md
```

**Back up / restore the database:**
```bash
docker compose exec -T db pg_dump -p 5435 -U app career > backup.sql
docker compose exec -T db psql -p 5435 -U app career < backup.sql
```

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| UI shows "API unreachable" | API not running, wrong proxy target | check `curl …/health`; for Vite set `API_URL` to the real API port |
| `Embedding call failed … Is Ollama running and 'nomic-embed-text' pulled?` (HTTP 502 on upload) | Ollama down or model missing | `ollama serve`; `ollama pull nomic-embed-text` |
| `Ollama returned 404 … model 'llama3.1' not found` | Model not pulled, **or** requests are reaching a different Ollama (e.g. an empty container publishing 11434) | `ollama list`; use `OLLAMA_BASE_URL=http://127.0.0.1:11434`; `docker ps` for a stray `ollama` container |
| `Groq returned 404 … model … does not exist` | Stale model name | list models for your key (above) and set `GROQ_MODEL` |
| `Groq returned 401` | Bad/placeholder key | put the real key in `.env` (not `your-key`) and restart |
| `Groq returned 429` / slow answers | Free-tier tokens-per-minute limit | automatic backoff retries up to 4×; wait a minute, use a smaller model, or upgrade the plan |
| `ANTHROPIC_API_KEY is not set` | Provider=anthropic without key | set the key or switch provider |
| Fit analysis "returned invalid output twice" | Model produced malformed JSON | click Re-run; use a larger/hosted model |
| Fit analysis takes minutes | Local CPU model | use `groq`/`anthropic`, or a smaller Ollama model; results are cached after the first run |
| Chat says "couldn't find anything in your uploaded documents" | Off-topic question, or best match < `MIN_SIMILARITY` | rephrase; check documents are uploaded; lower `MIN_SIMILARITY` cautiously |
| Answer misses a resume/job fact after an upgrade | Old documents embedded without the title | delete and re-upload them |
| `port is already allocated` / app opens the wrong service | Another process owns 8000/8080/11434 (IPv4 vs IPv6 can hit different listeners) | change `WEB_PORT`/`API_PORT`; check `netstat -ano \| findstr :PORT`; prefer `127.0.0.1` over `localhost` |
| Upload rejected 422 | Unsupported type, empty/scanned PDF, corrupt file | use PDF (text-based), DOCX, TXT or MD |
| URL import: "LinkedIn/Indeed/Glassdoor doesn't allow automated access" | These sites forbid bots and need a login (LinkedIn answers with status 999) | open the job, copy the description, use **Paste** |
| URL import: "That site blocks automated access" | The site rejects bots (401/403/429/451), e.g. Wikipedia | use **Paste** (copy the job text) |
| URL import: "Couldn't read enough text" | JavaScript-rendered or login-only page | use **Paste** |
| URL import: "address is not allowed" | The link points to a private/internal address (blocked on purpose) | use a public link |
| Interview kit "returned invalid output twice" | Model produced malformed JSON | click Regenerate; use a larger or hosted model |
| Upload rejected 413 | File > `MAX_UPLOAD_MB` | raise the limit or shorten the file |
| API logs `schema init failed` | Postgres not reachable yet / wrong `DATABASE_URL` | `docker compose ps`; check port 5435; API stays up and `/health` still answers |
| `numpy` DLL blocked (Windows) | Application Control policy | run inside Docker, or use a Python location the policy allows |

## 9. Reading the logs

Logs are single-line JSON. Useful events:

| `msg` | Fields | Meaning |
|---|---|---|
| `request` | `request_id, path, status, ms` | one per HTTP request (for streaming endpoints, `ms` is time to first byte) |
| `ingested` | `doc_id, doc_type, chunks, chars` | a document was stored |
| `retrieval` | `candidates, relevant, top_score` | what vector search returned and what cleared the threshold |
| `answered` | `chunks_used, stream_chunks, ms` | a chat answer completed |
| `invalid analysis output` | `attempt, error` | the model returned bad JSON (one retry happens) |
| `groq rate limited, retrying in Ns` | — | 429 backoff in progress |

## 10. Release checklist

1. `cd backend && ruff check . && pytest -q` — green.
2. `cd frontend && npm run build` — succeeds.
3. `python -m evals.run` — review `evals/results/latest.md`; no regressions.
4. `docker compose up --build -d` from a clean clone; upload the sample files; ask one question; run one fit analysis.
5. Confirm `.env` is not tracked (`git status`), no keys in history.
