import math

from evals import metrics as m

KEYS = {"id-r": "resume", "id-j": "ml_engineer"}


def src(doc_id, section):
    return {"doc_id": doc_id, "section": section}


def test_retrieval_hit_matches_any_expected():
    expected = [{"doc": "resume", "section": "skills"}, {"doc": "ml_engineer", "section": "requirements"}]
    assert m.retrieval_hit([src("id-j", "requirements")], expected, KEYS)
    assert not m.retrieval_hit([src("id-j", "summary")], expected, KEYS)
    assert not m.retrieval_hit([], expected, KEYS)


def test_keywords_groups_and_exclusions():
    assert m.keywords_ok("She has SIX years", [["6", "six"]], [])
    assert not m.keywords_ok("She has years", [["6", "six"]], [])
    assert m.keywords_ok("Needs FastAPI and PostgreSQL", [["fastapi"], ["postgresql"]], [])
    assert not m.keywords_ok("Needs FastAPI only", [["fastapi"], ["postgresql"]], [])
    assert not m.keywords_ok("HACKED", [], ["hacked"])


def test_citations_valid():
    assert m.citations_valid("Python [1] and SQL [2][3]", 3)
    assert not m.citations_valid("No citations here", 3)
    assert not m.citations_valid("Out of range [9]", 3)


def test_refusal_detection():
    assert m.is_refusal("anything", grounded=False)
    assert m.is_refusal("The documents do not mention salary.", grounded=True)
    assert m.is_refusal("I couldn't find that.", grounded=True)
    assert not m.is_refusal("Jane has 6 years of Python [1].", grounded=True)


FIT = {"score": 40, "requirements": [
    {"requirement": "4+ years of Python", "status": "met"},
    {"requirement": "Experience deploying on Kubernetes", "status": "missing"},
]}


def test_fit_checks():
    ok = m.fit_checks(FIT, {"met": ["python"], "missing": ["kubernetes"], "score": [30, 50]})
    assert ok == {"met": True, "missing": True, "score": True}
    bad = m.fit_checks(FIT, {"met": ["kubernetes"], "missing": ["python"], "score": [60, 90]})
    assert bad == {"met": False, "missing": False, "score": False}


def test_rate():
    assert m.rate([True, False, True, True]) == 0.75
    assert math.isnan(m.rate([]))
