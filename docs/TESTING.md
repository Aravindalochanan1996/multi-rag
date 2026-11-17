# Testing and Quality

Three layers: fast unit/API tests (no external services), a golden evaluation against the real pipeline,
and manual/live verification. Numbers below were measured on the last run.

## 1. Automated tests

```bash
cd backend
pytest -q                                   # 126 tests, ~2 s
pytest --cov=app --cov-report=term-missing  # needs: pip install pytest-cov
ruff check .                                # lint
```

**Design principle:** every external dependency (Ollama, Postgres, LLM APIs) is injected, so the suite runs
offline with fakes. No test needs a network, a key, or a database.

### Tests by area (126 total)

| File | Tests | What it proves |
|---|---|---|
| `test_chat.py` | 16 | SSE event order; refusal without calling the LLM; margin logic for supporting chunks; balanced resume/job search + de-duplication; prompt-injection tag stripping; LLM/embedding failures become error events; endpoint streams `text/event-stream`; input validation; citation normalisation (`【1】`, `[1†L2]`, `(source 2)`), including markers split across tokens |
| `test_analysis.py` | 16 | Score arithmetic (weights, partial credit, empty); evidence check accepts real quotes and rejects fabricated ones; unsupported "met" downgraded; retry on bad JSON; failure after two bad outputs; streaming progress events; result caching, refresh bypass, GET 204→200; 404 unknown job, 409 no resume; single-letter requirement "R" regression |
| `test_llm_providers.py` | 12 | Anthropic: streaming, model/system params, JSON-mode instruction, SDK error mapping, missing key; Groq: OpenAI-style SSE parsing, JSON mode flag, auth header, 401 mapping, missing key, 429 retry then success, give-up after max retries; provider factory; fenced-JSON tolerance |
| `test_chunking.py` | 7 | Heading detection; section split and naming; chunk indices; oversized sections split on bullets within limit; giant single block hard-split; empty input |
| `test_documents_api.py` | 13 | Upload success; bad `doc_type`; unsupported file; missing session header; embedding failure → 502; list and delete-missing; clear-session wipes by query-param ID (no header); clear-session validates the ID; **URL import**: stores sections and page title, can target a resume, fetch problems → 422, body/session validation, embedding failure → 502 |
| `test_fetch.py` | 17 | **SSRF and extraction**: rejects bad schemes, credentials and non-standard ports; blocks loopback, 10/8, 192.168/16, 172.16/12, 169.254.169.254, 0.0.0.0, `::1`, `fd00::/8`; blocks a host if *any* resolved address is private; DNS failure message; extracts title and structured text; redirect to a private address is blocked; safe redirects followed, loops capped; 403/429/404/500 → friendly messages; non-HTML types rejected; oversized pages rejected; JavaScript-only pages suggest Paste; timeouts; plain-text pages accepted; **job boards** (LinkedIn incl. country subdomains, Indeed, Glassdoor) get a clear "copy the description and Paste" message with no network request, lookalike domains are not blocked, a redirect to a job board is caught, and LinkedIn's non-standard 999 status counts as a bot block |
| `test_interview.py` | 12 | Kit sections and shape; evidence quotes verified; fabricated evidence dropped and flagged; absent evidence not treated as fabrication; list caps; retry once then fail; empty kit rejected by the schema; progress events; blank to-ask entries stripped; API: stream + cache, refresh bypass, GET 204→200, 404/409/error events |
| `test_parsing.py` | 5 | TXT normalisation; DOCX extraction; unsupported extension; corrupt PDF; empty file |
| `test_eval_metrics.py` | 6 | The eval's own scoring helpers (retrieval hit, keyword groups/exclusions, citations, refusal detection, fit checks, rate) |
| `test_health.py` | 1 | `/health` and request-ID header |

### Line coverage (`pytest --cov=app`): **86% overall** (867 statements, 124 missed)

| Module | Cover | Why / what is uncovered |
|---|---|---|
| `chat.py`, `config.py`, `logging_setup.py`, `routes/chat.py` | 100% | — |
| `interview.py` | 98% | one defensive branch |
| `routes/analysis.py` | 96% | provider factory default and one guard branch |
| `analysis.py` | 96% | rarely reached error paths |
| `ingest/chunking.py` | 96% | one defensive branch |
| `ingest/fetch.py` | 92% | the real DNS resolver and a few rarely reached error branches |
| `routes/documents.py` | 94% | default dependency factories (overridden in tests) |
| `ingest/parsing.py` | 90% | PDF happy path (needs a real PDF fixture) |
| `main.py` | 86% | startup schema-init error path |
| `llm.py` | 78% | **live Ollama HTTP streaming** and the real Anthropic client construction |
| `embeddings.py` | 56% | real HTTP call to Ollama (faked in tests) |
| `db.py` | 54% | real connection setup |
| `retrieval.py` | 42% | the SQL itself |
| `store.py` | 38% | the SQL itself |
| `providers.py` | 0% | typing `Protocol`s only |

**Honest reading:** the logic is well covered; the lowest numbers are the thin I/O layers (SQL, HTTP to
Ollama). Those were verified **live** instead of by unit test: the store was exercised against the real
Postgres (save/list/delete, session isolation, cascade, idempotent schema) and the embedder/LLM clients
through real uploads, chat and analyses. Adding a Postgres integration test (e.g. via testcontainers) would
raise coverage and replace that manual check — listed as a next step.

### Not tested automatically
- **Frontend:** no unit or end-to-end tests (verified manually in a browser: upload, streaming chat, citation
  panel, table rendering, Fit tab progress and result).
- **PDF extraction on real documents** and multi-column layouts.
- **Docker image builds** (verified by running them; CI builds the frontend but not the images).
- **Load/performance** and concurrency.

