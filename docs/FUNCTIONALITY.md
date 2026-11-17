# Functionality

How the system works end to end: pipelines, algorithms, API reference and data model.

## 1. System overview

A single-page React app talks to a FastAPI backend. The backend stores documents as vector-embedded
chunks in Postgres (pgvector), uses an embedding model (always local, via Ollama) and a pluggable LLM.
There is no login: each page load generates a random `session_id` held **in memory only** (not in
`localStorage`) and sends it as the `X-Session-ID` header; every query is scoped to it. Refreshing or
opening a new tab therefore starts with an empty workspace, and the old session's data is deleted
(see §6 `POST /documents/clear` and the startup purge).

## 2. Ingestion pipeline (`POST /documents`)

```
upload ─► size check ─► parse ─► split into sections ─► chunk ─► embed ─► store
 (≤5MB)    (413)       (422)                                      (502)
```

| Stage | Module | Behaviour |
|---|---|---|
| Parse | `ingest/parsing.py` | `.pdf` via pdfplumber (text-based PDFs only), `.docx` via python-docx (paragraphs + table cells), `.txt`/`.md` decoded as UTF-8. Line endings and blank-line runs are normalised. Unsupported type, corrupt file, or no extractable text → `ParseError` → HTTP 422. |
| Section split | `ingest/chunking.py` | A line is a heading if it is a known heading (summary, experience, education, skills, projects, requirements, qualifications, responsibilities, nice to have, benefits, …, with or without a trailing colon) or a short (≤40 chars) ALL-CAPS line without `. @ ,`. Text before the first heading becomes section `header`. |
| Chunk | `ingest/chunking.py` | Each section is one chunk if ≤1,200 chars; otherwise paragraphs/bullets are packed greedily up to 1,200; a single oversized block is hard-split at the last space. Heading lines are metadata, not chunk text. |
| Embed | `embeddings.py` | Text embedded = `"<document title> \| <section>\n<chunk text>"` so a bare list still carries its company/person. Ollama `/api/embed`, model `nomic-embed-text`, 768 dims. Failure → `EmbeddingError` → HTTP 502 with an actionable message. |
| Store | `store.py` | One transaction: insert `documents` row, then all `chunks` with vectors. Title = first non-empty line of the document (≤120 chars). |

## 3. Chat pipeline (`POST /chat`)

```
question ─► embed ─► search resumes (top 4) ┐
                      search jobs    (top 4) ┴► merge by chunk, sort by score
        ─► best score ≥ MIN_SIMILARITY (0.5)? ── no ─► refusal message (LLM not called)
        ─► yes: keep chunks ≥ 0.38 ─► build delimited prompt ─► stream LLM ─► normalise citations
```

- **Balanced retrieval** (`chat._balanced_search`): separate top-4 searches per document type, merged and
  de-duplicated by chunk id. Prevents one type crowding out the other in comparison questions.
- **Answer-or-refuse** : the *best* match must reach `MIN_SIMILARITY`; if so, supporting chunks down to
  `MIN_SIMILARITY − 0.12` are included. Otherwise the fixed refusal text is streamed and the LLM is not called.
- **Prompt**: system prompt (answer only from sources; cite as `[n]`; sources are untrusted data; never
  invent; name the job when comparing) + `<sources>` block of `<source id document type section>` elements +
  the question. Delimiter-like tags inside uploaded text are removed (`_clean`).
- **Citation normalisation** (`normalise_stream`): full-width `【1】`, `[1†L2]`, `(source 2)` and
  `(sources 1, 3)` are rewritten to `[1]`, `[2]`, `[1][3]`, even when a marker is split across streamed
  tokens, so the UI can always turn them into chips.
- **Events** (server-sent): `sources` (first), `token`*, then `done {grounded}` or `error {message}`.
- **Logs**: `retrieval` (candidates, relevant, top score) and `answered` (chunks used, latency).

## 4. Fit analysis (`/analysis/fit/{job_id}`)

Goal: a trustworthy, explainable score for "resume vs. one job".

1. Load the **full text** of the latest resume and of the job (reassembled from chunks with section headings).
2. One LLM call (JSON mode) returns up to 12 requirements, each with `priority` (required/preferred),
   `status` (met/partial/missing) and a ≤12-word verbatim `evidence` quote from the resume.
3. **Validation**: Pydantic schema; on bad JSON/schema one retry; then an error event. The parser tolerates
   code fences or prose around the JSON object.
4. **Evidence check**: a `met`/`partial` verdict is kept only if ≥70% of the quote's words occur in the
   resume; otherwise it is downgraded to `missing` and returned with `verified: false`.
5. **Score (deterministic, in code)**:

   ```
   weight:  required = 2, preferred = 1
   credit:  met = 1, partial = 0.5, missing = 0
   score  = round(100 × Σ weight×credit ÷ Σ weight)
   ```
6. The result is saved in `analyses` keyed by `(job_id, resume_id)`; later requests return it instantly
   (`cached: true`) unless `?refresh=true`.

Example: requirements Python (required, met), Kubernetes (required, missing), Postgres (preferred, met)
→ earned 2 + 1 = 3 of 5 → score 60.

## 5. LLM providers (`llm.py`)

