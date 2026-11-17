"""Vector retrieval scoped to one session (and optionally to chosen documents)."""
from dataclasses import dataclass
from typing import Protocol

from pgvector import Vector

from .db import connect


@dataclass(frozen=True)
class Hit:
    chunk_id: int
    doc_id: str
    doc_title: str
    doc_type: str
    section: str
    content: str
    score: float  # cosine similarity, 1.0 = identical


class Retriever(Protocol):
    def search(self, session_id: str, query_vec: list[float], k: int,
               doc_ids: list[str] | None = None, doc_type: str | None = None) -> list[Hit]: ...


class PgRetriever:
    def search(self, session_id, query_vec, k, doc_ids=None, doc_type=None) -> list[Hit]:
        sql = (
            "SELECT c.id, d.id, d.title, d.doc_type, c.section, c.content, "
            "1 - (c.embedding <=> %s) AS score "
            "FROM chunks c JOIN documents d ON d.id = c.doc_id "
            "WHERE d.session_id = %s"
        )
        vec = Vector(query_vec)
        params: list = [vec, session_id]
        if doc_ids:
            sql += " AND d.id = ANY(%s::uuid[])"
            params.append(doc_ids)
        if doc_type:
            sql += " AND d.doc_type = %s"
            params.append(doc_type)
        sql += " ORDER BY c.embedding <=> %s LIMIT %s"
        params += [vec, k]
        with connect() as conn:
            rows = conn.execute(sql, params).fetchall()
        return [Hit(r[0], str(r[1]), r[2], r[3], r[4], r[5], float(r[6])) for r in rows]
