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

### `POST /documents/from-url` — import a job posting by link
Body: `{"url": "https://…", "doc_type": "job" | "resume"}` (default `job`). Fetches, extracts and ingests the page
(see §10). `201` same payload as upload · `422` with a user-presentable reason (blocked address, bad scheme,
unreachable, blocked by site, JS-only/too little text, too large, timeout) · `502` embedding unavailable.

### `GET /analysis/improve/{job_id}` and `POST /analysis/improve/{job_id}?refresh=false` — resume suggestions
Same behaviour as the interview endpoints (204/200 for GET; `404` job, `409` no resume, SSE `progress`/`result`/`error` for POST,
cached per job + resume). `result.result` is:

```json
{ "doc_id": "…", "title": "…", "summary": "…",
  "suggestions": [{
    "category": "rewrite|quantify|keywords|structure|gap|advice", "priority": "high|medium|low",
    "title": "…", "issue": "…", "original": "…", "original_verified": true, "suggestion": "…",
    "needs_input": ["…"],
    "warnings": {"original_missing": false, "new_numbers": [], "added_terms": [], "unsupported_claims": []} }] }
```

### `GET /analysis/interview/{job_id}` — cached interview kit
`200` kit object, or `204` if none stored (or no resume / unknown job).

### `POST /analysis/interview/{job_id}?refresh=false` — generate (or fetch cached) interview kit
`404` job not found · `409` no resume uploaded · otherwise `text/event-stream` with the same `progress` / `result` / `error`
events as fit analysis. `result.result` is:

```json
{ "doc_id": "…", "title": "…",
  "technical":  [{"question","why","talking_points":[…],"resume_evidence","evidence_verified"}],
  "gaps":       [{"question","gap","how_to_answer"}],
  "behavioral": [{"question","star_hint","resume_evidence","evidence_verified"}],
  "ask_them":   ["…"] }
```

Interactive docs: `/docs` (Swagger UI).

## 7. Data model (Postgres)

| Table | Columns | Notes |
|---|---|---|
| `documents` | `id uuid PK`, `session_id`, `doc_type` (`resume`/`job`), `filename`, `title`, `created_at` | index on `session_id` |
| `chunks` | `id bigserial PK`, `doc_id → documents ON DELETE CASCADE`, `idx`, `section`, `content`, `embedding vector(768)` | index on `doc_id`; exact cosine scan (`<=>`) |
| `analyses` | `(job_id, resume_id)` PK, both → `documents ON DELETE CASCADE`, `result jsonb`, `created_at` | fit-analysis cache; upsert on re-run |
| `interview_kits` | same shape as `analyses` | interview-kit cache; upsert on regenerate |
| `resume_suggestions` | same shape as `analyses` | resume-suggestion cache; upsert on regenerate |

The schema is created idempotently at API start (`db.init_schema`). Changing `EMBED_DIM` requires recreating `chunks`.

## 8. Frontend behaviour

- **Sidebar** (empty after every refresh): upload a resume (file) or job postings (file or pasted text → sent as a `.txt` file); list, with chunk counts and delete.
- **Ask questions tab**: suggested prompts, streaming answers rendered as markdown (tables, lists, bold),
  `[n]` markers become chips; clicking one opens the source passage with document, section and match %.
  Errors (e.g. model unavailable) show inline. Chat state survives switching tabs.
- **Fit & gaps tab**: one card per job; "Analyse fit" with live progress; saved results load automatically;
  "Re-run" forces a refresh. Gap matrix sorted missing → partial → met, required before preferred.
- **Interview prep tab**: per-job "Generate prep kit" with live progress; four colour-coded sections (technical, gap,
  behavioural/STAR, questions to ask); resume quotes shown as evidence; "Copy as text"; saved kits load automatically.
- **Sidebar job inputs**: Upload file · **Link** (import a posting by URL) · Paste.
- Chat input is disabled until at least one resume and one job exist.

## 9. Security and privacy properties

- **URL import is an SSRF surface and is hardened** (see §10): private/loopback/metadata addresses blocked, redirects re-validated, size and time limits.
- Uploaded text (including text fetched from a URL) is treated as data in prompts; delimiter tags are stripped; instructions inside documents are not followed (tested).
- Per-session scoping on every read, write and delete; documents of other sessions are invisible.
- No credentials in the repo; `.env` ignored by git. Hosted LLM providers receive prompt text (resume + job content); embeddings never leave the machine.
- Not provided: authentication, authorization beyond the session ID, rate limiting, malware scanning, encryption at rest (see README → productionizing).

## 10. URL import and interview prep internals

**URL import (`ingest/fetch.py`)**

```
url ─► validate (scheme, credentials, port, DNS → all addresses must be public)
    ─► GET (10 s timeout, no auto-redirect) ─► redirect? re-validate the new URL (max 3 hops)
    ─► status/content-type/size checks (HTML or plain text, ≤2 MB)
    ─► trafilatura → markdown text + title ─► ≥200 chars? else "paste the text instead"
    ─► shared ingestion: chunk → embed (title prepended) → store
```

Extracted pages arrive as markdown (`## Requirements`, `- bullets`); the chunker's heading detection strips
markdown markers, so web pages split into the same sections as uploaded files. File upload and URL import share
one `_ingest` function.

**Interview prep (`interview.py`)** reuses `analysis.stream_structured` — the one place that streams a JSON-mode LLM
call, reports progress, validates against a Pydantic model and retries once. Fit analysis and interview prep both use it.
After validation, `build_kit` caps list sizes and verifies each `resume_evidence` quote against the resume
(≥70% word overlap), dropping unsupported quotes and flagging `evidence_verified: false`.

**Resume suggestions (`suggestions.py`)** also reuse `stream_structured`. After validation, `build_result` sorts by priority,
caps at 8, and runs the truthfulness checks described in FEATURES §16 (`new_numbers`, `added_terms`, `unsupported_claims`,
original-line verification) on the *rewrite* and *quantify* categories, whose text is proposed resume wording. The three
per-job endpoints (fit, interview, improve) share two route helpers, `_cached` and `_stream`, in `routes/analysis.py`.
