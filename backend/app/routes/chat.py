import json
from collections.abc import Iterator

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from ..chat import answer
from ..config import settings
from ..embeddings import OllamaEmbedder
from ..llm import make_llm
from ..retrieval import PgRetriever
from .documents import session_id_header

router = APIRouter(tags=["chat"])


def get_llm():
    return make_llm()


def get_embedder() -> OllamaEmbedder:
    return OllamaEmbedder()


def get_retriever() -> PgRetriever:
    return PgRetriever()


class ChatRequest(BaseModel):
    question: str = Field(min_length=2, max_length=1000)
    doc_ids: list[str] | None = None


@router.post("/chat")
def chat(req: ChatRequest, session_id: str = Depends(session_id_header),
         embedder=Depends(get_embedder), retriever=Depends(get_retriever),
         llm=Depends(get_llm)) -> StreamingResponse:
    def events() -> Iterator[str]:
        for event in answer(req.question, session_id, req.doc_ids, embedder=embedder,
                            retriever=retriever, llm=llm,
                            min_similarity=settings.min_similarity):
            yield f"data: {json.dumps(event)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
