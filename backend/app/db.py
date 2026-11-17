import psycopg
from pgvector.psycopg import register_vector

from .config import settings
from .embeddings import EMBED_DIM

SCHEMA = f"""
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE IF NOT EXISTS documents (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id  TEXT NOT NULL,
    doc_type    TEXT NOT NULL CHECK (doc_type IN ('resume', 'job')),
    filename    TEXT NOT NULL,
    title       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_session_idx ON documents (session_id);
CREATE TABLE IF NOT EXISTS chunks (
    id        BIGSERIAL PRIMARY KEY,
    doc_id    UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    idx       INT NOT NULL,
    section   TEXT NOT NULL,
    content   TEXT NOT NULL,
    embedding vector({EMBED_DIM}) NOT NULL
);
CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks (doc_id);
CREATE TABLE IF NOT EXISTS analyses (
    job_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    resume_id  UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    result     JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (job_id, resume_id)
);
"""


def connect() -> psycopg.Connection:
    conn = psycopg.connect(settings.database_url, autocommit=True)
    conn.execute("CREATE EXTENSION IF NOT EXISTS vector")
    register_vector(conn)
    return conn


def init_schema() -> None:
    with psycopg.connect(settings.database_url, autocommit=True) as conn:
        conn.execute(SCHEMA)
