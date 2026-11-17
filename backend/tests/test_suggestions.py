import json

import pytest
from fastapi.testclient import TestClient

from app.analysis import AnalysisError
from app.main import app
from app.routes import analysis as analysis_routes
from app.routes import documents
from app.store import DocumentRecord
from app.suggestions import (
    MAX_SUGGESTIONS,
    SuggestionOutput,
    added_terms,
    build_result,
    new_numbers,
    suggestion_events,
    unsupported_claims,
)

RESUME = (
    "SUMMARY\nBackend engineer with 6 years of Python.\n"
    "EXPERIENCE\n- Built FastAPI services handling 2M requests/day\n"
    "- Deployed services on AWS ECS with Docker\n- Mentored 4 junior engineers"
)
JOB = (
    "REQUIREMENTS\n- Strong Python and FastAPI\n- Kubernetes and Helm in production\n"
    "- Experience with Docker and AWS\n- Microservices architecture\nNICE TO HAVE\n- React"
)


def raw(**over):
    base = {"category": "rewrite", "priority": "high", "title": "Sharpen the API bullet",
            "issue": "Vague", "original": "Built FastAPI services handling 2M requests/day",
            "suggestion": "Designed FastAPI services handling 2M requests/day with [X%] lower latency",
            "needs_input": ["the real latency improvement"]}
    return {**base, **over}


def output(*items, summary="Solid base."):
    return SuggestionOutput.model_validate({"summary": summary, "suggestions": list(items)})


# ---- number check ------------------------------------------------------------------------

def test_numbers_already_in_the_resume_are_fine():
    assert new_numbers("Handled 2M requests/day for 6 years", RESUME) == []


def test_invented_numbers_are_flagged():
    assert new_numbers("Cut latency by 40% and grew traffic 3x to 5,000 users", RESUME) == ["3", "40", "5000"]


def test_placeholders_are_allowed_to_hold_numbers():
    assert new_numbers("Reduced costs by [X%] across [N] services", RESUME) == []


def test_percent_and_plain_forms_match():
    assert new_numbers("up 40 percent", "improved throughput by 40%") == []


# ---- added-terms check -------------------------------------------------------------------

def test_skill_from_the_job_that_the_resume_lacks_is_flagged():
    assert added_terms("Led Kubernetes migrations for FastAPI services", RESUME, JOB) == ["Kubernetes"]


def test_terms_the_resume_already_has_are_not_flagged():
    assert added_terms("Deployed Docker services on AWS with FastAPI", RESUME, JOB) == []


def test_plural_and_singular_are_treated_alike():
    assert added_terms("Designed a Microservice layout", RESUME, JOB) == ["Microservice"]
    assert added_terms("Mentored engineers", RESUME + "\nmicroservices", JOB) == []


def test_generic_job_words_and_non_job_words_are_not_flagged():
    assert added_terms("Strong experience building teams and Spearheaded delivery", RESUME, JOB) == []


def test_placeholders_are_ignored_by_the_term_check():
    assert added_terms("Reduced [Kubernetes cost] by [X%]", RESUME, JOB) == []


# ---- outcome-claim check -----------------------------------------------------------------

def test_invented_results_without_digits_are_flagged():
    assert unsupported_claims("Designed FastAPI services with sub-second latency", RESUME) == ["sub-second"]
    assert unsupported_claims("Led migrations with zero downtime", RESUME) == ["zero downtime"]
    assert unsupported_claims("Shipped faster and improved reliability", RESUME) == ["faster", "improved"]


def test_a_result_followed_by_a_placeholder_is_allowed():
    assert unsupported_claims("Reduced onboarding time by [X%]", RESUME) == []


def test_results_the_resume_already_states_are_allowed():
    assert unsupported_claims("Improved throughput", "Improved throughput across services") == []


def test_plain_rewrites_have_no_claims():
    assert unsupported_claims("Designed FastAPI services handling 2M requests/day", RESUME) == []


def test_rewrite_with_invented_result_is_warned_in_the_result():
    bad = raw(suggestion="Built FastAPI services handling 2M requests/day with zero downtime")
    w = build_result("j", "Job", output(bad), RESUME, JOB)["suggestions"][0]["warnings"]
    assert w["unsupported_claims"] == ["zero downtime"]


# ---- building the result -----------------------------------------------------------------

def test_clean_rewrite_has_no_warnings():
    item = build_result("j", "Job", output(raw()), RESUME, JOB)["suggestions"][0]
    assert item["original_verified"] is True and item["original"].startswith("Built FastAPI")
    assert item["warnings"] == {"original_missing": False, "new_numbers": [], "added_terms": [],
                                "unsupported_claims": []}


def test_fabricated_original_is_cleared_and_flagged():
    bad = raw(original="Led a 40 person platform team at Google")
    item = build_result("j", "Job", output(bad), RESUME, JOB)["suggestions"][0]
    assert item["original"] == "" and item["original_verified"] is False
    assert item["warnings"]["original_missing"] is True


def test_rewrite_with_invented_number_and_skill_is_warned():
    bad = raw(suggestion="Led Kubernetes migrations cutting latency by 40%")
    w = build_result("j", "Job", output(bad), RESUME, JOB)["suggestions"][0]["warnings"]
    assert w["new_numbers"] == ["40"] and w["added_terms"] == ["Kubernetes"]


