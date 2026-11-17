"""Turn uploaded bytes into plain text. Fails loudly on unsupported or empty input."""
import io
from pathlib import Path

import pdfplumber
from docx import Document

SUPPORTED = {".pdf", ".docx", ".txt", ".md"}


class ParseError(ValueError):
    """Raised for unsupported, corrupt or empty documents."""


def parse_document(filename: str, data: bytes) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in SUPPORTED:
        raise ParseError(f"Unsupported file type '{ext}'. Use: {', '.join(sorted(SUPPORTED))}")
    try:
        if ext == ".pdf":
            text = _parse_pdf(data)
        elif ext == ".docx":
            text = _parse_docx(data)
        else:
            text = data.decode("utf-8", errors="replace")
    except ParseError:
        raise
    except Exception as exc:  # corrupt files raise many different library errors
        raise ParseError(f"Could not read {ext} file: {exc}") from exc

    text = _normalise(text)
    if not text:
        raise ParseError("No extractable text found (scanned PDFs are not supported).")
    return text


def _parse_pdf(data: bytes) -> str:
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        return "\n".join((page.extract_text() or "") for page in pdf.pages)


def _parse_docx(data: bytes) -> str:
    doc = Document(io.BytesIO(data))
    parts = [p.text for p in doc.paragraphs]
    for table in doc.tables:
        for row in table.rows:
            parts.append(" | ".join(cell.text.strip() for cell in row.cells))
    return "\n".join(parts)


def _normalise(text: str) -> str:
    lines = [line.rstrip() for line in text.replace("\r\n", "\n").split("\n")]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):  # collapse runs of blank lines
            out.append(line)
    return "\n".join(out).strip()
