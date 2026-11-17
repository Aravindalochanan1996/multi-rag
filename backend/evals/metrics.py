"""Deterministic scoring helpers for the golden eval. No LLM-as-judge on purpose: keyword and
structure checks are reproducible, cheap, and easy to explain (and to criticise: see README)."""
import re

REFUSAL_PATTERN = re.compile(
    r"couldn'?t find|could not find|can'?t|cannot|not (mentioned|specified|provided|found|include|contain|stated|listed)"
    r"|no (information|mention|details|data)|(does not|doesn'?t|do not|don'?t) (mention|specify|include|contain|say|list|state)"
    r"|isn'?t (mentioned|specified|provided)|unable to",
    re.IGNORECASE,
)


def retrieval_hit(sources: list[dict], expected: list[dict], key_by_doc_id: dict[str, str]) -> bool:
    """True if any retrieved source matches ANY expected {doc, section}."""
    wanted = {(e["doc"], e["section"]) for e in expected}
    return any((key_by_doc_id.get(s["doc_id"]), s["section"]) in wanted for s in sources)


def keywords_ok(answer: str, include: list[list[str]], exclude: list[str]) -> bool:
    """Every group needs at least one of its alternatives present; no excluded word may appear."""
    text = answer.lower()
    groups_ok = all(any(alt.lower() in text for alt in group) for group in include)
    return groups_ok and not any(word.lower() in text for word in exclude)


def citations_valid(answer: str, n_sources: int) -> bool:
    """At least one [n] marker, and every marker points at a real source."""
    nums = [int(n) for n in re.findall(r"\[(\d+)\]", answer)]
    return bool(nums) and all(1 <= n <= n_sources for n in nums)


def is_refusal(answer: str, grounded: bool) -> bool:
    """Refused either by our guardrail (nothing relevant retrieved) or by the model itself."""
    return (not grounded) or bool(REFUSAL_PATTERN.search(answer))


def fit_checks(result: dict, expect: dict) -> dict[str, bool]:
    """Compare a fit result with expected met/missing keywords and a score band."""
    def status_of(keyword: str) -> set[str]:
        return {r["status"] for r in result["requirements"] if keyword.lower() in r["requirement"].lower()}

    lo, hi = expect["score"]
    met_ok = all("met" in status_of(k) or "partial" in status_of(k) for k in expect["met"])
    missing_ok = all("missing" in status_of(k) for k in expect["missing"])
    return {"met": met_ok, "missing": missing_ok, "score": lo <= result["score"] <= hi}


def rate(flags: list[bool]) -> float:
    return round(sum(flags) / len(flags), 3) if flags else float("nan")
