import logging
import uuid
from dataclasses import asdict
from typing import Literal
from urllib.parse import urlsplit

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    Header,
    HTTPException,
    Query,
    UploadFile,
)
from pydantic import BaseModel, Field

from ..config import settings
from ..embeddings import EmbeddingError, OllamaEmbedder
from ..ingest.chunking import chunk_text, embedding_text
from ..ingest.fetch import FetchError, fetch_page
from ..ingest.parsing import ParseError, parse_document
from ..store import DocumentStore, PgDocumentStore

log = logging.getLogger("ingest")
router = APIRouter(prefix="/documents", tags=["documents"])


def get_store() -> DocumentStore:
    return PgDocumentStore()


def get_embedder() -> OllamaEmbedder:
    return OllamaEmbedder()


def get_fetcher():
    return fetch_page


def session_id_header(x_session_id: str = Header(..., min_length=8, max_length=64)) -> str:
    return x_session_id


def _title(text: str, filename: str) -> str:
    first = next((line.strip() for line in text.split("\n") if line.strip()), filename)
    return first[:120]


@router.post("", status_code=201)
async def upload(
    file: UploadFile = File(...),
    doc_type: str = Form(..., pattern="^(resume|job)$"),
    session_id: str = Depends(session_id_header),
    store: DocumentStore = Depends(get_store),
    embedder=Depends(get_embedder),
) -> dict:
    data = await file.read()
    if len(data) > settings.max_upload_mb * 1024 * 1024:
        raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB limit")
    filename = file.filename or "upload"
    try:
        text = parse_document(filename, data)
    except ParseError as exc:
        raise HTTPException(422, str(exc)) from exc

    return _ingest(text, _title(text, filename), filename, doc_type, session_id, store, embedder)


class UrlImport(BaseModel):
    url: str = Field(min_length=8, max_length=2000)
    doc_type: Literal["resume", "job"] = "job"


@router.post("/from-url", status_code=201)
def import_from_url(
    body: UrlImport,
    session_id: str = Depends(session_id_header),
    store: DocumentStore = Depends(get_store),
    embedder=Depends(get_embedder),
    fetcher=Depends(get_fetcher),
) -> dict:
    """Import a job posting (or online resume) by link. Sync on purpose: the fetch blocks, and
    FastAPI runs sync endpoints in a worker thread so it does not stall other requests."""
    try:
        page = fetcher(body.url)
    except FetchError as exc:
        log.info("url import rejected", extra={"extra_fields": {"reason": str(exc)}})
        raise HTTPException(422, str(exc)) from exc
    host = urlsplit(page.url).hostname or "web"
    return _ingest(page.text, page.title[:120], host, body.doc_type, session_id, store, embedder,
                   source="url")


def _ingest(text: str, title: str, filename: str, doc_type: str, session_id: str,
            store: DocumentStore, embedder, source: str = "file") -> dict:
    """Chunk, embed and store already-extracted text. Shared by file upload and URL import."""
    chunks = chunk_text(text)
    try:
        vectors = embedder.embed([embedding_text(title, c) for c in chunks])
    except EmbeddingError as exc:
        log.error("embedding failed", extra={"extra_fields": {"error": str(exc)}})
        raise HTTPException(502, str(exc)) from exc

    record = store.save(session_id, doc_type, filename, title, chunks, vectors)
    log.info("ingested", extra={"extra_fields": {
        "doc_id": record.id, "doc_type": doc_type, "chunks": len(chunks), "chars": len(text),
        "source": source}})
    return asdict(record)


@router.get("")
def list_documents(
    session_id: str = Depends(session_id_header), store: DocumentStore = Depends(get_store)
) -> list[dict]:
    return [asdict(r) for r in store.list(session_id)]


@router.post("/clear", status_code=204)
def clear_session(session_id: str = Query(..., min_length=8, max_length=64),
                  store: DocumentStore = Depends(get_store)) -> None:
    """Delete everything this session uploaded. Takes the ID as a query parameter (not the
    header) because the browser calls it from `navigator.sendBeacon` when the page closes or
    refreshes, and beacons cannot set custom headers."""
    removed = store.delete_session(session_id)
    log.info("session cleared", extra={"extra_fields": {"documents": removed}})


@router.delete("/{doc_id}", status_code=204)
def delete_document(
    doc_id: uuid.UUID,
    session_id: str = Depends(session_id_header),
    store: DocumentStore = Depends(get_store),
) -> None:
    if not store.delete(session_id, str(doc_id)):
        raise HTTPException(404, "Document not found")
