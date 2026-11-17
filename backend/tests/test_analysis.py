import json

import pytest
from fastapi.testclient import TestClient

from app.analysis import (
    AnalysisError,
    CheckedRequirement,
    Requirement,
    analyse_fit,
    check_requirements,
    compute_score,
    evidence_supported,
)
from app.main import app
from app.routes import analysis as analysis_routes
from app.routes import documents
from app.store import DocumentRecord

RESUME = "SKILLS\nPython, FastAPI, PostgreSQL, AWS, Docker\nEXPERIENCE\nBuilt FastAPI services on AWS ECS"
JOB = "REQUIREMENTS\n- Python\n- Kubernetes\n- PostgreSQL"


def llm_output(*reqs):
    return json.dumps({"requirements": [
        {"requirement": r, "priority": p, "status": s, "evidence": e} for r, p, s, e in reqs]})


class FakeLLM:
    def __init__(self, *outputs):
        self.outputs = list(outputs)
        self.calls = 0

    def stream(self, system, prompt, json_mode=False):
        assert json_mode
        self.calls += 1
        out = self.outputs.pop(0)
        for i in range(0, len(out), 20):  # simulate token chunks
            yield out[i:i + 20]


def checked(priority, status):
    return CheckedRequirement("x", priority, status, "", True)


def test_score_weights_required_double_and_partial_half():
    reqs = [checked("required", "met"), checked("required", "missing"),
            checked("preferred", "partial"), checked("preferred", "met")]
    # earned = 2*1 + 2*0 + 1*0.5 + 1*1 = 3.5 ; total = 6
    assert compute_score(reqs) == 58


def test_score_empty_is_zero():
    assert compute_score([]) == 0


def test_evidence_supported_lenient_but_rejects_fabrication():
    assert evidence_supported("Built FastAPI services on AWS", RESUME)
    assert not evidence_supported("Led Kubernetes migrations at Google", RESUME)
    assert not evidence_supported("", RESUME)


def test_unsupported_claim_is_downgraded_to_missing_unverified():
    items = [Requirement(requirement="Kubernetes", status="met",
                         evidence="Ran Kubernetes clusters at scale"),
             Requirement(requirement="Python", status="met", evidence="Python, FastAPI")]
    out = check_requirements(items, RESUME)
    assert (out[0].status, out[0].verified) == ("missing", False)
    assert (out[1].status, out[1].verified) == ("met", True)


def test_analyse_fit_end_to_end():
    llm = FakeLLM(llm_output(
        ("Python", "required", "met", "Python, FastAPI"),
        ("Kubernetes", "required", "missing", ""),
        ("PostgreSQL", "preferred", "met", "PostgreSQL")))
    r = analyse_fit("job-1", "ML Engineer", JOB, RESUME, llm)
    assert (r.met, r.partial, r.missing) == (2, 0, 1)
    assert r.score == 60  # earned 2 (required Python) + 1 (preferred PG) of 2+2+1 total


def test_retries_once_on_invalid_json_then_succeeds():
    good = llm_output(("Python", "required", "met", "Python"))
    llm = FakeLLM("not json", good)
    r = analyse_fit("j", "t", JOB, RESUME, llm)
    assert llm.calls == 2 and r.score == 100


def test_fails_after_two_invalid_outputs():
    llm = FakeLLM("nope", '{"requirements": []}')
    with pytest.raises(AnalysisError):
        analyse_fit("j", "t", JOB, RESUME, llm)


class FakeStore:
    def __init__(self, with_resume=True):
        self.with_resume = with_resume
        self.cache = {}
        self.job = DocumentRecord("3f2b1c1e-0000-4000-8000-000000000001", "job", "j.txt", "ML Eng", 2)
        self.resume = DocumentRecord("3f2b1c1e-0000-4000-8000-000000000002", "resume", "r.txt", "Jane", 2)

    def list(self, session_id):
        return [self.resume, self.job] if self.with_resume else [self.job]

    def get_analysis(self, job_id, resume_id):
        return self.cache.get((job_id, resume_id))

    def save_analysis(self, job_id, resume_id, result):
        self.cache[(job_id, resume_id)] = result

    def get_text(self, session_id, doc_id):
        if doc_id == self.job.id:
            return self.job, JOB
        if doc_id == self.resume.id and self.with_resume:
            return self.resume, RESUME
        return None


def sse(response):
    return [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]


def call(store, llm, job_id=None, method="post", query=""):
    app.dependency_overrides[documents.get_store] = lambda: store
    app.dependency_overrides[analysis_routes.get_llm] = lambda: llm
    try:
        return getattr(TestClient(app), method)(
            f"/analysis/fit/{job_id or store.job.id}{query}",
            headers={"X-Session-ID": "session-12345"})
    finally:
        app.dependency_overrides.clear()


def test_endpoint_returns_score_and_requirements():
    llm = FakeLLM(llm_output(("Python", "required", "met", "Python")))
    r = call(FakeStore(), llm)
    assert r.status_code == 200
    events = sse(r)
    assert events[-1]["type"] == "result"
    body = events[-1]["result"]
    assert body["score"] == 100 and body["requirements"][0]["verified"] is True


def test_endpoint_404_for_unknown_job():
    r = call(FakeStore(), FakeLLM(), job_id="3f2b1c1e-0000-4000-8000-0000000000ff")
    assert r.status_code == 404


def test_endpoint_409_without_resume():
    assert call(FakeStore(with_resume=False), FakeLLM()).status_code == 409


def test_endpoint_emits_error_event_when_model_keeps_failing():
    events = sse(call(FakeStore(), FakeLLM("x", "y")))
    assert events[-1]["type"] == "error"


def test_progress_events_emitted_for_long_output():
    big = llm_output(*[(f"Skill {i}", "required", "missing", "") for i in range(10)])
    events = sse(call(FakeStore(), FakeLLM(big)))
    assert any(e["type"] == "progress" for e in events)


def test_result_is_cached_and_second_call_skips_the_model():
    store = FakeStore()
    llm = FakeLLM(llm_output(("Python", "required", "met", "Python")))
    first = sse(call(store, llm))
    assert first[-1]["cached"] is False and llm.calls == 1
    second = sse(call(store, llm))  # FakeLLM has no outputs left: a model call would raise
    assert second[-1]["cached"] is True and llm.calls == 1
    assert second[-1]["result"]["score"] == 100


def test_refresh_bypasses_cache():
    store = FakeStore()
    out = llm_output(("Python", "required", "met", "Python"))
    llm = FakeLLM(out, out)
    call(store, llm)
    again = sse(call(store, llm, query="?refresh=true"))
    assert llm.calls == 2 and again[-1]["cached"] is False


def test_get_cached_returns_204_then_result():
    store = FakeStore()
    assert call(store, FakeLLM(), method="get").status_code == 204
    call(store, FakeLLM(llm_output(("Python", "required", "met", "Python"))))
    r = call(store, FakeLLM(), method="get")
    assert r.status_code == 200 and r.json()["score"] == 100


def test_single_letter_language_requirement_is_accepted():
    llm = FakeLLM(llm_output(("R", "preferred", "missing", ""),
                             ("Python", "required", "met", "Python")))
    result = analyse_fit("j", "t", JOB, RESUME, llm)
    assert [r.requirement for r in result.requirements] == ["R", "Python"]
