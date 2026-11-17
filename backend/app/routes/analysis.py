import json
import uuid
from collections.abc import Iterator
from dataclasses import asdict

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import StreamingResponse

from ..analysis import AnalysisError, analyse_fit_events
from ..interview import interview_events
from ..llm import make_llm
from ..store import DocumentStore
from .documents import get_store, session_id_header

router = APIRouter(prefix="/analysis", tags=["analysis"])


def get_llm():
    return make_llm()


def _sse(payload: dict) -> str:
    return f"data: {json.dumps(payload)}\n\n"


def _latest_resume_id(store: DocumentStore, session_id: str) -> str | None:
    resume = next((d for d in reversed(store.list(session_id)) if d.doc_type == "resume"), None)
    return resume.id if resume else None


@router.get("/fit/{job_id}")
def cached_fit(job_id: uuid.UUID, session_id: str = Depends(session_id_header),
               store: DocumentStore = Depends(get_store)):
    """Return the saved analysis for the current resume + this job, or 204 if none."""
    resume_id = _latest_resume_id(store, session_id)
    job = store.get_text(session_id, str(job_id))
    if resume_id is None or job is None:
        return Response(status_code=204)
    result = store.get_analysis(str(job_id), resume_id)
    return result if result else Response(status_code=204)


@router.post("/fit/{job_id}")
def fit(job_id: uuid.UUID, refresh: bool = False, session_id: str = Depends(session_id_header),
        store: DocumentStore = Depends(get_store), llm=Depends(get_llm)) -> StreamingResponse:
    """Streams {"type": "progress"|"result"|"error"} events so long model runs keep the
    connection alive (proxies drop idle requests) and the UI can show progress.
    Results are cached per (job, resume); pass refresh=true to recompute."""
    job = store.get_text(session_id, str(job_id))
    if job is None or job[0].doc_type != "job":
        raise HTTPException(404, "Job posting not found")

    resume_id = _latest_resume_id(store, session_id)
    resume = store.get_text(session_id, resume_id) if resume_id else None
    if resume is None:
        raise HTTPException(409, "Upload a resume first")

    def events() -> Iterator[str]:
        if not refresh and (cached := store.get_analysis(job[0].id, resume[0].id)):
            yield _sse({"type": "result", "result": cached, "cached": True})
            return
        try:
            for kind, value in analyse_fit_events(job[0].id, job[0].title, job[1], resume[1], llm):
                if kind == "progress":
                    yield _sse({"type": "progress", "chunks": value})
                else:
                    result = asdict(value)
                    store.save_analysis(job[0].id, resume[0].id, result)
                    yield _sse({"type": "result", "result": result, "cached": False})
        except AnalysisError as exc:
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---- Interview prep ------------------------------------------------------------------------

@router.get("/interview/{job_id}")
def cached_interview(job_id: uuid.UUID, session_id: str = Depends(session_id_header),
                     store: DocumentStore = Depends(get_store)):
    """Return the saved interview kit for the current resume + this job, or 204 if none."""
    resume_id = _latest_resume_id(store, session_id)
    job = store.get_text(session_id, str(job_id))
    if resume_id is None or job is None:
        return Response(status_code=204)
    result = store.get_interview(str(job_id), resume_id)
    return result if result else Response(status_code=204)


@router.post("/interview/{job_id}")
def interview(job_id: uuid.UUID, refresh: bool = False, session_id: str = Depends(session_id_header),
              store: DocumentStore = Depends(get_store), llm=Depends(get_llm)) -> StreamingResponse:
    """Streams {"type": "progress"|"result"|"error"} events, like /analysis/fit. Cached per
    (job, resume); pass refresh=true to regenerate."""
    job = store.get_text(session_id, str(job_id))
    if job is None or job[0].doc_type != "job":
        raise HTTPException(404, "Job posting not found")

    resume_id = _latest_resume_id(store, session_id)
    resume = store.get_text(session_id, resume_id) if resume_id else None
    if resume is None:
        raise HTTPException(409, "Upload a resume first")

    def events() -> Iterator[str]:
        if not refresh and (cached := store.get_interview(job[0].id, resume[0].id)):
            yield _sse({"type": "result", "result": cached, "cached": True})
            return
        try:
            for kind, value in interview_events(job[0].id, job[0].title, job[1], resume[1], llm):
                if kind == "progress":
                    yield _sse({"type": "progress", "chunks": value})
                else:
                    store.save_interview(job[0].id, resume[0].id, value)
                    yield _sse({"type": "result", "result": value, "cached": False})
        except AnalysisError as exc:
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
