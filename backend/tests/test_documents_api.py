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


# ---- URL import -------------------------------------------------------------------------

from app.ingest.fetch import FetchedPage, FetchError

JOB_PAGE = FetchedPage(
    url="https://jobs.example.com/backend",
    title="Backend Engineer - Acme",
    text="# Backend Engineer\n\nAcme builds tools.\n\n## Requirements\n\n- Python\n- SQL\n\n## Nice to have\n\n- Terraform",
)


def url_client(store=None, embedder=None, fetcher=None):
    app.dependency_overrides[documents.get_fetcher] = lambda: fetcher or (lambda url: JOB_PAGE)
    return client(store, embedder)


def test_import_from_url_stores_sections_and_titles_by_page():
    store = FakeStore()
    r = url_client(store).post("/documents/from-url", headers=SID,
                               json={"url": "https://jobs.example.com/backend"})
    assert r.status_code == 201
    body = r.json()
    assert body["doc_type"] == "job" and body["title"] == "Backend Engineer - Acme"
    assert body["filename"] == "jobs.example.com" and body["chunk_count"] == 3  # header, requirements, nice to have
    assert store.saved[0][:2] == ("session-12345", "job")


def test_import_from_url_can_target_resume():
    r = url_client().post("/documents/from-url", headers=SID,
                          json={"url": "https://cv.example.com/jane", "doc_type": "resume"})
    assert r.status_code == 201 and r.json()["doc_type"] == "resume"


def test_import_from_url_reports_fetch_problems_as_422():
    def blocked(url):
        raise FetchError("That address is not allowed (it points to a private network).")

    r = url_client(fetcher=blocked).post("/documents/from-url", headers=SID,
                                         json={"url": "http://169.254.169.254/latest/meta-data"})
    assert r.status_code == 422 and "private network" in r.json()["detail"]


def test_import_from_url_validates_body_and_session():
    c = url_client()
    assert c.post("/documents/from-url", headers=SID, json={"url": "x"}).status_code == 422
    assert c.post("/documents/from-url", headers=SID,
                  json={"url": "https://a.example.com/x", "doc_type": "cover"}).status_code == 422
    assert c.post("/documents/from-url", json={"url": "https://a.example.com/x"}).status_code == 422


def test_import_from_url_embedding_failure_is_502():
    r = url_client(embedder=BrokenEmbedder()).post("/documents/from-url", headers=SID,
                                                   json={"url": "https://jobs.example.com/backend"})
    assert r.status_code == 502