def test_gap_and_advice_categories_are_not_number_or_term_checked():
    gap = raw(category="gap", original="", suggestion="Kubernetes is missing: take a 2 week course and say so honestly")
    w = build_result("j", "Job", output(gap), RESUME, JOB)["suggestions"][0]["warnings"]
    assert w == {"original_missing": False, "new_numbers": [], "added_terms": [], "unsupported_claims": []}


def test_sorted_by_priority_and_capped():
    items = [raw(priority=p, title=f"Suggestion number {i}", original="", category="advice")
             for i, p in enumerate(["low", "high", "medium"] * 4)]
    result = build_result("j", "Job", output(*items), RESUME, JOB)["suggestions"]
    assert len(result) == MAX_SUGGESTIONS
    priorities = [s["priority"] for s in result]
    assert priorities == sorted(priorities, key=["high", "medium", "low"].index)


def test_unknown_category_and_priority_are_coerced():
    s = build_result("j", "Job", output(raw(category="Magic", priority="URGENT", original="")), RESUME, JOB)["suggestions"][0]
    assert s["category"] == "advice" and s["priority"] == "medium"


def test_needs_input_accepts_a_string_or_list_and_drops_blanks():
    a = build_result("j", "Job", output(raw(needs_input="team size", original="")), RESUME, JOB)["suggestions"][0]
    b = build_result("j", "Job", output(raw(needs_input=["x", " ", 5], original="")), RESUME, JOB)["suggestions"][0]
    assert a["needs_input"] == ["team size"] and b["needs_input"] == ["x", "5"]


def test_requires_at_least_one_suggestion():
    with pytest.raises(ValueError):
        SuggestionOutput.model_validate({"summary": "x", "suggestions": []})


# ---- generator ---------------------------------------------------------------------------

class FakeLLM:
    def __init__(self, *outputs):
        self.outputs, self.calls = list(outputs), 0

    def stream(self, system, prompt, json_mode=False):
        assert json_mode
        self.calls += 1
        out = self.outputs.pop(0)
        for i in range(0, len(out), 25):
            yield out[i:i + 25]


def payload(*items):
    return json.dumps({"summary": "Solid base.", "suggestions": list(items)})


def events(llm):
    return list(suggestion_events("job-1", "ML Engineer", JOB, RESUME, llm))


def test_events_end_with_result_and_report_progress():
    ev = events(FakeLLM(payload(raw(), raw(title="Second suggestion", original=""))))
    assert any(k == "progress" for k, _ in ev)
    kind, result = ev[-1]
    assert kind == "result" and result["title"] == "ML Engineer" and len(result["suggestions"]) == 2


def test_retries_once_then_fails():
    assert events(FakeLLM("garbage", payload(raw())))[-1][0] == "result"
    with pytest.raises(AnalysisError, match="twice"):
        events(FakeLLM("nope", json.dumps({"summary": "", "suggestions": []})))


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

    def get_suggestions(self, job_id, resume_id):
        return self.cache.get((job_id, resume_id))

    def save_suggestions(self, job_id, resume_id, result):
        self.cache[(job_id, resume_id)] = result


def call(store, llm, method="post", query="", job_id=None):
    app.dependency_overrides[documents.get_store] = lambda: store
    app.dependency_overrides[analysis_routes.get_llm] = lambda: llm
    try:
        return getattr(TestClient(app), method)(
            f"/analysis/improve/{job_id or store.job.id}{query}", headers={"X-Session-ID": "session-12345"})
    finally:
        app.dependency_overrides.clear()


def sse(response):
    return [json.loads(line[5:]) for line in response.text.splitlines() if line.startswith("data:")]


def test_endpoint_streams_result_then_serves_it_from_cache():
    store, llm = FakeStore(), FakeLLM(payload(raw()))
    first = sse(call(store, llm))
    assert first[-1]["type"] == "result" and first[-1]["cached"] is False
    second = sse(call(store, llm))  # no outputs left: a model call would raise
    assert second[-1]["cached"] is True and llm.calls == 1


def test_endpoint_refresh_and_cached_get():
    store, llm = FakeStore(), FakeLLM(payload(raw()), payload(raw()))
    assert call(store, FakeLLM(), method="get").status_code == 204
    call(store, llm)
    assert sse(call(store, llm, query="?refresh=true"))[-1]["cached"] is False and llm.calls == 2
    assert call(store, FakeLLM(), method="get").json()["suggestions"]


def test_endpoint_errors():
    unknown = "3f2b1c1e-0000-4000-8000-0000000000ff"
    assert call(FakeStore(), FakeLLM(), job_id=unknown).status_code == 404
    assert call(FakeStore(with_resume=False), FakeLLM()).status_code == 409
    assert sse(call(FakeStore(), FakeLLM("x", "y")))[-1]["type"] == "error"


def test_a_placeholder_just_before_the_result_is_also_allowed():
    assert unsupported_claims("Handled 2M requests/day with [X%] lower latency", RESUME) == []


def test_a_placeholder_far_from_the_result_does_not_excuse_it():
    text = "Built services achieving 99.9% uptime across the platform and reducing latency by [X%]"
    assert "99.9%" in unsupported_claims(text, RESUME)
