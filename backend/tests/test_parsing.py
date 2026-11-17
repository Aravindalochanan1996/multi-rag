import io

import pytest
from docx import Document

from app.ingest.parsing import ParseError, parse_document


def make_docx(*paragraphs: str) -> bytes:
    doc = Document()
    for p in paragraphs:
        doc.add_paragraph(p)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()


def test_text_file():
    assert parse_document("a.txt", b"hello\r\n\r\n\r\nworld") == "hello\n\nworld"


def test_docx():
    text = parse_document("cv.docx", make_docx("EXPERIENCE", "Built things"))
    assert "EXPERIENCE" in text and "Built things" in text


def test_unsupported_extension():
    with pytest.raises(ParseError, match="Unsupported"):
        parse_document("cv.exe", b"x")


def test_corrupt_pdf():
    with pytest.raises(ParseError, match="Could not read"):
        parse_document("cv.pdf", b"not a pdf")


def test_empty_file_rejected():
    with pytest.raises(ParseError, match="No extractable text"):
        parse_document("a.txt", b"   \n  ")
