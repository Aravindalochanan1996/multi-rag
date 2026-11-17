from fastapi.testclient import TestClient

from app.embeddings import EmbeddingError
from app.main import app
from app.routes import documents
from app.store import DocumentRecord

SID = {"X-Session-ID": "session-12345"}
RESUME = b"Jane Doe\n\nSKILLS\nPython, FastAPI\n\nEXPERIENCE\nBuilt APIs"


class FakeStore:
    def __init__(self):
        self.saved = []

    def save(self, session_id, doc_type, filename, title, chunks, vectors):
        assert len(chunks) == len(vectors)
        self.saved.append((session_id, doc_type, filename, title, len(chunks)))
        return DocumentRecord("id-1", doc_type, filename, title, len(chunks))

    def list(self, session_id):
        return [DocumentRecord("id-1", "resume", "cv.txt", "Jane Doe", 3)]

    def delete(self, session_id, doc_id):
        return False

    def delete_session(self, session_id):
        self.cleared = getattr(self, "cleared", []) + [session_id]
        return 3


class FakeEmbedder:
    def embed(self, texts):
        return [[0.0] * 768 for _ in texts]


class BrokenEmbedder:
    def embed(self, texts):
        raise EmbeddingError("ollama down")


def client(store=None, embedder=None):
    app.dependency_overrides[documents.get_store] = lambda: store or FakeStore()
    app.dependency_overrides[documents.get_embedder] = lambda: embedder or FakeEmbedder()
    return TestClient(app)


def teardown_function():
    app.dependency_overrides.clear()


def test_upload_ok():
    store = FakeStore()
    r = client(store).post("/documents", headers=SID, data={"doc_type": "resume"},
                           files={"file": ("cv.txt", RESUME)})
    assert r.status_code == 201
    assert r.json()["chunk_count"] == 3  # header, skills, experience
    assert store.saved[0][:3] == ("session-12345", "resume", "cv.txt")


def test_rejects_bad_doc_type():
    r = client().post("/documents", headers=SID, data={"doc_type": "cover"},
                      files={"file": ("cv.txt", RESUME)})
    assert r.status_code == 422


def test_rejects_unsupported_file():
    r = client().post("/documents", headers=SID, data={"doc_type": "job"},
                      files={"file": ("x.exe", b"abc")})
    assert r.status_code == 422


def test_requires_session_header():
    r = client().post("/documents", data={"doc_type": "job"}, files={"file": ("a.txt", RESUME)})
    assert r.status_code == 422


def test_embedding_failure_is_502():
    r = client(embedder=BrokenEmbedder()).post(
        "/documents", headers=SID, data={"doc_type": "job"}, files={"file": ("a.txt", RESUME)})
    assert r.status_code == 502


def test_list_and_delete_missing():
    c = client()
    assert c.get("/documents", headers=SID).json()[0]["title"] == "Jane Doe"
    assert c.delete("/documents/3f2b1c1e-0000-4000-8000-000000000000", headers=SID).status_code == 404


def test_clear_session_deletes_everything_for_that_session():
    store = FakeStore()
    r = client(store).post("/documents/clear?session_id=session-12345")  # no header: sent by sendBeacon
    assert r.status_code == 204
    assert store.cleared == ["session-12345"]


def test_clear_session_validates_id_length():
    c = client()
    assert c.post("/documents/clear?session_id=short").status_code == 422
    assert c.post("/documents/clear").status_code == 422