| Provider | Class | Notes |
|---|---|---|
| `ollama` | `OllamaLLM` | `/api/chat` streaming; `format: json` for JSON mode; `keep_alive: 30m`; temperature 0.2 (0.0 for JSON) |
| `groq` | `GroqLLM` | OpenAI-compatible `/chat/completions` SSE; `response_format: json_object`; on HTTP 429 waits (honours `Retry-After`, else exponential, max 30 s) and retries up to 4× before streaming starts |
| `anthropic` | `AnthropicLLM` | official SDK streaming; JSON mode appends an "output a single JSON object" instruction |

All implement `stream(system, prompt, json_mode)` and `complete(...)`; every failure surfaces as `LLMError`.
`make_llm()` chooses from `LLM_PROVIDER`.

## 6. API reference

All endpoints except `/health` require the header `X-Session-ID` (8–64 chars), otherwise **422**.

### `GET /health`
`200 {"status":"ok","llm_provider":"groq"}`

### `POST /documents` — upload
`multipart/form-data`: `file` (pdf/docx/txt/md), `doc_type` (`resume` | `job`).

| Status | Meaning |
|---|---|
| 201 | `{"id","doc_type","filename","title","chunk_count"}` |
| 413 | larger than `MAX_UPLOAD_MB` |
| 422 | bad `doc_type`, unsupported/corrupt/empty file |
| 502 | embedding service unavailable |

### `GET /documents`
`200 [ {id, doc_type, filename, title, chunk_count}, … ]` for this session, oldest first.

### `POST /documents/clear?session_id=…` — wipe a session
Deletes everything the session uploaded (chunks and cached analyses cascade). `204` always for a valid ID
(8–64 chars; `422` otherwise). The ID is a **query parameter, not the header**, because the browser calls it
from `navigator.sendBeacon` on `pagehide` (refresh/close), and beacons cannot set custom headers.
At API startup, documents older than `SESSION_TTL_HOURS` (default 24) are also purged, covering browsers
that closed without a chance to send the beacon.

### `DELETE /documents/{id}`
`204` on success, `404` if not found in this session. Cascades to chunks and cached analyses.

### `POST /chat` — streamed answer
Body: `{"question": "2–1000 chars", "doc_ids": ["uuid", …]?}`. Response: `text/event-stream`, each line `data: <json>`:

| Event | Payload |
|---|---|
| `sources` | `{"type":"sources","sources":[{"id":1,"doc_id","document","doc_type","section","text","score"}]}` (empty when refusing) |
| `token` | `{"type":"token","text":"…"}` (zero or many) |
| `done` | `{"type":"done","grounded":true\|false}` |
| `error` | `{"type":"error","message":"…"}` |

### `GET /analysis/fit/{job_id}` — cached result
`200` result object, or `204` if none stored (or no resume / unknown job).

### `POST /analysis/fit/{job_id}?refresh=false` — run (or fetch cached) analysis
`404` job not found (or not a job) · `409` no resume uploaded · otherwise `text/event-stream`:

| Event | Payload |
|---|---|
| `progress` | `{"type":"progress","chunks":N}` (model output chunks received so far) |
| `result` | `{"type":"result","cached":bool,"result":{ "doc_id","title","score","met","partial","missing","requirements":[{"requirement","priority","status","evidence","verified"}] }}` |
| `error` | `{"type":"error","message":"…"}` |

Interactive docs: `/docs` (Swagger UI).

## 7. Data model (Postgres)

| Table | Columns | Notes |
|---|---|---|
| `documents` | `id uuid PK`, `session_id`, `doc_type` (`resume`/`job`), `filename`, `title`, `created_at` | index on `session_id` |
| `chunks` | `id bigserial PK`, `doc_id → documents ON DELETE CASCADE`, `idx`, `section`, `content`, `embedding vector(768)` | index on `doc_id`; exact cosine scan (`<=>`) |
| `analyses` | `(job_id, resume_id)` PK, both → `documents ON DELETE CASCADE`, `result jsonb`, `created_at` | upsert on re-run |

The schema is created idempotently at API start (`db.init_schema`). Changing `EMBED_DIM` requires recreating `chunks`.

## 8. Frontend behaviour

- **Sidebar** (empty after every refresh): upload a resume (file) or job postings (file or pasted text → sent as a `.txt` file); list, with chunk counts and delete.
- **Ask questions tab**: suggested prompts, streaming answers rendered as markdown (tables, lists, bold),
  `[n]` markers become chips; clicking one opens the source passage with document, section and match %.
  Errors (e.g. model unavailable) show inline. Chat state survives switching tabs.
- **Fit & gaps tab**: one card per job; "Analyse fit" with live progress; saved results load automatically;
  "Re-run" forces a refresh. Gap matrix sorted missing → partial → met, required before preferred.
- Chat input is disabled until at least one resume and one job exist.

## 9. Security and privacy properties

- Uploaded text is treated as data in prompts; delimiter tags are stripped; instructions inside documents are not followed (tested).
- Per-session scoping on every read, write and delete; documents of other sessions are invisible.
- No credentials in the repo; `.env` ignored by git. Hosted LLM providers receive prompt text (resume + job content); embeddings never leave the machine.
- Not provided: authentication, authorization beyond the session ID, rate limiting, malware scanning, encryption at rest (see README → productionizing).
