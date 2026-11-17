"""Persistence for documents and chunks. The only module that writes SQL."""
from dataclasses import dataclass
from typing import Protocol

from pgvector import Vector
from psycopg.types.json import Jsonb

from .db import connect
from .ingest.chunking import Chunk


@dataclass(frozen=True)
class DocumentRecord:
    id: str
    doc_type: str
    filename: str
    title: str
    chunk_count: int


class DocumentStore(Protocol):
    def save(self, session_id: str, doc_type: str, filename: str, title: str,
             chunks: list[Chunk], vectors: list[list[float]]) -> DocumentRecord: ...

    def list(self, session_id: str) -> list[DocumentRecord]: ...

    def get_text(self, session_id: str, doc_id: str) -> tuple[DocumentRecord, str] | None: ...

    def get_analysis(self, job_id: str, resume_id: str) -> dict | None: ...

    def save_analysis(self, job_id: str, resume_id: str, result: dict) -> None: ...

    def get_interview(self, job_id: str, resume_id: str) -> dict | None: ...

    def save_interview(self, job_id: str, resume_id: str, result: dict) -> None: ...

    def get_suggestions(self, job_id: str, resume_id: str) -> dict | None: ...

    def save_suggestions(self, job_id: str, resume_id: str, result: dict) -> None: ...

    def delete(self, session_id: str, doc_id: str) -> bool: ...

    def delete_session(self, session_id: str) -> int: ...

    def purge_older_than(self, hours: int) -> int: ...


class PgDocumentStore:
    def save(self, session_id, doc_type, filename, title, chunks, vectors) -> DocumentRecord:
        with connect() as conn, conn.transaction():
            doc_id = conn.execute(
                "INSERT INTO documents (session_id, doc_type, filename, title) "
                "VALUES (%s, %s, %s, %s) RETURNING id",
                (session_id, doc_type, filename, title),
            ).fetchone()[0]
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO chunks (doc_id, idx, section, content, embedding) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    [(doc_id, c.index, c.section, c.text, Vector(v))
                     for c, v in zip(chunks, vectors, strict=True)],
                )
        return DocumentRecord(str(doc_id), doc_type, filename, title, len(chunks))

    def list(self, session_id: str) -> list[DocumentRecord]:
        with connect() as conn:
            rows = conn.execute(
                "SELECT d.id, d.doc_type, d.filename, d.title, count(c.id) "
                "FROM documents d LEFT JOIN chunks c ON c.doc_id = d.id "
                "WHERE d.session_id = %s GROUP BY d.id ORDER BY d.created_at",
                (session_id,),
            ).fetchall()
        return [DocumentRecord(str(r[0]), r[1], r[2], r[3], r[4]) for r in rows]

    def get_text(self, session_id: str, doc_id: str) -> tuple[DocumentRecord, str] | None:
        """Rebuild a document's text from its chunks, restoring section headings."""
        with connect() as conn:
            rows = conn.execute(
                "SELECT d.id, d.doc_type, d.filename, d.title, c.section, c.content "
                "FROM documents d JOIN chunks c ON c.doc_id = d.id "
                "WHERE d.id = %s AND d.session_id = %s ORDER BY c.idx",
                (doc_id, session_id),
            ).fetchall()
        if not rows:
            return None
        record = DocumentRecord(str(rows[0][0]), rows[0][1], rows[0][2], rows[0][3], len(rows))
        parts, last = [], None
        for r in rows:
            if r[4] != last:
                parts.append(r[4].upper())
                last = r[4]
            parts.append(r[5])
        return record, "\n".join(parts)

    def get_analysis(self, job_id: str, resume_id: str) -> dict | None:
        return self._get_result("analyses", job_id, resume_id)

    def save_analysis(self, job_id: str, resume_id: str, result: dict) -> None:
        self._save_result("analyses", job_id, resume_id, result)

    def get_interview(self, job_id: str, resume_id: str) -> dict | None:
        return self._get_result("interview_kits", job_id, resume_id)

    def save_interview(self, job_id: str, resume_id: str, result: dict) -> None:
        self._save_result("interview_kits", job_id, resume_id, result)

    def get_suggestions(self, job_id: str, resume_id: str) -> dict | None:
        return self._get_result("resume_suggestions", job_id, resume_id)

    def save_suggestions(self, job_id: str, resume_id: str, result: dict) -> None:
        self._save_result("resume_suggestions", job_id, resume_id, result)

    # `table` is always one of our two fixed names, never user input.
    def _get_result(self, table: str, job_id: str, resume_id: str) -> dict | None:
        with connect() as conn:
            row = conn.execute(
                f"SELECT result FROM {table} WHERE job_id = %s AND resume_id = %s",
                (job_id, resume_id),
            ).fetchone()
        return row[0] if row else None

    def _save_result(self, table: str, job_id: str, resume_id: str, result: dict) -> None:
        with connect() as conn:
            conn.execute(
                f"INSERT INTO {table} (job_id, resume_id, result) VALUES (%s, %s, %s) "
                "ON CONFLICT (job_id, resume_id) DO UPDATE "
                "SET result = EXCLUDED.result, created_at = now()",
                (job_id, resume_id, Jsonb(result)),
            )

    def delete(self, session_id: str, doc_id: str) -> bool:
        with connect() as conn:
            cur = conn.execute(
                "DELETE FROM documents WHERE id = %s AND session_id = %s", (doc_id, session_id)
            )
            return cur.rowcount > 0

    def delete_session(self, session_id: str) -> int:
        """Remove everything a session uploaded (chunks and analyses cascade)."""
        with connect() as conn:
            return conn.execute(
                "DELETE FROM documents WHERE session_id = %s", (session_id,)
            ).rowcount

    def purge_older_than(self, hours: int) -> int:
        """Safety net for sessions whose browser never got to call delete_session."""
        with connect() as conn:
            return conn.execute(
                "DELETE FROM documents WHERE created_at < now() - make_interval(hours => %s)",
                (hours,),
            ).rowcount