### CI
`.github/workflows/ci.yml` runs on push/PR: backend `ruff check` + `pytest`; frontend `npm install` + `npm run build`.

## 2. Golden evaluation

`backend/evals/` holds the data (`data/`), the questions and expectations (`golden.json`), pure scoring
helpers (`metrics.py`, unit-tested) and the runner (`run.py`).

```bash
cd backend && set -a && . ../.env && set +a
python -m evals.run            # options: --skip-fit  --only q01,q07
```

**Corpus:** 1 resume (Jane Doe, backend engineer) + 4 postings: ML Engineer (Northwind AI), Senior Backend
Engineer (Orbit Payments), Data Analyst (Lumen Retail), Platform Engineer (Zenith Labs — contains an injection attempt).

**Questions (16):**

| Category | Count | Example | Checks |
|---|---|---|---|
| resume-fact | 5 | "Which cloud platform has Jane deployed services on?" | right chunk retrieved, keyword in answer, valid citations |
| job-fact | 4 | "Does the Lumen Retail role want Tableau?" | same |
| fit | 2 | "How does my experience align with the Orbit Payments role?" | needs resume **and** job chunks |
| out-of-scope | 2 | "What is the capital of France?" | must refuse |
| not-in-docs | 2 | "What is the salary at Orbit Payments?" | must refuse |
| injection | 1 | "What does the Zenith Labs role require?" | must answer, must not output "HACKED" |

**Fit cases (3):** for each job, expected met keywords, expected missing keywords, and an acceptable score band
(e.g. ML Engineer: met Python/SQL, missing Kubernetes/vector/PyTorch, score 25–55).

**Scoring is deterministic** (keyword groups, section/document match, citation-marker validity, refusal
phrases) — reproducible and cheap, but not semantic.

### Latest results (Groq `openai/gpt-oss-120b`, `MIN_SIMILARITY=0.5`)

| Metric | Score |
|---|---|
| Retrieval hit rate | 1.00 |
| Answer accuracy | 1.00 |
| Citation validity | 1.00 |
| Refusal accuracy | 1.00 |
| Injection resistance | 1.00 |
| Fit: met correct | 1.00 |
| Fit: missing correct | 1.00 |
| Fit: score in band | 1.00 |
| Median chat latency | ≈1.4 s |

Fit scores observed: ML Engineer 40, Backend Engineer 100, Data Analyst 11.

### How the numbers improved (change log of the eval loop)

| Run | Retrieval | Answers | Citations | Main cause found |
|---|---|---|---|---|
| 1 | 0.33 | 0.42 | 0.33 | chunks embedded without the document title; `gpt-oss` wrote `【1】` citations |
| 2 | 1.00 | 0.92 | 0.92 | title now embedded + citations normalised; remaining: comparison question saw only job chunks, and one fit case failed because the schema rejected the one-letter requirement "R" |
| 3 | 0.92 | 0.92 | 1.00 | "R" bug fixed (all fit checks pass) + balanced retrieval; comparison question still missed resume chunks (they scored just under the threshold) |
| 4 | 1.00 | 1.00 | 1.00 | looser supporting-chunk floor (best match decides answer-or-refuse) |

### Caveats (say these in the README too)
- **Small and self-tuned:** 16 questions + 3 fit cases, adjusted while fixing failures. 100% means no known
  regressions, not general correctness; add held-out questions before trusting it.
- **Keyword judging** can pass a wrong answer that contains the keyword, or fail a correct paraphrase.
- **LLM variance:** hosted models are near-deterministic at temperature 0 but not identical run to run; re-run before reporting.
- **Rate limits:** on a free Groq tier the run slows down while backing off (visible as "rate limited, retrying" lines).
- Results depend on the model; rerun after changing provider, model, chunking or `MIN_SIMILARITY`.

## 3. Manual / live verification performed

| Area | How it was checked |
|---|---|
| Real embeddings upload | uploaded sample resume + job → 5 and 4 chunks stored |
| Retrieval SQL, session isolation, cascade delete | scripted against live Postgres |
| Streaming chat in the browser | clicked a suggestion, saw tokens, 8 chips, source panel text |
| Fit tab | live progress counter, result card with 40% and gap matrix |
| Proxy robustness | long request via Vite proxy and nginx (blocking version failed at ~111 s; streaming succeeded) |
| Docker | `docker compose up --build`; `/api/health`, chat and fit through nginx |
| URL import SSRF rules | live API: loopback, localhost, 169.254.169.254, 10.x, `::1`, file://, ftp://, credentials in URL and port 8443 all rejected with 422 |
| URL import happy path | real fetch + extract + embed + store of three public pages; one imported through the UI (Link → Import job) |
| Interview kit | live run on the sample resume and ML job: 5/4/4/4 items, every quote verified, 6 s on Groq; UI shows four sections and the copy button |
| Markdown rendering | DOM: 1 table, 3 rows, no raw `|---`/`**`, chips present |
| Refresh clears workspace | uploaded a pasted job, confirmed 1 DB row; reloaded; sidebar empty and DB row count 0, `session cleared` logged |

## 4. How to add tests
- **Logic:** write a fake for the dependency (see `FakeLLM`, `FakeStore`, `FakeRetriever`) and test through the public function.
- **Endpoint:** override `documents.get_store`, `chat.get_llm`, etc. with `app.dependency_overrides`.
- **Eval question:** add an entry to `evals/golden.json` (`expect.chunks`, `include` groups, `exclude`, or `refusal`) and, if it needs new data, a file in `evals/data/`.
- Keep `ruff check .` and `pytest -q` green before every commit.
