import json

import pytest
from fastapi.testclient import TestClient

from app.analysis import AnalysisError
from app.interview import KitOutput, build_kit, interview_events
from app.main import app
from app.routes import analysis as analysis_routes
from app.routes import documents
from app.store import DocumentRecord

RESUME = "SKILLS\nPython, FastAPI, PostgreSQL, AWS\nEXPERIENCE\nBuilt FastAPI services on AWS ECS"
JOB = "REQUIREMENTS\n- Python\n- Kubernetes"


def kit_json(**overrides):
    base = {
        "technical": [{"question": "How have you used Python in production?", "why": "core skill",
                       "talking_points": ["APIs", "scale"],
                       "resume_evidence": "Built FastAPI services on AWS ECS"}],
        "gaps": [{"question": "Have you used Kubernetes?", "gap": "Kubernetes",
                  "how_to_answer": "Be honest; mention ECS and a learning plan"}],
        "behavioral": [{"question": "Tell me about a hard deadline.", "star_hint": "Use the ECS migration",
                        "resume_evidence": "Built FastAPI services"}],
        "ask_them": ["What does on-call look like?"],
    }
    return json.dumps({**base, **overrides})


class FakeLLM:
    def __init__(self, *outputs):
        self.outputs, self.calls = list(outputs), 0

    def stream(self, system, prompt, json_mode=False):
        assert json_mode
        self.calls += 1
        out = self.outputs.pop(0)
        for i in range(0, len(out), 25):
            yield out[i:i + 25]


def run_events(llm):
    return list(interview_events("job-1", "ML Engineer", JOB, RESUME, llm))


def test_kit_is_built_with_all_sections_and_verified_evidence():
    kind, kit = run_events(FakeLLM(kit_json()))[-1]
    assert kind == "result"
    assert kit["title"] == "ML Engineer" and len(kit["technical"]) == 1 and len(kit["gaps"]) == 1
    assert kit["technical"][0]["evidence_verified"] is True
    assert kit["technical"][0]["resume_evidence"] == "Built FastAPI services on AWS ECS"
    assert kit["ask_them"] == ["What does on-call look like?"]


def test_fabricated_evidence_is_dropped_and_flagged():
    bad = kit_json(technical=[{"question": "Kubernetes experience?", "why": "", "talking_points": [],
                               "resume_evidence": "Ran Kubernetes clusters at Google for 8 years"}])
    _, kit = run_events(FakeLLM(bad))[-1]
    item = kit["technical"][0]
    assert item["resume_evidence"] == "" and item["evidence_verified"] is False


def test_missing_evidence_is_not_treated_as_fabrication():
    ok = kit_json(technical=[{"question": "Explain REST?", "resume_evidence": ""}])
    _, kit = run_events(FakeLLM(ok))[-1]
    assert kit["technical"][0]["evidence_verified"] is True


def test_lists_are_capped():
    many = kit_json(technical=[{"question": f"Technical question {i}?"} for i in range(9)],
                    ask_them=[f"Question {i}?" for i in range(9)])
    _, kit = run_events(FakeLLM(many))[-1]
    assert len(kit["technical"]) == 5 and len(kit["ask_them"]) == 4


def test_retries_once_then_fails_on_invalid_output():
    assert run_events(FakeLLM("garbage", kit_json()))[-1][0] == "result"
    with pytest.raises(AnalysisError, match="twice"):
        run_events(FakeLLM("nope", json.dumps({"technical": [], "gaps": [], "behavioral": []})))


def test_empty_kit_is_rejected_by_schema():
    with pytest.raises(ValueError):
        KitOutput.model_validate({"technical": [], "gaps": [], "behavioral": [], "ask_them": ["x"]})


def test_progress_events_for_long_outputs():
    assert any(k == "progress" for k, _ in run_events(FakeLLM(kit_json())))


def test_build_kit_strips_blank_questions_to_ask():
    out = KitOutput.model_validate(json.loads(kit_json(ask_them=["  ", "Real question?"])))
    assert build_kit("j", "t", out, RESUME).ask_them == ["Real question?"]


# ---- API ---------------------------------------------------------------------------------

class FakeStore:
    def __init__(self, with_resume=True):
        self.with_resume, self.cache = with_resume, {}
        self.job = DocumentRecord("3f2b1c1e-0000-4000-8000-000000000001", "job", "j.txt", "ML Eng", 2)
        self.resume = DocumentRecord("3f2b1c1e-0000-4000-8000-000000000002", "resume", "r.txt", "Jane", 2)

    def list(self, session_id):
        return [self.resume, self.job] if self.with_resume else [self.job]

    def get_text(self, session_id, doc_id):
        if doc_id == self.job.id:
            return self.job, JOB
        if doc_id == self.resume.id and self.with_resume:
            return self.resume, RESUME
        return None

    def get_interview(self, job_id, resume_id):
        return self.cache.get((job_id, resume_id))

    def save_interview(self, job_id, resume_id, result):
        self.cache[(job_id, resume_id)] = result


def call(store, llm, method="post", query="", job_id=None):
    app.dependency_overrides[documents.get_store] = lambda: store
    app.dependency_overrides[analysis_routes.get_llm] = lambda: llm
    try:
        return getattr(TestClient(app), method)(
            f"/analysis/interview/{job_id or store.job.id}{query}",
            headers={"X-Session-ID": "session-12345"})
    finally:
        app.dependency_overrides.clear()


def sse(response):
    return [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]


def test_endpoint_streams_result_and_caches_it():
    store, llm = FakeStore(), FakeLLM(kit_json())
    first = sse(call(store, llm))
    assert first[-1]["type"] == "result" and first[-1]["cached"] is False
    second = sse(call(store, llm))  # no outputs left: a model call would raise
    assert second[-1]["cached"] is True and llm.calls == 1


def test_endpoint_refresh_bypasses_cache():
    store, llm = FakeStore(), FakeLLM(kit_json(), kit_json())
    call(store, llm)
    again = sse(call(store, llm, query="?refresh=true"))
    assert llm.calls == 2 and again[-1]["cached"] is False


def test_get_cached_204_then_200():
    store = FakeStore()
    assert call(store, FakeLLM(), method="get").status_code == 204
    call(store, FakeLLM(kit_json()))
    r = call(store, FakeLLM(), method="get")
    assert r.status_code == 200 and r.json()["technical"]


def test_endpoint_errors():
    unknown = "3f2b1c1e-0000-4000-8000-0000000000ff"
    assert call(FakeStore(), FakeLLM(), job_id=unknown).status_code == 404
    assert call(FakeStore(with_resume=False), FakeLLM()).status_code == 409
    events = sse(call(FakeStore(), FakeLLM("x", "y")))
    assert events[-1]["type"] == "error"
