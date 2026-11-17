import logging
import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request

from .config import settings
from .db import init_schema
from .logging_setup import setup_logging
from .routes import analysis as analysis_routes
from .routes import chat as chat_routes
from .routes import documents
from .store import PgDocumentStore

setup_logging(settings.log_level)
log = logging.getLogger("api")

@asynccontextmanager
async def lifespan(_: FastAPI):
    try:
        init_schema()
        purged = PgDocumentStore().purge_older_than(settings.session_ttl_hours)
        if purged:
            log.info("purged stale documents", extra={"extra_fields": {"documents": purged}})
    except Exception as exc:  # noqa: BLE001 - keep the API up (and /health honest) if the DB is down
        log.error("schema init failed", extra={"extra_fields": {"error": str(exc)}})
    yield


app = FastAPI(title="Career Intelligence Assistant", lifespan=lifespan)
app.include_router(documents.router)
app.include_router(chat_routes.router)
app.include_router(analysis_routes.router)


@app.middleware("http")
async def request_logging(request: Request, call_next):
    request_id = uuid.uuid4().hex[:8]
    start = time.perf_counter()
    response = await call_next(request)
    ms = round((time.perf_counter() - start) * 1000)
    log.info(
        "request",
        extra={"extra_fields": {"request_id": request_id, "path": request.url.path,
                                "status": response.status_code, "ms": ms}},
    )
    response.headers["X-Request-ID"] = request_id
    return response


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "llm_provider": settings.llm_provider}
