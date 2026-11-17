"""Golden eval runner.  Usage (from backend/, with Postgres + embeddings + LLM available):

    python -m evals.run [--skip-fit] [--only q01,q07]

Ingests the eval documents into a throwaway session, asks every golden question through the
real pipeline (retrieve -> guard -> prompt -> LLM), scores the answers, then deletes the data.
Writes evals/results/latest.json and latest.md.
"""
import argparse
import json
import time
import uuid
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from app.analysis import AnalysisError, analyse_fit
from app.chat import answer
from app.config import settings
from app.embeddings import OllamaEmbedder
from app.ingest.chunking import chunk_text, embedding_text
from app.ingest.parsing import parse_document
from app.llm import make_llm
from app.retrieval import PgRetriever
from app.store import PgDocumentStore

from . import metrics as m

HERE = Path(__file__).parent


def ingest(golden: dict, session: str, store, embedder) -> dict[str, str]:
    ids = {}
    for doc in golden["documents"]:
        text = parse_document(doc["file"], (HERE / "data" / doc["file"]).read_bytes())
        chunks = chunk_text(text)
        title = text.split("\n")[0]
        vectors = embedder.embed([embedding_text(title, c) for c in chunks])
        record = store.save(session, doc["type"], doc["file"], title, chunks, vectors)
        ids[doc["key"]] = record.id
    return ids


def run_question(q: dict, session: str, key_by_id: dict[str, str], embedder, retriever, llm) -> dict:
    expect = q["expect"]
    started = time.perf_counter()
    events = list(answer(q["question"], session, None, embedder=embedder, retriever=retriever,
                         llm=llm, min_similarity=settings.min_similarity))
    ms = round((time.perf_counter() - started) * 1000)
    text = "".join(e["text"] for e in events if e["type"] == "token")
    error = next((e["message"] for e in events if e["type"] == "error"), None)
    sources = next((e["sources"] for e in events if e["type"] == "sources"), [])
    grounded = any(e["type"] == "done" and e.get("grounded") for e in events)

    result = {"id": q["id"], "category": q["category"], "question": q["question"],
              "answer": text, "error": error, "ms": ms, "n_sources": len(sources), "checks": {}}
    if error:
        result["checks"]["no_error"] = False
        return result
    if expect.get("refusal"):
        result["checks"]["refused"] = m.is_refusal(text, grounded)
        return result
    if "chunks" in expect:
        result["checks"]["retrieval"] = m.retrieval_hit(sources, expect["chunks"], key_by_id)
    result["checks"]["answer"] = m.keywords_ok(text, expect.get("include", []), expect.get("exclude", []))
    result["checks"]["citations"] = grounded and m.citations_valid(text, len(sources))
    return result


def run_fit(spec: dict, session: str, ids: dict[str, str], store, llm) -> dict:
    job_rec, job_text = store.get_text(session, ids[spec["job"]])
    _, resume_text = store.get_text(session, ids["resume"])
    started = time.perf_counter()
    try:
        res = asdict(analyse_fit(job_rec.id, job_rec.title, job_text, resume_text, llm))
    except AnalysisError as exc:
        return {"job": spec["job"], "error": str(exc), "checks": {"no_error": False}}
    return {"job": spec["job"], "score": res["score"], "ms": round((time.perf_counter() - started) * 1000),
            "checks": m.fit_checks(res, spec),
            "requirements": [(r["requirement"], r["status"], r["verified"]) for r in res["requirements"]]}


def summarise(questions: list[dict], fits: list[dict]) -> dict:
    def collect(name: str, items=questions, cats: set[str] | None = None) -> list[bool]:
        return [i["checks"][name] for i in items
                if name in i["checks"] and (cats is None or i.get("category") in cats)]

    return {
        "retrieval_hit_rate": m.rate(collect("retrieval")),
        "answer_accuracy": m.rate(collect("answer")),
        "citation_validity": m.rate(collect("citations")),
        "refusal_accuracy": m.rate(collect("refused")),
        "injection_resistance": m.rate(collect("answer", cats={"injection"})),
        "fit_met_correct": m.rate([f["checks"].get("met", False) for f in fits]),
        "fit_missing_correct": m.rate([f["checks"].get("missing", False) for f in fits]),
        "fit_score_in_band": m.rate([f["checks"].get("score", False) for f in fits]),
        "median_chat_ms": sorted(q["ms"] for q in questions)[len(questions) // 2] if questions else None,
    }


def write_report(meta: dict, summary: dict, questions: list[dict], fits: list[dict]) -> None:
    out = HERE / "results"
    out.mkdir(exist_ok=True)
    (out / "latest.json").write_text(json.dumps(
        {"meta": meta, "summary": summary, "questions": questions, "fit": fits}, indent=2), encoding="utf-8")
    lines = [f"# Eval results ({meta['when']})", "",
             f"Provider: `{meta['provider']}` / model `{meta['model']}` / min_similarity {meta['min_similarity']}", "",
             "| Metric | Score |", "|---|---|"]
    lines += [f"| {k} | {v} |" for k, v in summary.items()]
    lines += ["", "## Failures", ""]
    for q in questions:
        bad = [k for k, v in q["checks"].items() if not v]
        if bad:
            lines.append(f"- **{q['id']}** ({q['category']}) failed {bad}: {q['question']}\n  > {q['answer'][:300]!r}")
    for f in fits:
        bad = [k for k, v in f["checks"].items() if not v]
        if bad:
            lines.append(f"- **fit/{f['job']}** failed {bad} (score {f.get('score')})")
    (out / "latest.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip-fit", action="store_true")
    ap.add_argument("--only", help="comma-separated question ids")
    args = ap.parse_args()

    golden = json.loads((HERE / "golden.json").read_text(encoding="utf-8"))
    embedder, retriever, store, llm = OllamaEmbedder(), PgRetriever(), PgDocumentStore(), make_llm()
    session = f"eval-{uuid.uuid4().hex[:12]}"
    ids = ingest(golden, session, store, embedder)
    key_by_id = {v: k for k, v in ids.items()}
    try:
        wanted = set(args.only.split(",")) if args.only else None
        questions = []
        for q in golden["questions"]:
            if wanted and q["id"] not in wanted:
                continue
            r = run_question(q, session, key_by_id, embedder, retriever, llm)
            questions.append(r)
            flags = " ".join(f"{k}={'ok' if v else 'FAIL'}" for k, v in r["checks"].items())
            print(f"{q['id']} [{q['category']}] {flags}  ({r['ms']} ms)", flush=True)
        fits = []
        if not args.skip_fit:
            for spec in golden["fit"]:
                f = run_fit(spec, session, ids, store, llm)
                fits.append(f)
                flags = " ".join(f"{k}={'ok' if v else 'FAIL'}" for k, v in f["checks"].items())
                print(f"fit/{spec['job']} score={f.get('score')} {flags}", flush=True)
    finally:
        for doc_id in ids.values():
            store.delete(session, doc_id)

    summary = summarise(questions, fits)
    meta = {"when": datetime.now().strftime("%Y-%m-%d %H:%M"), "provider": settings.llm_provider,
            "model": {"groq": settings.groq_model, "anthropic": settings.anthropic_model}.get(
                settings.llm_provider, settings.llm_model),
            "min_similarity": settings.min_similarity, "n_questions": len(questions)}
    write_report(meta, summary, questions, fits)
    print("\n" + json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
